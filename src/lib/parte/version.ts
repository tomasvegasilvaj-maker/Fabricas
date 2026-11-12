// Parte por cada imagen nueva: se le manda a Pedrito en el momento (prompt completo, trabajador, costo,
// n.º de pedido y de imagen, correcciones usadas y la imagen en base64, que no vence). La app no genera la
// imagen siguiente hasta que Pedrito conteste por /api/parte/revision, o se pasa el plazo y se le avisa a Tomi.
import sharp from 'sharp';
import { ErrorEspera, ErrorPaso, ErrorSinRespuesta } from '../ia/claude';
import { env } from '../env';
import type { ContextoPaso } from '../motor/tipos';
import { db } from '../supabase';
import type { Json, ParteVersionRow } from '../tipos-db';
import { fechaBuenosAires } from './parte';
import { sinSecretos } from './estado';

/** Cuánto se espera la respuesta de Pedrito antes de pausar el pedido (PEDRITO_ESPERA_SEG en Vercel, 5 min por defecto). */
export function esperaPedritoSeg() {
  const n = Number(process.env.PEDRITO_ESPERA_SEG);
  return Number.isFinite(n) && n >= 30 ? n : 300;
}

/** Cada cuánto se vuelve a mirar si Pedrito contestó. */
const REVISAR_CADA_SEG = 20;

function webhook() {
  const url = process.env.PARTE_WEBHOOK_URL?.trim();
  const secreto = process.env.PARTE_WEBHOOK_SECRET?.trim();
  return url && secreto ? { url, secreto } : null;
}

/** JPG de hasta 1280 px en base64: Pedrito la abre directo, sin links que venzan. */
export async function imagenParaPedrito(datos: Buffer) {
  const jpg = await sharp(datos).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#FFFFFF' }).jpeg({ quality: 82 }).toBuffer();
  return { mime: 'image/jpeg', base64: jpg.toString('base64') };
}

export type DatosParteVersion = {
  versionId: string;
  versionNumero: number;
  ronda: number;
  trabajador: string;
  prompt: string;
  costoUsd: number;
  correcciones: { id: string; orden: number; texto: string }[];
  reglas: string[];
  baseVersionNumero: number | null;
  baseVersionId: string | null;
  imagen: Buffer;
  imagenPath: string;
  vista: Buffer;
  vistaPath: string;
};

export function armarCuerpoVersion(ctx: Pick<ContextoPaso, 'pedido' | 'comercio'>, d: DatosParteVersion, gasto: number, imagenes: { placa: unknown; fondo: unknown }) {
  return {
    tipo: 'parte_version',
    motivo: 'nueva_version',
    fecha: fechaBuenosAires(),
    pedido: { id: ctx.pedido.id, numero: ctx.pedido.numero, comercio: ctx.comercio.nombre, rubro: ctx.comercio.rubro },
    version: { id: d.versionId, numero: d.versionNumero, ronda: d.ronda, parte_de_version: d.baseVersionNumero },
    trabajador: d.trabajador,
    prompt: d.prompt,
    costo_paso_usd: Math.round(d.costoUsd * 10_000) / 10_000,
    gasto_pedido_usd: Math.round(gasto * 10_000) / 10_000,
    tope_pedido_usd: Number(ctx.pedido.tope_usd),
    correcciones_tomi: d.correcciones.map((c) => ({ id: c.id, orden: c.orden, texto: c.texto })),
    correcciones_usadas: d.correcciones.map((c) => c.id),
    reglas_del_trabajador: d.reglas,
    imagen_placa: imagenes.placa,
    imagen_fondo: imagenes.fondo,
    responder_a: `${env.appUrl}/api/parte/revision`,
    responder_antes_de_seg: esperaPedritoSeg(),
  };
}

