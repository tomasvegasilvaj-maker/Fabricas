import { db, registrarEvento, revisar } from '../supabase';
import type { Json, PreviaRow, VersionRow } from '../tipos-db';
import type { EstadoPedido, Etapa, Siguiente } from './tipos';
import { guardarLogoOriginal } from './pedidos';

export const EXTRA_TOPE_USD = 1.5;

async function leerPrevia(id: string, tipos: string[]): Promise<PreviaRow> {
  const previa = revisar(await db().from('fab_previas').select('*').eq('id', id).single(), 'leer previa');
  if (!tipos.includes(previa.tipo)) throw new Error(`Esta Previa es de tipo «${previa.tipo}».`);
  if (previa.estado !== 'pendiente') throw new Error('Esta Previa ya estaba resuelta.');
  return previa;
}

async function resolver(
  previa: PreviaRow,
  respuesta: Json,
  siguientes: Siguiente[] = [],
  estado?: EstadoPedido,
  etapa?: Etapa,
): Promise<boolean> {
  return revisar(
    await db().rpc('fab_resolver_previa', {
      p_previa: previa.id,
      p_respuesta: respuesta,
      p_siguientes: siguientes as unknown as Json,
      p_pedido_estado: estado ?? null,
      p_pedido_etapa: etapa ?? null,
    }),
    'resolver previa',
  );
}

function datos(previa: PreviaRow): Record<string, unknown> {
  return previa.datos && typeof previa.datos === 'object' && !Array.isArray(previa.datos) ? (previa.datos as Record<string, unknown>) : {};
}

