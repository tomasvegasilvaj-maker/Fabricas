// Capturas del parte. Vercel no trae un navegador, así que no se fotografía la página: se dibujan, con el mismo
// motor de las placas (resvg, ya instalado), las pantallas clave con los datos reales de Supabase. La de
// «generación de placa» es la última placa real que guardó la línea, tal cual está en el Storage.
import { renderizar } from '../placa/render';
import { BUCKET, db, subirArchivo } from '../supabase';
import type { EstadoFabrica } from './estado';

export type Captura = { pantalla: 'generacion_placa' | 'listado_negocios' | 'error'; url: string };

/** Las URLs firmadas duran 7 días: suficiente para que Pedrito y los bots las abran. */
const VIGENCIA_SEG = 7 * 24 * 3600;
const ANCHO = 900;

const ESTADOS: Record<string, string> = {
  en_marcha: 'en marcha',
  en_espera: 'esperando a Tomi',
  pausado: 'pausado',
  listo: 'listo',
  fallido: 'fallido',
  cancelado: 'cancelado',
};

function esc(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cortar(t: string, max: number) {
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Parte un texto en renglones de hasta `max` caracteres. */
function renglones(t: string, max: number, tope: number) {
  const out: string[] = [];
  let actual = '';
  for (const p of t.split(/\s+/)) {
    if ((actual + ' ' + p).trim().length > max && actual) {
      out.push(actual);
      actual = p;
    } else actual = `${actual} ${p}`.trim();
  }
  if (actual) out.push(actual);
  return out.length > tope ? [...out.slice(0, tope - 1), `${out[tope - 1]}…`] : out;
}

function hoja(titulo: string, subtitulo: string, cuerpo: string, alto: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ANCHO} ${alto}" width="${ANCHO}" height="${alto}">
  <rect width="${ANCHO}" height="${alto}" fill="#f6f4ef"/>
  <rect x="0" y="0" width="${ANCHO}" height="84" fill="#1f2a37"/>
  <text x="32" y="40" font-family="Inter" font-weight="700" font-size="24" fill="#ffffff">${esc(titulo)}</text>
  <text x="32" y="66" font-family="Inter" font-size="15" fill="#c9d3df">${esc(subtitulo)}</text>
  ${cuerpo}
</svg>`;
}

export function svgListado(e: EstadoFabrica, fecha: string) {
  const filas = e.pedidos.slice(-18);
  let y = 150;
  const cuerpo = [
    `<text x="32" y="122" font-family="Inter" font-weight="700" font-size="17" fill="#1f2a37">Placas hechas ${e.placas_hechas}/20 · Negocios activos ${e.negocios_activos}/10 · objetivo 31/12/2026</text>`,
    `<text x="32" y="${y}" font-family="Inter" font-weight="700" font-size="13" fill="#6b7280">N.º</text>`,
    `<text x="90" y="${y}" font-family="Inter" font-weight="700" font-size="13" fill="#6b7280">NEGOCIO</text>`,
    `<text x="470" y="${y}" font-family="Inter" font-weight="700" font-size="13" fill="#6b7280">ESTADO</text>`,
    `<text x="660" y="${y}" font-family="Inter" font-weight="700" font-size="13" fill="#6b7280">ETAPA · LÍNEA</text>`,
  ];
  if (filas.length === 0) cuerpo.push(`<text x="32" y="${y + 36}" font-family="Inter" font-size="16" fill="#374151">Todavía no hay pedidos reales cargados.</text>`);
  for (const p of filas) {
    y += 34;
    const color = p.estado === 'listo' ? '#047857' : p.estado === 'fallido' ? '#b91c1c' : '#374151';
    cuerpo.push(
      `<line x1="32" y1="${y - 24}" x2="${ANCHO - 32}" y2="${y - 24}" stroke="#e5e1d8"/>`,
      `<text x="32" y="${y}" font-family="Inter" font-size="15" fill="#374151">${p.numero}</text>`,
      `<text x="90" y="${y}" font-family="Inter" font-weight="700" font-size="15" fill="#111827">${esc(cortar(p.comercio, 40))}</text>`,
      `<text x="470" y="${y}" font-family="Inter" font-size="15" fill="${color}">${esc(ESTADOS[p.estado] ?? p.estado)}</text>`,
      `<text x="660" y="${y}" font-family="Inter" font-size="15" fill="#374151">${esc(`${p.etapa} · ${p.linea}`)}</text>`,
    );
  }
  return hoja('Fábrica de placas · Pedidos y negocios', `Datos de Supabase al ${fecha}`, cuerpo.join('\n  '), y + 50);
}

export function svgErrores(e: EstadoFabrica, fecha: string) {
  let y = 120;
  const cuerpo: string[] = [];
  for (const x of e.errores.slice(0, 8)) {
    cuerpo.push(`<text x="32" y="${y}" font-family="Inter" font-weight="700" font-size="16" fill="#b91c1c">${esc(cortar(`${x.donde} (${x.agente})`, 80))}</text>`);
    for (const r of renglones(x.mensaje, 95, 3)) {
      y += 24;
      cuerpo.push(`<text x="32" y="${y}" font-family="Inter" font-size="14" fill="#374151">${esc(r)}</text>`);
    }
    y += 40;
  }
  if (e.errores.length > 8) cuerpo.push(`<text x="32" y="${y}" font-family="Inter" font-size="14" fill="#6b7280">y ${e.errores.length - 8} más.</text>`);
  return hoja('Fábrica de placas · Errores', `Vistos al ${fecha}`, cuerpo.join('\n  '), y + 30);
}

async function firmar(path: string) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, VIGENCIA_SEG);
  if (error || !data?.signedUrl) throw new Error(`No se pudo firmar ${path}: ${error?.message ?? 'sin URL'}`);
  return data.signedUrl;
}

async function subirSvg(svg: string, path: string) {
  const { png } = await renderizar(svg, ANCHO, '#f6f4ef');
  await subirArchivo(path, png, 'image/png');
  return firmar(path);
}

/** Dibuja, sube a Storage (bucket privado «fabrica», carpeta partes/) y devuelve URLs firmadas. */
export async function armarCapturas(e: EstadoFabrica, fecha: string, sello: string): Promise<{ capturas: Captura[]; fallos: string[] }> {
  const capturas: Captura[] = [];
  const fallos: string[] = [];
  const base = `partes/${sello}`;
  const tareas: [Captura['pantalla'], () => Promise<string>][] = [];
  if (e.ultima_vista) tareas.push(['generacion_placa', () => firmar(e.ultima_vista!.path)]);
  if (e.base) tareas.push(['listado_negocios', () => subirSvg(svgListado(e, fecha), `${base}/listado_negocios.png`)]);
  if (e.errores.length) tareas.push(['error', () => subirSvg(svgErrores(e, fecha), `${base}/error.png`)]);
  for (const [pantalla, hacer] of tareas) {
    try {
      capturas.push({ pantalla, url: await hacer() });
    } catch (err) {
      fallos.push(`captura ${pantalla}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { capturas, fallos };
}
