// Lo que mira el parte: números reales de Supabase, errores reales de la línea y un preflight de
// Gemini/A4 que NO genera imágenes (cada imagen cuesta plata).
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { modeloImagen, proveedorImagen, saldoImagenes, saldoMinimoUsd } from '../ia/gemini';
import { pdfA4DosPlacas } from '../placa/pdf';
import { db } from '../supabase';

export const OBJETIVO = { placas: 20, negocios: 10, fecha: '2026-12-31' } as const;

export type AgenteParte = 'ideas' | 'diseno' | 'estructura' | 'produccion' | 'app';
export type ErrorParte = { donde: string; mensaje: string; agente: AgenteParte; clave: string };
export type EstadoGemini = { estado: 'ok' | 'error' | 'no_verificado'; detalle: string };

export type PedidoParte = { id: string; numero: number; comercio: string; estado: string; etapa: string; linea: string };

export type EstadoFabrica = {
  base: boolean;
  placas_hechas: number;
  negocios_activos: number;
  pedidos: PedidoParte[];
  errores: ErrorParte[];
  gemini_a4: EstadoGemini;
  /** La última placa generada (para la captura de «generación de placa»). */
  ultima_vista: { path: string; comercio: string; numero: number } | null;
};

/** De qué agente es cada paso de la línea (clásica y equipo), para atribuir los fallos. */
export function agenteDelPaso(tipo: string): AgenteParte {
  if (['ideas', 'investigacion', 'inspiracion', 'conceptos'].includes(tipo)) return 'ideas';
  if (['diseno', 'boceto', 'elaboracion'].includes(tipo)) return 'diseno';
  if (['estructura', 'revision'].includes(tipo)) return 'estructura';
  if (['produccion', 'activacion', 'imprenta'].includes(tipo)) return 'produccion';
  return 'app';
}

