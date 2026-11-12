// Parte automático para Pedrito: tres líneas + métricas + capturas, por el webhook de su rutina
// «Parte automático Fábrica». Se manda SOLO si cambió algo o hay un error nuevo respecto del último parte.
import { db } from '../supabase';
import type { Json } from '../tipos-db';
import { armarCapturas, type Captura } from './capturas';
import { type EstadoFabrica, firmaEstado, leerEstado, OBJETIVO, sinSecretos } from './estado';

export type CuerpoParte = {
  tipo: 'parte';
  motivo: 'cambio_estado' | 'error';
  fecha: string;
  resumen: [string, string, string];
  metricas: { placas_hechas: number; negocios_activos: number; objetivo_placas: number; objetivo_negocios: number; fecha_objetivo: string };
  gemini_a4: { estado: 'ok' | 'error' | 'no_verificado'; detalle: string };
  errores: { donde: string; mensaje: string; agente: 'ideas' | 'diseno' | 'estructura' | 'produccion' | 'app' }[];
  capturas: Captura[];
  /** Solo en el envío de prueba que se dispara a mano desde Ajustes. */
  prueba?: true;
};

/** ISO 8601 con la zona de Buenos Aires (UTC−3 todo el año, sin horario de verano). */
export function fechaBuenosAires(ahora = new Date()) {
  return new Date(ahora.getTime() - 3 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, '-03:00');
}

function diasHasta(fecha: string, ahora = new Date()) {
  const fin = new Date(`${fecha}T23:59:59-03:00`).getTime();
  return Math.max(0, Math.ceil((fin - ahora.getTime()) / 86_400_000));
}

export function armarResumen(e: EstadoFabrica, ahora = new Date()): [string, string, string] {
  const linea1 = `Placas hechas ${e.placas_hechas}/${OBJETIVO.placas} y negocios activos ${e.negocios_activos}/${OBJETIVO.negocios}; faltan ${Math.max(0, OBJETIVO.placas - e.placas_hechas)} placas y ${Math.max(0, OBJETIVO.negocios - e.negocios_activos)} negocios, quedan ${diasHasta(OBJETIVO.fecha, ahora)} días al 31/12/2026.`;
  const linea2 = e.errores.length
    ? `${e.errores.length} error${e.errores.length === 1 ? '' : 'es'}: ${e.errores
        .slice(0, 3)
        .map((x) => `${x.donde} (${x.agente}): ${x.mensaje}`)
        .join(' | ')}${e.errores.length > 3 ? ` | y ${e.errores.length - 3} más` : ''}`
    : 'sin errores';
  const estado = { ok: 'funciona', error: 'no funciona', no_verificado: 'no se pudo verificar' }[e.gemini_a4.estado];
  const linea3 = `Generación del A4 con Gemini: ${estado}, ${e.gemini_a4.detalle}.`;
  return [linea1, linea2.length > 600 ? `${linea2.slice(0, 599)}…` : linea2, linea3];
}

/** Motivo: «error» si apareció un error que no estaba en el último parte; si no, «cambio_estado». */
export function motivoDe(e: EstadoFabrica, anteriores: string[]): CuerpoParte['motivo'] {
  const antes = new Set(anteriores);
  return e.errores.some((x) => !antes.has(x.clave)) ? 'error' : 'cambio_estado';
}

export function armarCuerpo(e: EstadoFabrica, capturas: Captura[], motivo: CuerpoParte['motivo'], ahora = new Date()): CuerpoParte {
  return {
    tipo: 'parte',
    motivo,
    fecha: fechaBuenosAires(ahora),
    resumen: armarResumen(e, ahora),
    metricas: {
      placas_hechas: e.placas_hechas,
      negocios_activos: e.negocios_activos,
      objetivo_placas: OBJETIVO.placas,
      objetivo_negocios: OBJETIVO.negocios,
      fecha_objetivo: OBJETIVO.fecha,
    },
    gemini_a4: e.gemini_a4,
    errores: e.errores.map(({ donde, mensaje, agente }) => ({ donde, mensaje, agente })),
    capturas,
  };
}

export type ResultadoParte =
  | { enviado: true; motivo: CuerpoParte['motivo']; resumen: string[]; capturas: number }
  | { enviado: false; razon: 'sin_cambios' | 'sin_configurar' | 'fallo_envio' | 'sin_base'; detalle: string };

function webhook() {
  const url = process.env.PARTE_WEBHOOK_URL?.trim();
  const secreto = process.env.PARTE_WEBHOOK_SECRET?.trim();
  return url && secreto ? { url, secreto } : null;
}

