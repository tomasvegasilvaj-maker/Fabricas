// Plantilla obligatoria de la línea «equipo»: la imagen de Diseño va de fondo y encima, siempre en el
// mismo lugar, van el logo original arriba al medio, la zona NFC al centro, la tarjeta del QR abajo con
// «¿Sin NFC? Escaneá el código QR» y el pie con el rubro y la ciudad. Todo se dibuja con código (no con
// la IA de imágenes), así el logo no se redibuja, el texto sale sin errores y el QR queda donde se pega.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CIUDAD_PIE, TEXTO_QR_PLANTILLA } from '../motor/flujo';
import { PLACA } from './especificacion';
import { dataUri, type InfoLogo } from './logo';
import { renderizar } from './render';

const ANCHO_TOTAL = PLACA.ancho + 2 * PLACA.sangrado; // 106 mm
const ALTO_TOTAL = PLACA.alto + 2 * PLACA.sangrado; // 156 mm

type Caja = { x: number; y: number; w: number; h: number };

/** Posiciones en mm sobre la placa terminada (0,0 = esquina de arriba a la izquierda, sin sangrado). */
export const PLANTILLA = {
  logo: { cx: 50, arriba: 9, anchoMax: 52, altoMax: 20, aire: 2.5 },
  nfc: { cx: 50, cy: 75, r: 15 },
  pildora: { x: 25, y: 92.5, w: 50, h: 6.5, texto: 'ACERCÁ TU CELULAR ACÁ' },
  tarjetaQr: { x: 20, y: 102, w: 60, h: 34.5, rx: 3 },
  qr: { x: 40, y: 105, lado: PLACA.qrSlot },
  textoQr: { y: 131.2, tamano: 3, texto: TEXTO_QR_PLANTILLA },
  pie: { y: 139.5, texto_y: 145.6 },
} as const;

export type ColoresPlantilla = { oscuro: string; claro: string };
export const COLORES_POR_DEFECTO: ColoresPlantilla = { oscuro: '#141414', claro: '#FFFFFF' };

export type DatosPlantilla = {
  rubro: string;
  logo: { png: Buffer; info: InfoLogo };
  colores?: Partial<ColoresPlantilla>;
  /** «vista»: pega un QR de muestra. «imprenta»: deja el cuadrado blanco con marcas y el n.º del sticker. */
  modo: 'vista' | 'imprenta';
  qrNumero?: number | null;
};

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n: number) => Math.round(n * 100) / 100;

export function textoPie(rubro: string) {
  return `${rubro.trim().toLocaleUpperCase('es-AR')} · ${CIUDAD_PIE.toLocaleUpperCase('es-AR')}`;
}

/** Caja del logo con su proporción real, centrada arriba. */
export function cajaLogo(proporcion: number): Caja {
  const { cx, arriba, anchoMax, altoMax } = PLANTILLA.logo;
  const p = Number.isFinite(proporcion) && proporcion > 0 ? proporcion : 1;
  let w = anchoMax;
  let h = w / p;
  if (h > altoMax) {
    h = altoMax;
    w = h * p;
  }
  return { x: r2(cx - w / 2), y: arriba, w: r2(w), h: r2(h) };
}

/** Tamaño de letra del pie para que el rubro largo no se salga de la zona segura. */
export function tamanoPie(texto: string) {
  const anchoUtil = PLACA.ancho - 2 * PLACA.margenSeguro - 4;
  // Montserrat 800 en mayúsculas con 0,5 mm de espaciado: ~0,74 em por letra.
  // Redondeado hacia abajo: nunca más ancho que la zona útil.
  return Math.floor(Math.min(3.2, anchoUtil / (texto.length * 0.74 + 0.5)) * 100) / 100;
}

function hexValido(v: string | undefined, porDefecto: string) {
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : porDefecto;
}

