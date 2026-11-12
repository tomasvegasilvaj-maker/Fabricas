import sharp from 'sharp';
import { OBJETIVOS, urlQr } from '../../motor/flujo';
import type { Agente } from '../../motor/tipos';
import { pdfA4DosPlacas } from '../../placa/pdf';
import { componerPlaca, sinSangrado } from '../../placa/plantilla';
import { anchoParaDpi } from '../../placa/render';
import { bajarArchivo, db, registrarArchivo, revisar, subirArchivo } from '../../supabase';
import type { Json } from '../../tipos-db';
import { entrada, leerVersion, logoDelComercio } from '../comun';
import { leerCorreccion, reglasDelAgente } from './comun';

export type VerificacionQr = { ok: boolean; detalle: string };
export type PruebaEnlace = {
  ok: boolean;
  qr_status: number | null;
  qr_location: string | null;
  destino_status: number | null;
  nota: string;
};

function nombreArchivo(t: string) {
  return t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
}

/** Dos links son el mismo destino aunque cambie la barra final o el orden del esquema/host en mayúsculas. */
export function mismoLink(a: string | null, b: string | null) {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const limpio = (u: URL) => `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
    return limpio(x) === limpio(y);
  } catch {
    return a.trim() === b.trim();
  }
}

/** Mira en Supabase qué QR del lote quedó con el pedido y que apunte al destino. */
export function evaluarQr(op: {
  codigo: string;
  pedidoId: string;
  destino: string;
  simulado: boolean;
  fila: { codigo: string; estado: string; pedido_id: string | null; url: string | null; n: number } | null;
  delPedido: string[];
}): VerificacionQr {
  const { fila } = op;
  if (!fila) return { ok: false, detalle: `El código ${op.codigo} no está en el lote.` };
  if (op.simulado) {
    return fila.estado === 'libre' && !fila.pedido_id
      ? { ok: true, detalle: `Prueba: se usaría el QR n.º ${fila.n} (${fila.codigo}), que sigue libre; no se activó nada.` }
      : { ok: false, detalle: `Prueba: el QR ${fila.codigo} ya no está libre (${fila.estado}).` };
  }
  const fallas: string[] = [];
  if (fila.pedido_id !== op.pedidoId) fallas.push('está asignado a otro pedido');
  if (fila.estado !== 'asignado') fallas.push(`está en estado «${fila.estado}»`);
  if (!mismoLink(fila.url, op.destino)) fallas.push(`apunta a ${fila.url ?? 'ningún link'} y no a ${op.destino}`);
  const otros = op.delPedido.filter((c) => c !== op.codigo);
  if (otros.length) fallas.push(`el pedido también tiene asignado ${otros.join(', ')}`);
  return fallas.length
    ? { ok: false, detalle: `El QR n.º ${fila.n} (${fila.codigo}) ${fallas.join('; ')}.` }
    : { ok: true, detalle: `El QR n.º ${fila.n} (${fila.codigo}) es el del pedido y apunta a ${op.destino}.` };
}

const UA = 'FabricaDePlacas/1.0 (verificacion de enlace)';

/** Sitios que no dejan entrar a los robots pero al celular le abren bien. */
const REDES = /(^|\.)(instagram\.com|facebook\.com|fb\.com|tiktok\.com|wa\.me|whatsapp\.com|threads\.net|x\.com|twitter\.com)$/i;
function esRedSocial(url: string) {
  try {
    return REDES.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** «fetch failed» solo no dice nada: se suma la causa (redirecciones de más, conexión cortada, etc.). */
function motivoFetch(e: unknown) {
  if (!(e instanceof Error)) return String(e);
  const causa = (e as Error & { cause?: unknown }).cause;
  return causa instanceof Error && causa.message !== e.message ? `${e.message} (${causa.message})` : e.message;
}

/** Prueba que el link del QR redirija al destino y que el destino abra. */
export async function probarEnlace(urlDelQr: string, destino: string, simulado: boolean, f: typeof fetch = fetch): Promise<PruebaEnlace> {
  let qrStatus: number | null = null;
  let location: string | null = null;
  let qrOk = false;
  try {
    const r = await f(urlDelQr, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    qrStatus = r.status;
    location = r.headers.get('location');
    if (location) location = new URL(location, urlDelQr).toString();
    qrOk = simulado ? r.status < 500 : r.status >= 300 && r.status < 400 && mismoLink(location, destino);
  } catch (e) {
    return { ok: false, qr_status: null, qr_location: null, destino_status: null, nota: `No respondió el QR dinámico: ${e instanceof Error ? e.message : String(e)}` };
  }

  let destinoStatus: number | null = null;
  let nota = '';
  let cortaRobots = false;
  try {
    const r = await f(destino, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
    destinoStatus = r.status;
    await r.body?.cancel().catch(() => undefined);
  } catch (e) {
    // Instagram, Facebook y compañía mandan a los robots a un login que redirige en círculo, y el fetch
    // siguiendo redirecciones falla («fetch failed»). Sin seguirlas, ver que el sitio responde alcanza.
    try {
      const r = await f(destino, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
      destinoStatus = r.status;
      cortaRobots = r.status >= 300 && r.status < 400;
      await r.body?.cancel().catch(() => undefined);
    } catch {
      if (esRedSocial(destino)) cortaRobots = true;
      else nota = `El destino no respondió: ${motivoFetch(e)}`;
    }
  }
  // Algunos sitios (Instagram, Google) frenan a los robots aunque al celular le abran bien.
  const bloqueaRobots = cortaRobots || destinoStatus === 401 || destinoStatus === 403 || destinoStatus === 429;
  const destinoOk = cortaRobots || (destinoStatus !== null && (destinoStatus < 400 || bloqueaRobots));
  if (!nota) {
    nota = [
      simulado
        ? `Prueba: el QR todavía no está activado (responde ${qrStatus}).`
        : qrOk
          ? `El QR redirige al destino (${qrStatus}).`
          : `El QR no redirige al destino: responde ${qrStatus}${location ? ` hacia ${location}` : ''}.`,
      destinoOk
        ? `El destino abre (${destinoStatus ?? 'sin respuesta'}${bloqueaRobots ? ', bloquea robots: probalo con el celular' : ''}).`
        : `El destino no abre (${destinoStatus}).`,
    ].join(' ');
  }
  return { ok: qrOk && destinoOk, qr_status: qrStatus, qr_location: location, destino_status: destinoStatus, nota };
}

/** Producción: QR del lote, PDF A4 con dos placas 10 × 15, verificación del QR en Supabase y prueba del link. */
export const produccionEquipo: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const e = entrada<{ version_id: string; destino: string; correccion: unknown }>(ctx.paso.entrada);
  if (!e.version_id || !e.destino) throw new Error('A Producción le faltan la imagen confirmada o el link de destino.');
  const reglas = await reglasDelAgente(ctx, 'produccion', leerCorreccion(e.correccion));

  const version = await leerVersion(e.version_id);
  const imagenPath = (version.chequeo as { imagen_path?: string } | null)?.imagen_path;
  const colores = (version.chequeo as { colores?: { oscuro?: string } } | null)?.colores;
  if (!imagenPath) throw new Error('La versión confirmada no tiene la imagen de Diseño.');

  // 1. QR del lote: el que ya tenía el pedido o el próximo libre (en pruebas no se activa nada).
  const qr = revisar(
    await db().rpc('fab_asignar_qr', { p_pedido: pedido.id, p_url: e.destino, p_etiqueta: comercio.nombre, p_simular: pedido.simulado }),
    'asignar QR',
  )[0];
  if (!qr) throw new Error('No se pudo asignar un QR del lote.');

  // 2. Verificación en Supabase: qué QR del lote corresponde al pedido y a dónde apunta.
  const [fila, delPedido] = await Promise.all([
    db().rpc('fab_verificar_qr', { p_codigo: qr.codigo }),
    db().from('fab_qr_lote').select('codigo').eq('pedido_id', pedido.id),
  ]);
  if (fila.error) throw new Error(`No se pudo verificar el QR: ${fila.error.message}`);
  const verificacion = evaluarQr({
    codigo: qr.codigo,
    pedidoId: pedido.id,
    destino: e.destino,
    simulado: pedido.simulado,
    fila: fila.data?.[0] ?? null,
    delPedido: (delPedido.data ?? []).map((d) => d.codigo),
  });

  // 3. Placa a 300 dpi con el número del sticker, recortada a 10 × 15 y dos por hoja A4.
  const [imagenFondo, logo] = await Promise.all([bajarArchivo(imagenPath), logoDelComercio(comercio)]);
  const placa = await componerPlaca(imagenFondo, { rubro: comercio.rubro, logo: { png: logo.png, info: logo.info }, colores, modo: 'imprenta', qrNumero: qr.n }, anchoParaDpi(300));
  const jpg = await sharp(await sinSangrado(placa.png, placa.ancho)).flatten({ background: '#FFFFFF' }).withMetadata({ density: 300 }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  const url = urlQr(qr.codigo);
  const objetivo = OBJETIVOS[pedido.objetivo]?.nombre ?? pedido.objetivo;
  const pdf = await pdfA4DosPlacas(jpg, {
    titulo: `Placa #${pedido.numero} · ${comercio.nombre}`,
    subtitulo: `${objetivo} · versión ${version.numero} · dos placas de 10 × 15 cm${pedido.simulado ? ' · PRUEBA (no se activó ningún QR)' : ''}`,
    datos: [
      { etiqueta: 'QR', valor: `n.º ${qr.n} del lote ${qr.lote} (código ${qr.codigo})` },
      { etiqueta: 'Link del QR y del NFC', valor: url },
      { etiqueta: 'Destino', valor: e.destino },
    ],
    pasos: [
      'Imprimí al 100 % (sin «ajustar a la página») en cartulina de 250 g o más.',
      'Cortá por las guías. La segunda placa es de repuesto: lleva el mismo diseño y se usa con el mismo QR solo si la primera se arruina.',
      `Pegá el QR n.º ${qr.n} (código ${qr.codigo}) derecho en el cuadrado blanco, dentro de las marquitas.`,
      `Grabá el tag NFC con NFC Tools: Escribir > Agregar un registro > URL > ${url}. Probalo y recién después bloquealo.`,
      'Pegá el tag detrás de la placa, centrado detrás del círculo: a 50 mm del borde izquierdo y 75 mm del de arriba.',
      `Probá con un Android y un iPhone: el QR y el NFC tienen que abrir ${e.destino}.`,
    ],
  });

  const base = `pedidos/${pedido.id}/final/placa-${pedido.numero}-${nombreArchivo(comercio.nombre)}`;
  const archivos = [
    { path: `${base}-A4-dos-placas.pdf`, datos: Buffer.from(pdf), mime: 'application/pdf', tipo: 'pdf_a4', nombre: 'Hoja A4 con dos placas 10 × 15' },
    { path: `${base}-10x15.jpg`, datos: jpg, mime: 'image/jpeg', tipo: 'foto_10x15', nombre: 'Foto 10 × 15 (300 dpi)' },
  ];
  for (const a of archivos) {
    await subirArchivo(a.path, a.datos, a.mime);
    await registrarArchivo({ pedidoId: pedido.id, comercioId: comercio.id, tipo: a.tipo, nombre: a.nombre, path: a.path, mime: a.mime, bytes: a.datos.length, meta: { version_id: version.id } });
  }
  await db().from('fab_pedidos').update({ version_final_id: version.id, ...(pedido.simulado ? {} : { destino_url: e.destino }) }).eq('id', pedido.id);
  if (!pedido.simulado && pedido.objetivo === 'resenas' && !comercio.link_resenas) {
    await db().from('fab_comercios').update({ link_resenas: e.destino }).eq('id', comercio.id);
  }

  // 4. Que el link abra de verdad.
  const enlace = await probarEnlace(url, e.destino, pedido.simulado);

  return {
    salida: {
      archivos: archivos.map((a) => a.path),
      qr: { n: qr.n, codigo: qr.codigo, lote: qr.lote, url },
      destino: e.destino,
      verificacion_qr: verificacion,
      enlace,
      reglas_repasadas: reglas,
      simulado: pedido.simulado,
    } as unknown as Json,
    resumen: `Producción: PDF A4 con dos placas listo. ${verificacion.detalle} ${enlace.nota}`,
    siguientes: [{ tipo: 'pedrito', entrada: { revisar: 'produccion', paso_id: ctx.paso.id } }],
    pedidoEtapa: 'produccion',
  };
};