async function anotar(campos: Record<string, unknown>) {
  const { error } = await db().from('fab_parte_ultimo').update({ ...campos, updated_at: new Date().toISOString() }).eq('id', 1);
  if (error) console.error('Parte: no se pudo anotar el último parte:', error.message);
}

/** Claves de los errores del último parte enviado (para saber si hay uno nuevo). */
async function erroresDelUltimo(): Promise<string[]> {
  const { data } = await db().from('fab_parte_ultimo').select('parte').eq('id', 1).maybeSingle();
  const p = data?.parte as { _claves?: unknown } | null;
  return Array.isArray(p?._claves) ? p._claves.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Mira el estado y, si cambió respecto del último parte (o hay un error nuevo), le manda el parte a Pedrito.
 * `forzar` (solo desde Ajustes, con tu sesión) manda aunque no haya cambios y lo marca como prueba.
 * Nunca genera imágenes con Gemini ni escribe secretos en los logs.
 */
export async function revisarYMandarParte(op: { forzar?: boolean; origen: string }): Promise<ResultadoParte> {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return { enviado: false, razon: 'sin_configurar', detalle: 'El parte sale solo desde Producción.' };
  }
  const destino = webhook();
  if (!destino) {
    // Sin las variables no se toma el turno: cuando las cargues, el primer chequeo manda el parte.
    return { enviado: false, razon: 'sin_configurar', detalle: 'Faltan PARTE_WEBHOOK_URL o PARTE_WEBHOOK_SECRET en Vercel.' };
  }
  const estado = await leerEstado();
  if (!estado.base) {
    // Sin base no se puede deduplicar: se informa solo en el chequeo, sin mandar en cada vuelta.
    console.error('Parte: no se pudo leer Supabase.');
    return { enviado: false, razon: 'sin_base', detalle: estado.errores[0]?.mensaje ?? 'sin base' };
  }
  const firma = firmaEstado(estado);
  const { data: reclamo, error } = await db().rpc('fab_parte_reclamar', { p_firma: firma, p_forzar: !!op.forzar });
  if (error) throw new Error(`Parte: no se pudo comparar con el último: ${error.message}`);
  const r = reclamo?.[0];
  if (!r?.reclamado) return { enviado: false, razon: 'sin_cambios', detalle: 'Nada cambió desde el último parte.' };

  const anteriores = await erroresDelUltimo();
  const ahora = new Date();
  const sello = fechaBuenosAires(ahora).replace(/[:]/g, '-');
  const { capturas, fallos } = await armarCapturas(estado, fechaBuenosAires(ahora).slice(0, 16).replace('T', ' '), sello);
  for (const f of fallos) console.error('Parte:', f);
  const cuerpo = armarCuerpo(estado, capturas, motivoDe(estado, anteriores), ahora);
  if (op.forzar) cuerpo.prueba = true;

  let falla: string | null = null;
  try {
    const res = await fetch(destino.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${destino.secreto}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const texto = sinSecretos((await res.text().catch(() => '')).slice(0, 200));
      falla = `el webhook de Pedrito respondió ${res.status}${texto ? `: ${texto}` : ''}`;
    }
  } catch (e) {
    // Solo el tipo de error: ni la URL ni el secreto van al log.
    falla = `no se pudo llegar al webhook de Pedrito (${e instanceof Error ? e.name : 'error'})`;
  }

  if (falla) {
    // Se devuelve la huella anterior para que el próximo chequeo lo vuelva a intentar.
    await anotar({ firma: r.firma_anterior, error: falla, intento_at: ahora.toISOString() });
    console.error('Parte:', falla);
    return { enviado: false, razon: 'fallo_envio', detalle: falla };
  }
  const guardado = { ...cuerpo, _claves: estado.errores.map((x) => x.clave), _origen: op.origen };
  await anotar({ parte: guardado as unknown as Json, motivo: cuerpo.motivo, enviado_at: ahora.toISOString(), error: null });
  return { enviado: true, motivo: cuerpo.motivo, resumen: cuerpo.resumen, capturas: capturas.length };
}

/** Para los disparos por eventos (motor): nunca rompe el paso que lo llamó. */
export async function parteSiCambio(origen: string) {
  try {
    const r = await revisarYMandarParte({ origen });
    if (r.enviado) console.log(`Parte enviado a Pedrito (${r.motivo}, ${origen}).`);
  } catch (e) {
    console.error('Parte:', e instanceof Error ? e.message : String(e));
  }
}
