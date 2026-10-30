import { env } from '../env';
import { ErrorPaso } from '../ia/claude';
import { db, registrarEvento, revisar } from '../supabase';
import type { Json } from '../tipos-db';
import { AGENTES, AGENTES_SIMULADOS } from '../agentes';
import { NOMBRE_PASO } from './flujo';
import { patearMotor } from './patear';
import { anotarUrlDelLatido } from './secreto';
import { autoResolverPrevias } from './previas';
import { PASOS_CON_IA, TIPOS_PASO, type ContextoPaso, type TipoPaso } from './tipos';

/** Después de un paso corto se sigue en la misma vuelta solo si queda tiempo para uno de IA. */
const SEG_PARA_OTRO_PASO = 255;

export async function contarPasosDisponibles(): Promise<number> {
  const { count, error } = await db()
    .from('fab_pasos')
    .select('id, fab_pedidos!inner(estado)', { count: 'exact', head: true })
    .eq('estado', 'pendiente')
    .lte('disponible_desde', new Date().toISOString())
    .eq('fab_pedidos.estado', 'en_marcha');
  if (error) {
    console.error('No se pudieron contar los pasos:', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Una vuelta del motor: toma pasos de la cola y los corre hasta quedarse sin tiempo.
 * Al final, si quedan pasos esperando, despierta a otros trabajadores.
 */
export async function correrMotor(inicio = Date.now()): Promise<number> {
  const hasta = inicio + (env.duracionMaxSeg - 20) * 1000;
  await anotarUrlDelLatido(env.appUrl);
  let corridos = 0;
  for (;;) {
    const restanteSeg = (hasta - Date.now()) / 1000;
    if (restanteSeg < 30 || (corridos > 0 && restanteSeg < SEG_PARA_OTRO_PASO)) break;
    const tomo = await correrUnPaso(hasta);
    if (!tomo) break;
    corridos++;
  }
  const pendientes = await contarPasosDisponibles();
  if (pendientes > 0) await patearMotor(Math.min(pendientes, 3));
  return corridos;
}

async function correrUnPaso(hasta: number): Promise<boolean> {
  const tomados = revisar(await db().rpc('fab_tomar_paso', { p_atasco_seg: env.duracionMaxSeg + 30 }), 'tomar paso');
  const paso = tomados?.[0];
  if (!paso) return false;

  const pedido = revisar(await db().from('fab_pedidos').select('*').eq('id', paso.pedido_id).single(), 'leer pedido');
  const comercio = revisar(await db().from('fab_comercios').select('*').eq('id', pedido.comercio_id).single(), 'leer comercio');
  const tipo = paso.tipo as TipoPaso;

  const agente = (TIPOS_PASO as readonly string[]).includes(tipo)
    ? (pedido.simulado ? AGENTES_SIMULADOS[tipo] : undefined) ?? AGENTES[tipo]
    : undefined;
  if (!agente) {
    await db().rpc('fab_fallo_generico', { p_paso: paso.id, p_error: `No hay agente para el paso «${paso.tipo}».` });
    return true;
  }

  if (PASOS_CON_IA.includes(tipo) && !pedido.simulado && Number(pedido.gasto_usd) >= Number(pedido.tope_usd)) {
    await db().rpc('fab_frenar_por_tope', { p_paso: paso.id, p_intento: paso.intento });
    await registrarEvento(pedido.id, `Frenado por tope de gasto antes de: ${NOMBRE_PASO[tipo]}.`, { pasoId: paso.id, nivel: 'aviso' });
    return true;
  }

  const ctx: ContextoPaso = {
    paso,
    pedido,
    comercio,
    ia: { pedidoId: pedido.id, pasoId: paso.id, vence: hasta },
    esfuerzo: (normal) => (paso.intento >= 2 ? 'low' : normal),
    registrar: (mensaje, op) => registrarEvento(pedido.id, mensaje, { pasoId: paso.id, ...op }),
  };

  await ctx.registrar(`Empieza: ${NOMBRE_PASO[tipo]}${paso.intento > 1 ? ` (intento ${paso.intento})` : ''}.`);
  try {
    const r = await agente(ctx);
    const cerrado = revisar(
      await db().rpc('fab_cerrar_paso', {
        p_paso: paso.id,
        p_intento: paso.intento,
        p_estado: 'hecho',
        p_salida: r.salida,
        p_error: null,
        p_siguientes: (r.siguientes ?? []) as unknown as Json,
        p_previa: (r.previa ?? null) as unknown as Json,
        p_pedido_estado: r.pedidoEstado ?? null,
        p_pedido_etapa: r.pedidoEtapa ?? null,
        p_esperar_tipos: r.esperarTipos ?? null,
      }),
      'cerrar paso',
    );
    if (!cerrado) {
      await ctx.registrar('El paso terminó tarde: otro trabajador ya lo había retomado. Se descarta este resultado.', { nivel: 'aviso' });
      return true;
    }
    await ctx.registrar(r.resumen);
    if (pedido.simulado && pedido.auto_aprobar) await autoResolverPrevias(pedido.id);
  } catch (e) {
    const error = e instanceof ErrorPaso ? e : new ErrorPaso(e instanceof Error ? e.message : String(e), true, 60);
    console.error(`Paso ${tipo} (${paso.id}) falló:`, error.message);
    if (error.reintentable && paso.intento < paso.max_intentos) {
      const espera = Math.min(error.esperaSeg * paso.intento, 900);
      await db().rpc('fab_reprogramar_paso', { p_paso: paso.id, p_intento: paso.intento, p_error: error.message, p_segundos: espera });
      await ctx.registrar(`Falló el intento ${paso.intento}, se reintenta en ${espera} s: ${error.message}`, { nivel: 'aviso' });
    } else {
      await db().rpc('fab_fallo_generico', { p_paso: paso.id, p_error: error.message });
    }
  }
  return true;
}