/** Luminancia relativa (0 negro, 1 blanco) para elegir el color del texto sobre el pie. */
export function luminancia(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let qrMuestra: string | null = null;
function qrDeMuestra() {
  qrMuestra ??= dataUri(readFileSync(path.join(process.cwd(), 'assets', 'qr-muestra.png')));
  return qrMuestra;
}

/** Ondas de pago sin contacto: tres arcos concéntricos que se abren hacia la derecha desde (x, y). */
function ondas(x: number, y: number, escala: number, color: string) {
  const a = Math.PI / 4;
  const arcos = [1, 1.9, 2.8]
    .map((k) => {
      const r = k * escala;
      const x1 = x + r * Math.cos(a);
      const y1 = y - r * Math.sin(a);
      const y2 = y + r * Math.sin(a);
      return `<path d="M${r2(x1)} ${r2(y1)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x1)} ${r2(y2)}" fill="none" stroke="${color}" stroke-width="${r2(0.5 * escala)}" stroke-linecap="round"/>`;
    })
    .join('');
  return `<g>${arcos}</g>`;
}

/** SVG con todo lo de la plantilla, fondo transparente, para poner encima de la imagen de Diseño. */
export function svgPlantilla(d: DatosPlantilla): string {
  const colores = { oscuro: hexValido(d.colores?.oscuro, COLORES_POR_DEFECTO.oscuro), claro: hexValido(d.colores?.claro, COLORES_POR_DEFECTO.claro) };
  const { nfc, pildora, tarjetaQr: t, qr, textoQr, pie } = PLANTILLA;
  const logo = cajaLogo(d.logo.info.proporcion);
  const aire = PLANTILLA.logo.aire;
  const fondoLogo = d.logo.info.transparente || !d.logo.info.fondo ? '#FFFFFF' : d.logo.info.fondo;
  const opacidadFondoLogo = d.logo.info.transparente || !d.logo.info.fondo ? 0.92 : 1;
  const textoDelPie = textoPie(d.rubro);
  const colorTextoPie = luminancia(colores.oscuro) > 0.45 ? '#141414' : '#FFFFFF';

  const partes: string[] = [];
  // 1. Logo original arriba al medio, sobre un panel para que se lea sobre cualquier imagen.
  partes.push(
    `<rect id="panel-logo" x="${r2(logo.x - aire)}" y="${r2(logo.y - aire)}" width="${r2(logo.w + 2 * aire)}" height="${r2(logo.h + 2 * aire)}" rx="3" fill="${fondoLogo}" fill-opacity="${opacidadFondoLogo}"/>`,
    `<image id="logo" x="${logo.x}" y="${logo.y}" width="${logo.w}" height="${logo.h}" preserveAspectRatio="xMidYMid meet" href="${dataUri(d.logo.png)}"/>`,
  );
  // 2. NFC al centro: anillo punteado que marca dónde apoyar, ondas y la píldora con la frase.
  const ox = nfc.cx + nfc.r * Math.SQRT1_2;
  const oy = nfc.cy - nfc.r * Math.SQRT1_2;
  partes.push(
    `<circle id="nfc-zona" cx="${nfc.cx}" cy="${nfc.cy}" r="${nfc.r}" fill="none" stroke="${colores.claro}" stroke-opacity="0.9" stroke-width="0.6" stroke-dasharray="1.6 1.2"/>`,
    `<circle cx="${r2(ox)}" cy="${r2(oy)}" r="4.4" fill="${colores.claro}"/>`,
    ondas(ox - 2.1, oy, 1, colores.oscuro),
    `<rect id="pildora-nfc" x="${pildora.x}" y="${pildora.y}" width="${pildora.w}" height="${pildora.h}" rx="${pildora.h / 2}" fill="${colores.oscuro}"/>`,
    `<text x="${pildora.x + pildora.w / 2}" y="${r2(pildora.y + pildora.h / 2 + 0.95)}" font-family="Montserrat" font-weight="800" font-size="2.7" letter-spacing="0.25" text-anchor="middle" fill="${colores.claro}">${xml(pildora.texto)}</text>`,
  );
  // 3. QR abajo: tarjeta blanca, cuadrado del sticker y el texto obligatorio.
  partes.push(`<rect id="tarjeta-qr" x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="${t.rx}" fill="#FFFFFF"/>`);
  const s = PLACA.qrSticker;
  const sx = qr.x + (qr.lado - s) / 2;
  const sy = qr.y + (qr.lado - s) / 2;
  if (d.modo === 'vista') {
    partes.push(`<image id="qr" x="${sx}" y="${sy}" width="${s}" height="${s}" href="${qrDeMuestra()}"/>`);
  } else {
    const k = 1.6;
    for (const [ex, ey, dx, dy] of [
      [sx, sy, 1, 1],
      [sx + s, sy, -1, 1],
      [sx, sy + s, 1, -1],
      [sx + s, sy + s, -1, -1],
    ] as const) {
      partes.push(`<path d="M${r2(ex + dx * k)} ${r2(ey)}H${r2(ex)}V${r2(ey + dy * k)}" fill="none" stroke="#C9C9C9" stroke-width="0.2"/>`);
    }
    if (d.qrNumero) {
      partes.push(`<text x="${qr.x + qr.lado / 2}" y="${r2(qr.y + qr.lado - 0.45)}" font-family="Inter" font-size="1.2" text-anchor="middle" fill="#B0B0B0">QR n.º ${d.qrNumero}</text>`);
    }
  }
  partes.push(
    `<text id="texto-qr" x="${t.x + t.w / 2}" y="${textoQr.y}" text-anchor="middle" fill="${colores.oscuro}" font-size="${textoQr.tamano}">` +
      `<tspan font-family="DM Serif Display" font-style="italic">¿Sin NFC?</tspan>` +
      `<tspan font-family="Montserrat" font-weight="700"> Escaneá el código QR</tspan></text>`,
  );
  // 4. Pie con rubro y ciudad, en una franja que llega hasta el sangrado.
  partes.push(
    `<rect id="pie" x="-3" y="${pie.y}" width="${ANCHO_TOTAL}" height="${r2(PLACA.alto + PLACA.sangrado - pie.y)}" fill="${colores.oscuro}"/>`,
    `<text id="texto-pie" x="50" y="${pie.texto_y}" font-family="Montserrat" font-weight="800" font-size="${tamanoPie(textoDelPie)}" letter-spacing="0.5" text-anchor="middle" fill="${colorTextoPie}">${xml(textoDelPie)}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLACA.viewBox}" width="${ANCHO_TOTAL}mm" height="${ALTO_TOTAL}mm">${partes.join('')}</svg>`;
}

export type ChequeoPlantilla = { ok: boolean; fallas: string[]; textos: { qr: string; pie: string }; zonas: Record<string, Caja> };

function solapan(a: Caja, b: Caja) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Chequeo geométrico de la plantilla (lo usa Estructura antes de mirar la imagen). */
export function chequearPlantilla(rubro: string, logo: InfoLogo): ChequeoPlantilla {
  const fallas: string[] = [];
  const m = PLACA.margenSeguro;
  const caja = cajaLogo(logo.proporcion);
  const { nfc, pildora, tarjetaQr, qr } = PLANTILLA;
  const zonas: Record<string, Caja> = {
    logo: caja,
    nfc: { x: nfc.cx - nfc.r, y: nfc.cy - nfc.r, w: 2 * nfc.r, h: 2 * nfc.r },
    pildora: { x: pildora.x, y: pildora.y, w: pildora.w, h: pildora.h },
    tarjeta_qr: { x: tarjetaQr.x, y: tarjetaQr.y, w: tarjetaQr.w, h: tarjetaQr.h },
    qr: { x: qr.x, y: qr.y, w: qr.lado, h: qr.lado },
  };
  for (const [nombre, z] of Object.entries(zonas)) {
    if (z.x < m || z.y < m || z.x + z.w > PLACA.ancho - m || z.y + z.h > PLACA.alto - m) fallas.push(`${nombre} se sale de la zona segura de ${m} mm.`);
  }
  if (Math.abs(caja.x + caja.w / 2 - 50) > 0.5) fallas.push('El logo no está centrado.');
  if (caja.y > 20) fallas.push('El logo no está arriba.');
  if (Math.abs(nfc.cx - 50) > 0.5 || Math.abs(nfc.cy - PLACA.alto / 2) > 5) fallas.push('La zona NFC no está al centro.');
  if (nfc.r < PLACA.nfcRadioMin || nfc.r > PLACA.nfcRadioMax) fallas.push('El círculo NFC no tiene el tamaño del tag.');
  if (qr.y < PLACA.alto / 2) fallas.push('El QR no está abajo.');
  if (qr.lado !== PLACA.qrSlot) fallas.push(`El cuadrado del QR tiene que medir ${PLACA.qrSlot} mm.`);
  const pares: [string, string][] = [
    ['logo', 'nfc'],
    ['nfc', 'pildora'],
    ['pildora', 'tarjeta_qr'],
    ['logo', 'tarjeta_qr'],
  ];
  for (const [a, b] of pares) if (solapan(zonas[a], zonas[b])) fallas.push(`${a} se pisa con ${b}.`);
  const pie = textoPie(rubro);
  if (!pie.includes(CIUDAD_PIE.toLocaleUpperCase('es-AR'))) fallas.push('Falta la ciudad en el pie.');
  if (!rubro.trim()) fallas.push('Falta el rubro en el pie.');
  return { ok: fallas.length === 0, fallas, textos: { qr: TEXTO_QR_PLANTILLA, pie }, zonas };
}

/** Pone la imagen de Diseño de fondo (cubriendo el sangrado) y la plantilla encima. */
export async function componerPlaca(imagen: Buffer, d: DatosPlantilla, anchoPx: number): Promise<{ png: Buffer; ancho: number; alto: number }> {
  const capa = await renderizar(svgPlantilla(d), anchoPx);
  const fondo = await sharp(imagen).rotate().resize(capa.ancho, capa.alto, { fit: 'cover', position: 'centre' }).toBuffer();
  const png = await sharp(fondo)
    .composite([{ input: capa.png }])
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
  return { png, ancho: capa.ancho, alto: capa.alto };
}

/** Recorta el sangrado: la placa de 100 × 150 mm tal cual se corta. */
export async function sinSangrado(png: Buffer, anchoConSangradoPx: number) {
  const pxMm = anchoConSangradoPx / ANCHO_TOTAL;
  return sharp(png)
    .extract({
      left: Math.round(PLACA.sangrado * pxMm),
      top: Math.round(PLACA.sangrado * pxMm),
      width: Math.round(PLACA.ancho * pxMm),
      height: Math.round(PLACA.alto * pxMm),
    })
    .toBuffer();
}