/** Guarda el parte de la versión (Pedrito lo puede leer con su usuario de solo lectura) y se lo manda. */
export async function mandarParteVersion(ctx: ContextoPaso, d: DatosParteVersion): Promise<ParteVersionRow | null> {
  if (ctx.pedido.simulado) return null;
  const { data: pedido } = await db().from('fab_pedidos').select('gasto_usd').eq('id', ctx.pedido.id).single();
  const gasto = Number(pedido?.gasto_usd ?? ctx.pedido.gasto_usd);
  const destino = webhook();
  const fila = {
    pedido_id: ctx.pedido.id,
    version_id: d.versionId,
    pedido_numero: ctx.pedido.numero,
    version_numero: d.versionNumero,
    trabajador: d.trabajador,
    prompt: d.prompt,
    costo_usd: d.costoUsd,
    gasto_pedido_usd: gasto,
    correcciones_usadas: d.correcciones.map((c) => c.id),
    base_version_id: d.baseVersionId,
    imagen_path: d.imagenPath,
    vista_path: d.vistaPath,
    respuesta: destino ? ('pendiente' as const) : ('no_enviado' as const),
    envio_error: destino ? null : 'Faltan PARTE_WEBHOOK_URL o PARTE_WEBHOOK_SECRET en Vercel.',
  };
  const { data: parte, error } = await db().from('fab_partes_version').upsert(fila, { onConflict: 'version_id' }).select('*').single();
  if (error || !parte) {
    await ctx.registrar(`No se pudo guardar el parte de la versión ${d.versionNumero}: ${error?.message ?? 'sin datos'}`, { nivel: 'aviso' });
    return null;
  }
  if (!destino) {
    await ctx.registrar('El parte de la versión no salió: faltan las variables del webhook de Pedrito. Se sigue sin esperar su revisión.', { nivel: 'aviso' });
    return parte;
  }

  const cuerpo = armarCuerpoVersion(ctx, d, gasto, { placa: await imagenParaPedrito(d.vista), fondo: await imagenParaPedrito(d.imagen) });
  let falla: string | null = null;
  try {
    const res = await fetch(destino.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${destino.secreto}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) falla = `el webhook de Pedrito respondió ${res.status}: ${sinSecretos((await res.text().catch(() => '')).slice(0, 160))}`;
  } catch (e) {
    falla = `no se pudo llegar al webhook de Pedrito (${e instanceof Error ? e.name : 'error'})`;
  }
  const ahora = new Date().toISOString();
  await db()
    .from('fab_partes_version')
    .update(falla ? { respuesta: 'no_enviado', envio_error: falla } : { enviado_at: ahora, envio_error: null })
    .eq('id', parte.id);
  await ctx.registrar(
    falla
      ? `No se pudo mandar la versión ${d.versionNumero} a Pedrito (${falla}). Se sigue sin su revisión.`
      : `Se le mandó a Pedrito la versión ${d.versionNumero} con su prompt; la imagen siguiente espera su revisión.`,
    { nivel: falla ? 'aviso' : 'info' },
  );
  return { ...parte, enviado_at: falla ? null : ahora };
}

function textoAlertas(alertas: Json): string {
  if (!Array.isArray(alertas)) return '';
  return alertas
    .map((a) => {
      const x = (a ?? {}) as { tipo?: string; detalle?: string };
      return `${x.tipo === 'contradice_correccion' ? 'Contradice una corrección tuya' : x.tipo === 'trabajadores_se_pisan' ? 'Dos trabajadores se pisan' : 'Aviso'}: ${x.detalle ?? ''}`.trim();
    })
    .join(' ');
}

/**
 * Antes de generar una imagen: si Pedrito todavía no revisó la anterior, se espera (sin gastar intentos);
 * si avisó un problema o no contestó a tiempo, el pedido se frena y Tomi decide.
 */
export async function esperarRevisionDePedrito(ctx: ContextoPaso, ahora = Date.now()) {
  if (ctx.pedido.simulado) return;
  const { data: ultima } = await db()
    .from('fab_partes_version')
    .select('*')
    .eq('pedido_id', ctx.pedido.id)
    .eq('resuelta', false)
    .in('respuesta', ['pendiente', 'alerta', 'sin_respuesta'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultima) return;
  if (ultima.respuesta === 'alerta') {
    throw new ErrorPaso(`Pedrito avisó un problema en la versión ${ultima.version_numero} antes de generar la siguiente. ${textoAlertas(ultima.alertas)} Revisalo y, si querés seguir igual, tocá «Reintentar».`, false);
  }
  const desde = Date.parse(ultima.enviado_at ?? ultima.created_at);
  if (ultima.respuesta === 'pendiente' && ahora - desde < esperaPedritoSeg() * 1000) {
    throw new ErrorEspera(`Esperando que Pedrito revise la versión ${ultima.version_numero} antes de generar la siguiente.`, REVISAR_CADA_SEG);
  }
  if (ultima.respuesta === 'pendiente') await db().from('fab_partes_version').update({ respuesta: 'sin_respuesta' }).eq('id', ultima.id).eq('respuesta', 'pendiente');
  throw new ErrorSinRespuesta(
    `Pedrito no respondió la revisión de la versión ${ultima.version_numero} en ${Math.round(esperaPedritoSeg() / 60)} minutos. El pedido quedó en pausa: fijate qué pasó con Pedrito y tocá «Reintentar» para seguir.`,
  );
}

/** Tomi vio la alerta (o la falta de respuesta) y decidió seguir: se dejan de esperar las revisiones pendientes. */
export async function darPorVistasLasRevisiones(pedidoId: string) {
  await db().from('fab_partes_version').update({ resuelta: true }).eq('pedido_id', pedidoId).eq('resuelta', false);
}