function corto(t: string | null | undefined, max = 220) {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Saca de un mensaje cualquier cosa con pinta de clave (por si un error de un proveedor la repite). */
export function sinSecretos(t: string) {
  return t
    .replace(/(Bearer\s+)[\w.\-~+/=]{8,}/gi, '$1***')
    .replace(/\b(sk|sb|vck|AIza)[\w\-]{12,}/g, '***')
    .replace(/([?&](key|token|secret)=)[^&\s]+/gi, '$1***');
}

type FilaPedido = { id: string; numero: number; estado: string; etapa: string; linea: string; comercio_id: string; comercio: { nombre: string } | null };

/** El estado real: placas hechas, negocios activos, pedidos y errores (solo pedidos reales, no simulados). */
export async function leerEstado(opciones: { gemini?: () => Promise<EstadoGemini> } = {}): Promise<EstadoFabrica> {
  const errores: ErrorParte[] = [];
  const gemini = (opciones.gemini ?? chequearGeminiA4)();

  const pedidosR = await db()
    .from('fab_pedidos')
    .select('id, numero, estado, etapa, linea, comercio_id, comercio:fab_comercios(nombre)')
    .eq('simulado', false)
    .order('numero');
  if (pedidosR.error) {
    errores.push({ donde: 'Supabase', mensaje: `No se pudo leer el estado de la fábrica: ${corto(pedidosR.error.message)}`, agente: 'app', clave: 'base' });
    return { base: false, placas_hechas: 0, negocios_activos: 0, pedidos: [], errores, gemini_a4: await gemini, ultima_vista: null };
  }
  const filas = (pedidosR.data ?? []) as unknown as FilaPedido[];
  const nombre = new Map(filas.map((p) => [p.id, p.comercio?.nombre ?? 'sin nombre']));
  const ids = filas.map((p) => p.id);

  // Placa hecha = pedido real terminado («listo»: PDF armado, QR verificado y link probado).
  const placas = filas.filter((p) => p.estado === 'listo').length;
  // Negocio activo = comercio con algún pedido real que no esté cancelado ni fallido.
  const negocios = new Set(filas.filter((p) => !['cancelado', 'fallido'].includes(p.estado)).map((p) => p.comercio_id)).size;

  if (ids.length) {
    const [previas, pasos] = await Promise.all([
      db().from('fab_previas').select('id, pedido_id, tipo, titulo, detalle, datos').eq('estado', 'pendiente').in('tipo', ['fallo', 'tope_gasto']).in('pedido_id', ids),
      db()
        .from('fab_pasos')
        .select('id, pedido_id, tipo, error, terminado_at')
        .eq('estado', 'fallido')
        .in('pedido_id', ids)
        .gte('terminado_at', new Date(Date.now() - 24 * 3_600_000).toISOString()),
    ]);
    const pasosConPrevia = new Set<string>();
    for (const p of previas.data ?? []) {
      const d = (p.datos ?? {}) as Record<string, unknown>;
      const tipoPaso = typeof d.tipo === 'string' ? d.tipo : '';
      if (typeof d.paso_id === 'string') pasosConPrevia.add(d.paso_id);
      errores.push({
        donde: `Pedido ${nombre.get(p.pedido_id)}${tipoPaso ? ` · ${tipoPaso}` : ''}`,
        mensaje: corto(`${p.titulo}${p.detalle ? `: ${p.detalle}` : ''}`),
        agente: p.tipo === 'tope_gasto' ? 'app' : agenteDelPaso(tipoPaso),
        clave: `previa:${p.id}`,
      });
    }
    for (const s of pasos.data ?? []) {
      if (pasosConPrevia.has(s.id)) continue;
      errores.push({ donde: `Pedido ${nombre.get(s.pedido_id)} · paso ${s.tipo}`, mensaje: corto(s.error ?? 'falló sin detalle'), agente: agenteDelPaso(s.tipo), clave: `paso:${s.id}` });
    }
    if (previas.error || pasos.error) {
      errores.push({ donde: 'Supabase', mensaje: `No se pudieron leer los fallos: ${corto(previas.error?.message ?? pasos.error?.message)}`, agente: 'app', clave: 'base-fallos' });
    }
  }

  const g = await gemini;
  // Aviso antes de quedarse sin saldo de imágenes (el de Anthropic no se puede consultar por API).
  const saldo = opciones.gemini ? null : await saldoImagenes().catch(() => null);
  if (saldo?.saldo !== null && saldo?.saldo !== undefined && saldo.saldo < saldoMinimoUsd()) {
    errores.push({ donde: 'Saldo de imágenes (Vercel AI Gateway)', mensaje: `Queda poco saldo: ${saldo.detalle} (aviso por debajo de US$ ${saldoMinimoUsd().toFixed(2)}).`, agente: 'app', clave: 'saldo-bajo' });
  }
  if (g.estado === 'error') errores.push({ donde: 'Generación del A4 (Gemini + pdf-lib)', mensaje: g.detalle, agente: 'produccion', clave: `gemini:${g.detalle.slice(0, 40)}` });

  const { data: version } = ids.length
    ? await db().from('fab_versiones').select('preview_path, pedido_id, numero').in('pedido_id', ids).not('preview_path', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const pedidoVersion = version ? filas.find((p) => p.id === version.pedido_id) : undefined;

  return {
    base: true,
    placas_hechas: placas,
    negocios_activos: negocios,
    pedidos: filas.map((p) => ({ id: p.id, numero: p.numero, comercio: nombre.get(p.id)!, estado: p.estado, etapa: p.etapa, linea: p.linea })),
    errores: errores.map((e) => ({ ...e, mensaje: sinSecretos(e.mensaje) })),
    gemini_a4: { ...g, detalle: sinSecretos(g.detalle) },
    ultima_vista: version?.preview_path ? { path: version.preview_path, comercio: nombre.get(version.pedido_id) ?? '', numero: pedidoVersion?.numero ?? 0 } : null,
  };
}

/** Huella del estado: si no cambia, no se manda parte. No lleva fechas ni textos que cambien solos. */
export function firmaEstado(e: EstadoFabrica): string {
  const base = {
    base: e.base,
    placas: e.placas_hechas,
    negocios: e.negocios_activos,
    // Solo el estado de cada pedido (no la etapa): pasar de un agente a otro no es un cambio que valga un parte.
    pedidos: e.pedidos.map((p) => [p.id, p.estado]),
    errores: e.errores.map((x) => x.clave).sort(),
    gemini: e.gemini_a4.estado,
  };
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

// ───────────────────────── Preflight de Gemini / A4 ─────────────────────────

let cacheGemini: { valor: EstadoGemini; hasta: number } | null = null;

/** Consulta gratis si la clave de imágenes anda (no genera ninguna imagen). */
async function claveDeImagenes(): Promise<{ ok: boolean | null; detalle: string }> {
  const proveedor = proveedorImagen();
  const modelo = modeloImagen(proveedor);
  try {
    if (proveedor === 'gateway') {
      const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', {
        headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY!.trim()}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (r.status === 401 || r.status === 403) return { ok: false, detalle: `el AI Gateway rechazó AI_GATEWAY_API_KEY (${r.status})` };
      if (!r.ok) return { ok: null, detalle: `el AI Gateway no informó el crédito (${r.status})` };
      const cuerpo = (await r.json().catch(() => ({}))) as { balance?: string | number };
      const saldo = Number(cuerpo.balance);
      if (Number.isFinite(saldo) && saldo <= 0) return { ok: false, detalle: 'el AI Gateway de Vercel no tiene crédito (saldo 0)' };
      return { ok: true, detalle: `clave del AI Gateway aceptada${Number.isFinite(saldo) ? `, saldo US$ ${saldo.toFixed(2)}` : ''}, modelo ${modelo}` };
    }
    if (proveedor === 'google') {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}`, {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!.trim() },
        signal: AbortSignal.timeout(8_000),
      });
      if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, detalle: `Google rechazó GEMINI_API_KEY (${r.status})` };
      if (r.status === 404) return { ok: false, detalle: `Google no encuentra el modelo ${modelo}` };
      if (!r.ok) return { ok: null, detalle: `Google no respondió bien (${r.status})` };
      return { ok: true, detalle: `GEMINI_API_KEY aceptada por Google, modelo ${modelo}` };
    }
    return { ok: false, detalle: 'falta AI_GATEWAY_API_KEY o GEMINI_API_KEY en Vercel' };
  } catch (e) {
    return { ok: null, detalle: `no se pudo consultar la clave (${corto(e instanceof Error ? e.message : String(e), 80)})` };
  }
}

/** Arma un A4 de prueba con pdf-lib a partir de una imagen lisa: prueba el código del PDF sin llamar a Gemini. */
export async function pdfEnSeco(): Promise<number> {
  const jpg = await sharp({ create: { width: 118, height: 177, channels: 3, background: '#f4efe6' } }).jpeg().toBuffer();
  const pdf = await pdfA4DosPlacas(jpg, { titulo: 'Prueba del parte', pasos: ['Prueba en seco'], datos: [{ etiqueta: 'QR', valor: 'prueba' }] });
  if (pdf.byteLength < 500) throw new Error('el PDF de prueba salió vacío');
  return pdf.byteLength;
}

/** Errores reales de imagen en pedidos reales (últimas 24 h), para no decir «ok» si en producción falló. */
async function falloRealDeImagen(): Promise<string | null> {
  const { data } = await db()
    .from('fab_pasos')
    .select('error, terminado_at, fab_pedidos!inner(simulado)')
    .in('tipo', ['diseno', 'produccion'])
    .eq('fab_pedidos.simulado', false)
    .not('error', 'is', null)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(10);
  const f = (data ?? []).find((p) => /gemini|gateway|imagen|pdf/i.test(p.error ?? ''));
  return f?.error ? corto(f.error, 160) : null;
}

/**
 * Si la generación del A4 está en condiciones: clave de imágenes cargada y aceptada (consulta gratis),
 * PDF A4 de dos placas armado en seco y sin fallos reales recientes. No genera ninguna imagen.
 */
export async function chequearGeminiA4(): Promise<EstadoGemini> {
  if (cacheGemini && cacheGemini.hasta > Date.now()) return cacheGemini.valor;
  let valor: EstadoGemini;
  try {
    await pdfEnSeco();
  } catch (e) {
    valor = { estado: 'error', detalle: `el armado del PDF A4 falló en seco: ${corto(e instanceof Error ? e.message : String(e), 120)}` };
    cacheGemini = { valor, hasta: Date.now() + 10 * 60_000 };
    return valor;
  }
  const [clave, real] = await Promise.all([claveDeImagenes(), falloRealDeImagen().catch(() => null)]);
  if (clave.ok === false) valor = { estado: 'error', detalle: clave.detalle };
  else if (real) valor = { estado: 'error', detalle: `fallo real en producción: ${real}` };
  else if (clave.ok === null) valor = { estado: 'no_verificado', detalle: `PDF A4 armado en seco, pero ${clave.detalle}` };
  else valor = { estado: 'ok', detalle: `${clave.detalle}; PDF A4 armado en seco; sin generar imagen` };
  cacheGemini = { valor, hasta: Date.now() + 10 * 60_000 };
  return valor;
}