export function urlValida(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function guardarPreferencia(texto: string, pedidoId: string) {
  const { data: pedido } = await db().from('fab_pedidos').select('comercio_id').eq('id', pedidoId).single();
  const { data: comercio } = pedido ? await db().from('fab_comercios').select('rubro').eq('id', pedido.comercio_id).single() : { data: null };
  await db().from('fab_preferencias').insert({ tipo: 'gusto', texto: texto.slice(0, 600), rubro: comercio?.rubro ?? null, origen: 'previa' });
}

async function descartarFallos(pedidoId: string, tipoPaso: string) {
  await db()
    .from('fab_previas')
    .update({ estado: 'descartada', resuelta_at: new Date().toISOString() })
    .eq('pedido_id', pedidoId)
    .eq('tipo', 'fallo')
    .eq('estado', 'pendiente')
    .contains('datos', { tipo: tipoPaso });
}

async function ultimaVersionDe(conceptoId: string): Promise<VersionRow | null> {
  const { data } = await db()
    .from('fab_versiones')
    .select('*')
    .eq('concepto_id', conceptoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Elegís una de las ideas. Con comentario (o si el boceto tiene errores técnicos) pasa por elaboración. */
export async function elegirConcepto(previaId: string, op: { conceptoId: string; comentario?: string | null; recordar?: boolean }) {
  const previa = await leerPrevia(previaId, ['elegir_concepto']);
  const concepto = revisar(
    await db().from('fab_conceptos').select('*').eq('id', op.conceptoId).eq('pedido_id', previa.pedido_id).single(),
    'leer concepto',
  );
  const version = await ultimaVersionDe(concepto.id);
  if (!version) throw new Error('Esa idea no tiene boceto todavía.');
  const comentario = op.comentario?.trim() || null;
  const errores = ((version.chequeo as { errores?: string[] } | null)?.errores ?? []).length;
  const elaborar = !!comentario || errores > 0;

  await db().from('fab_conceptos').update({ elegido: false }).eq('pedido_id', previa.pedido_id);
  await db().from('fab_conceptos').update({ elegido: true }).eq('id', concepto.id);
  await db().from('fab_pedidos').update({ concepto_id: concepto.id, ronda: 0 }).eq('id', previa.pedido_id);

  const ok = await resolver(
    previa,
    { concepto_id: concepto.id, comentario, recordar: !!op.recordar },
    elaborar
      ? [{ tipo: 'elaboracion', entrada: { version_id: version.id, comentario } }]
      : [{ tipo: 'revision', entrada: { version_id: version.id } }],
    'en_marcha',
    elaborar ? 'elaboracion' : 'revision',
  );
  if (!ok) return false;
  await descartarFallos(previa.pedido_id, 'boceto');
  if (op.recordar && comentario) await guardarPreferencia(comentario, previa.pedido_id);
  await registrarEvento(previa.pedido_id, `Elegiste la idea «${concepto.titulo}»${comentario ? ` con el comentario: ${comentario}` : ''}.`);
  return true;
}

/** Ninguna idea sirve: se piden tres nuevas, con tu comentario como guía. */
export async function rehacerConceptos(previaId: string, op: { comentario?: string | null; recordar?: boolean }) {
  const previa = await leerPrevia(previaId, ['elegir_concepto']);
  const comentario = op.comentario?.trim() || null;
  const ok = await resolver(previa, { rehacer: true, comentario }, [{ tipo: 'conceptos', entrada: { feedback: comentario } }], 'en_marcha', 'conceptos');
  if (ok && op.recordar && comentario) await guardarPreferencia(comentario, previa.pedido_id);
  if (ok) await registrarEvento(previa.pedido_id, `Pediste ideas nuevas${comentario ? `: ${comentario}` : '.'}`);
  return ok;
}

/** Aprobás la placa final: se activa el QR con el link y se arman los archivos. */
export async function aprobarFinal(previaId: string, op: { destino: string }) {
  const previa = await leerPrevia(previaId, ['aprobar_final']);
  const destino = urlValida(op.destino);
  if (!destino) throw new Error('El link de destino no es válido (tiene que empezar con https://).');
  const versionId = String(datos(previa).version_id ?? '');
  if (!versionId) throw new Error('A la Previa le falta la versión a aprobar.');
  const ok = await resolver(previa, { aprobada: true, destino }, [{ tipo: 'activacion', entrada: { version_id: versionId, destino } }], 'en_marcha', 'activacion');
  if (ok) await registrarEvento(previa.pedido_id, `Aprobaste la placa. Destino: ${destino}`);
  return ok;
}

/** Pedís cambios sobre la placa final: vuelve a elaboración y a revisión. */
export async function pedirCambios(previaId: string, op: { comentario: string; recordar?: boolean }) {
  const previa = await leerPrevia(previaId, ['aprobar_final']);
  const comentario = op.comentario.trim();
  if (!comentario) throw new Error('Escribí qué cambiar.');
  const versionId = String(datos(previa).version_id ?? '');
  await db().from('fab_pedidos').update({ ronda: 0 }).eq('id', previa.pedido_id);
  const ok = await resolver(previa, { cambios: comentario }, [{ tipo: 'elaboracion', entrada: { version_id: versionId, comentario } }], 'en_marcha', 'elaboracion');
  if (ok && op.recordar) await guardarPreferencia(comentario, previa.pedido_id);
  if (ok) await registrarEvento(previa.pedido_id, `Pediste cambios: ${comentario}`);
  return ok;
}

export async function seguirConTope(previaId: string, extra = EXTRA_TOPE_USD) {
  const previa = await leerPrevia(previaId, ['tope_gasto']);
  const pedido = revisar(await db().from('fab_pedidos').select('tope_usd').eq('id', previa.pedido_id).single(), 'leer pedido');
  await db().from('fab_pedidos').update({ tope_usd: Number(pedido.tope_usd) + extra }).eq('id', previa.pedido_id);
  const ok = await resolver(previa, { extra }, [], 'en_marcha');
  if (ok) await registrarEvento(previa.pedido_id, `Subiste el tope de gasto en US$ ${extra.toFixed(2)}.`);
  return ok;
}

/** Vuelve a encolar el paso que falló, con la misma entrada. */
export async function reintentarFallo(previaId: string) {
  const previa = await leerPrevia(previaId, ['fallo']);
  const pasoId = String(datos(previa).paso_id ?? '');
  const paso = revisar(await db().from('fab_pasos').select('tipo, entrada').eq('id', pasoId).single(), 'leer paso');
  const ok = await resolver(previa, { accion: 'reintentar' }, [{ tipo: paso.tipo as Siguiente['tipo'], entrada: paso.entrada }], 'en_marcha');
  if (ok) await registrarEvento(previa.pedido_id, `Reintentaste el paso ${paso.tipo}.`);
  return ok;
}

/** Un boceto falló: se sigue con los otros. */
export async function seguirSinBoceto(previaId: string) {
  const previa = await leerPrevia(previaId, ['fallo']);
  if (datos(previa).tipo !== 'boceto') throw new Error('Solo se puede seguir sin el paso cuando es un boceto.');
  const { count } = await db()
    .from('fab_pasos')
    .select('id', { count: 'exact', head: true })
    .eq('pedido_id', previa.pedido_id)
    .eq('tipo', 'boceto')
    .in('estado', ['pendiente', 'corriendo']);
  const quedan = (count ?? 0) > 0;
  const ok = await resolver(previa, { accion: 'seguir_sin_boceto' }, [], quedan ? 'en_marcha' : 'en_espera', quedan ? 'bocetos' : 'eleccion');
  if (ok && !quedan) {
    const { data: ultimo } = await db()
      .from('fab_conceptos')
      .select('tanda')
      .eq('pedido_id', previa.pedido_id)
      .order('tanda', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db().from('fab_previas').insert({
      pedido_id: previa.pedido_id,
      tipo: 'elegir_concepto',
      titulo: 'Elegí la idea',
      detalle: 'Uno de los bocetos falló; elegí entre los que salieron.',
      datos: { tanda: ultimo?.tanda ?? 1 },
    });
    // 23505: ya había una Previa de elección pendiente (la dejó el último boceto).
    if (error && error.code !== '23505') throw new Error(`No se pudo crear la Previa: ${error.message}`);
  }
  return ok;
}

/** Faltaba el logo: se sube y vuelve a arrancar la recepción. */
export async function completarLogo(previaId: string, logo: { datos: Buffer; mime: string; nombre?: string }) {
  const previa = await leerPrevia(previaId, ['falta_dato', 'fallo']);
  const pedido = revisar(await db().from('fab_pedidos').select('comercio_id').eq('id', previa.pedido_id).single(), 'leer pedido');
  await guardarLogoOriginal(pedido.comercio_id, logo, previa.pedido_id);
  const ok = await resolver(previa, { logo: true }, [{ tipo: 'intake' }], 'en_marcha', 'intake');
  if (ok) await registrarEvento(previa.pedido_id, 'Subiste el logo.');
  return ok;
}

/** Faltaba el link de destino para activar el QR. */
export async function completarDestino(previaId: string, destino: string) {
  const previa = await leerPrevia(previaId, ['falta_dato']);
  const url = urlValida(destino);
  if (!url) throw new Error('El link no es válido (tiene que empezar con https://).');
  const versionId = String(datos(previa).version_id ?? '');
  const ok = await resolver(previa, { destino: url }, [{ tipo: 'activacion', entrada: { version_id: versionId, destino: url } }], 'en_marcha', 'activacion');
  if (ok) await registrarEvento(previa.pedido_id, `Completaste el link de destino: ${url}`);
  return ok;
}

export async function cancelarPedido(pedidoId: string) {
  const ahora = new Date().toISOString();
  await db().from('fab_pedidos').update({ estado: 'cancelado', terminado_at: ahora }).eq('id', pedidoId);
  await db().from('fab_previas').update({ estado: 'descartada', resuelta_at: ahora }).eq('pedido_id', pedidoId).eq('estado', 'pendiente');
  await db().from('fab_pasos').update({ estado: 'cancelado', terminado_at: ahora }).eq('pedido_id', pedidoId).eq('estado', 'pendiente');
  await registrarEvento(pedidoId, 'Cancelaste el pedido.');
}

export async function pausarPedido(pedidoId: string) {
  await db().from('fab_pedidos').update({ estado: 'pausado' }).eq('id', pedidoId).in('estado', ['en_marcha', 'en_espera']);
  await registrarEvento(pedidoId, 'Pausaste el pedido.');
}

export async function reanudarPedido(pedidoId: string) {
  const { count } = await db()
    .from('fab_previas')
    .select('id', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)
    .eq('estado', 'pendiente');
  await db()
    .from('fab_pedidos')
    .update({ estado: (count ?? 0) > 0 ? 'en_espera' : 'en_marcha' })
    .eq('id', pedidoId)
    .eq('estado', 'pausado');
  await registrarEvento(pedidoId, 'Reanudaste el pedido.');
}

/** Pedidos de prueba con auto-aprobación: la fábrica elige sola, para probar el circuito sin gastar. */
export async function autoResolverPrevias(pedidoId: string) {
  const { data: previas } = await db().from('fab_previas').select('*').eq('pedido_id', pedidoId).eq('estado', 'pendiente');
  for (const p of previas ?? []) {
    const d = datos(p);
    if (p.tipo === 'elegir_concepto') {
      const { data: concepto } = await db()
        .from('fab_conceptos')
        .select('id')
        .eq('pedido_id', pedidoId)
        .eq('tanda', Number(d.tanda ?? 1))
        .order('indice')
        .limit(1)
        .maybeSingle();
      if (concepto) await elegirConcepto(p.id, { conceptoId: concepto.id });
    } else if (p.tipo === 'aprobar_final') {
      await aprobarFinal(p.id, { destino: String(d.destino_sugerido ?? '') || 'https://example.com/placa-de-prueba' });
    } else if (p.tipo === 'falta_dato' && d.campo === 'destino') {
      await completarDestino(p.id, 'https://example.com/placa-de-prueba');
    } else if (p.tipo === 'tope_gasto') {
      await seguirConTope(p.id);
    }
  }
}
