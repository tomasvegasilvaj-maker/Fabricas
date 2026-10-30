import sharp from 'sharp';
import { renderAsync } from '@resvg/resvg-js';
import { archivosDeFuentes } from './fuentes';

export type InfoLogo = {
  ancho: number;
  alto: number;
  /** ancho / alto, para que el diseñador arme el lugar del logo con la misma forma. */
  proporcion: number;
  /** true si el logo tiene fondo transparente (se puede apoyar sobre cualquier color). */
  transparente: boolean;
  /** Color del fondo cuando no es transparente y es parejo (ej. el blanco de un JPG). */
  fondo: string | null;
  /** Colores principales del logo, sin contar el fondo. */
  colores: string[];
  formatoOriginal: string;
};

export type LogoProcesado = { png: Buffer; vista: Buffer; info: InfoLogo };

export const MIMES_LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif', 'image/avif'];
const LADO_MAX = 1600;

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function distancia(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function esSvg(datos: Buffer, mime: string) {
  return mime === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(datos.subarray(0, 2048).toString('utf8'));
}

/**
 * Prepara el logo del comercio sin tocar el dibujo: lo pasa a PNG, recorta márgenes vacíos y
 * averigua si tiene fondo transparente o de qué color es su fondo. Nunca lo redibuja ni recolorea.
 */
export async function procesarLogo(datos: Buffer, mime: string): Promise<LogoProcesado> {
  let entrada = datos;
  let formatoOriginal = mime;
  if (esSvg(datos, mime)) {
    formatoOriginal = 'image/svg+xml';
    const img = await renderAsync(datos, {
      fitTo: { mode: 'width', value: LADO_MAX },
      font: { fontFiles: archivosDeFuentes(), loadSystemFonts: false, defaultFontFamily: 'Montserrat' },
      logLevel: 'off',
    });
    entrada = img.asPng();
  }

  const base = await sharp(entrada, { failOn: 'error', animated: false })
    .rotate()
    .resize({ width: LADO_MAX, height: LADO_MAX, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  const { width: ancho, height: alto } = info;
  const canales = info.channels;

  // Mirada al borde: ¿es transparente o un color parejo?
  const borde: number[][] = [];
  const paso = Math.max(1, Math.floor(Math.max(ancho, alto) / 400));
  const tomar = (x: number, y: number) => {
    const i = (y * ancho + x) * canales;
    borde.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
  };
  for (let x = 0; x < ancho; x += paso) {
    tomar(x, 0);
    tomar(x, alto - 1);
  }
  for (let y = 0; y < alto; y += paso) {
    tomar(0, y);
    tomar(ancho - 1, y);
  }
  const transparentes = borde.filter((p) => p[3] < 200).length;
  const transparente = transparentes / borde.length > 0.3;

  let fondo: number[] | null = null;
  if (!transparente) {
    const opacos = borde.filter((p) => p[3] >= 200);
    const promedio = [0, 1, 2].map((c) => opacos.reduce((s, p) => s + p[c], 0) / opacos.length);
    const parejos = opacos.filter((p) => distancia(p, promedio) < 28).length;
    if (parejos / opacos.length > 0.85) fondo = promedio;
  }

  // Recorte de márgenes vacíos (transparentes o del color del fondo), dejando un poco de aire.
  let recortado = base;
  try {
    const margen = Math.round(Math.max(ancho, alto) * 0.03);
    recortado = await sharp(base)
      .trim({
        background: transparente ? { r: 0, g: 0, b: 0, alpha: 0 } : fondo ? { r: fondo[0], g: fondo[1], b: fondo[2] } : undefined,
        threshold: 18,
        margin: margen,
      })
      .png()
      .toBuffer();
  } catch {
    // Si el recorte no encuentra nada (logo de un solo color, por ejemplo), queda como estaba.
  }
  const meta = await sharp(recortado).metadata();
  const anchoFinal = meta.width ?? ancho;
  const altoFinal = meta.height ?? alto;

  const png = await sharp(recortado).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const vista = await sharp(recortado)
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  return {
    png,
    vista,
    info: {
      ancho: anchoFinal,
      alto: altoFinal,
      proporcion: Math.round((anchoFinal / altoFinal) * 1000) / 1000,
      transparente,
      fondo: fondo ? hex(fondo[0], fondo[1], fondo[2]) : null,
      colores: await coloresPrincipales(recortado, fondo),
      formatoOriginal,
    },
  };
}

/** Hasta 5 colores que más pesan en el logo (agrupados), sin el fondo ni lo transparente. */
async function coloresPrincipales(png: Buffer, fondo: number[] | null): Promise<string[]> {
  const { data, info } = await sharp(png).resize(72, 72, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grupos = new Map<string, { n: number; suma: number[] }>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 160) continue;
    const p = [data[i], data[i + 1], data[i + 2]];
    if (fondo && distancia(p, fondo) < 40) continue;
    const clave = p.map((v) => v >> 5).join(',');
    const g = grupos.get(clave) ?? { n: 0, suma: [0, 0, 0] };
    g.n++;
    g.suma = g.suma.map((s, c) => s + p[c]);
    grupos.set(clave, g);
  }
  const total = [...grupos.values()].reduce((s, g) => s + g.n, 0);
  const ordenados = [...grupos.values()]
    .filter((g) => g.n / Math.max(total, 1) > 0.02)
    .sort((a, b) => b.n - a.n)
    .map((g) => g.suma.map((s) => s / g.n));
  const elegidos: number[][] = [];
  for (const c of ordenados) {
    if (elegidos.every((e) => distancia(e, c) > 48)) elegidos.push(c);
    if (elegidos.length === 5) break;
  }
  return elegidos.map((c) => hex(c[0], c[1], c[2]));
}

export function dataUri(png: Buffer, mime = 'image/png') {
  return `data:${mime};base64,${png.toString('base64')}`;
}
