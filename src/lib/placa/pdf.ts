import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { PLACA } from './especificacion';

const PT_POR_MM = 72 / 25.4;
const mm = (v: number) => v * PT_POR_MM;

const ANCHO = PLACA.ancho + 2 * PLACA.sangrado;
const ALTO = PLACA.alto + 2 * PLACA.sangrado;

/** Helvetica estándar solo sabe WinAnsi: tildes, ñ, ¿¡ y comillas sí; flechas o emojis no. */
export function textoWinAnsi(texto: string) {
  return texto
    .replace(/[→⟶➜]/g, '->')
    .replace(/[✓✔]/g, 'OK')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF€–—…•]/g, '');
}

/** PDF del tamaño exacto de la placa con sangrado (106 × 156 mm), con TrimBox y BleedBox. */
export async function pdfPlaca(png: Buffer, titulo: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(textoWinAnsi(titulo));
  pdf.setCreator('Fábrica de placas');
  const imagen = await pdf.embedPng(png);
  const pagina = pdf.addPage([mm(ANCHO), mm(ALTO)]);
  pagina.drawImage(imagen, { x: 0, y: 0, width: mm(ANCHO), height: mm(ALTO) });
  pagina.setBleedBox(0, 0, mm(ANCHO), mm(ALTO));
  pagina.setTrimBox(mm(PLACA.sangrado), mm(PLACA.sangrado), mm(PLACA.ancho), mm(PLACA.alto));
  return pdf.save();
}

export type GuiaArmado = {
  titulo: string;
  subtitulo?: string;
  pasos: string[];
  datos: { etiqueta: string; valor: string }[];
};

function envolver(texto: string, fuente: PDFFont, tamaño: number, anchoMax: number): string[] {
  const palabras = textoWinAnsi(texto).split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (fuente.widthOfTextAtSize(prueba, tamaño) <= anchoMax || !actual) actual = prueba;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function marcasDeCorte(pagina: PDFPage, x: number, y: number, ancho: number, alto: number) {
  // Marcas a 3,5 mm del corte (fuera del sangrado), de 5 mm de largo.
  const separacion = mm(PLACA.sangrado + 0.5);
  const largo = mm(5);
  const color = rgb(0, 0, 0);
  const grosor = 0.3;
  const esquinas: [number, number, number, number][] = [
    [x, y, -1, -1],
    [x + ancho, y, 1, -1],
    [x, y + alto, -1, 1],
    [x + ancho, y + alto, 1, 1],
  ];
  for (const [ex, ey, dx, dy] of esquinas) {
    pagina.drawLine({ start: { x: ex + dx * separacion, y: ey }, end: { x: ex + dx * (separacion + largo), y: ey }, thickness: grosor, color });
    pagina.drawLine({ start: { x: ex, y: ey + dy * separacion }, end: { x: ex, y: ey + dy * (separacion + largo) }, thickness: grosor, color });
  }
}

/** Acomodo de dos placas 10 × 15 en una A4 vertical, como lo hace FotoHoja: lado a lado, centradas, con separación. */
export const A4_DOS_PLACAS = { margen: 4, separacion: 2, arriba: 12 } as const;

export function posicionesDosPlacas() {
  const { separacion, arriba } = A4_DOS_PLACAS;
  const anchoBloque = 2 * PLACA.ancho + separacion;
  const x0 = (210 - anchoBloque) / 2;
  return [0, 1].map((i) => ({ x: x0 + i * (PLACA.ancho + separacion), y: arriba, w: PLACA.ancho, h: PLACA.alto }));
}

/**
 * Hoja A4 con dos placas de 10 × 15 (sin sangrado) para imprimir al 100 %, con guías de corte en los
 * márgenes y, abajo, los datos y los pasos de armado. `jpg` es la placa ya recortada a 100 × 150 mm.
 */
export async function pdfA4DosPlacas(jpg: Buffer, guia: GuiaArmado): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(textoWinAnsi(guia.titulo));
  pdf.setCreator('Fábrica de placas');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const imagen = await pdf.embedJpg(jpg);
  const alto = 297;
  const pagina = pdf.addPage([mm(210), mm(alto)]);
  const gris = rgb(0.45, 0.45, 0.45);
  const posiciones = posicionesDosPlacas();
  for (const p of posiciones) {
    pagina.drawImage(imagen, { x: mm(p.x), y: mm(alto - p.y - p.h), width: mm(p.w), height: mm(p.h) });
  }
  // Guías de corte: líneas finas en los márgenes, a la altura y al ancho de cada borde.
  const xs = [...new Set(posiciones.flatMap((p) => [p.x, p.x + p.w]))];
  const ySup = posiciones[0].y;
  const yInf = posiciones[0].y + posiciones[0].h;
  for (const x of xs) {
    pagina.drawLine({ start: { x: mm(x), y: mm(alto - ySup + 1.5) }, end: { x: mm(x), y: mm(alto - ySup + 7) }, thickness: 0.3, color: gris });
    pagina.drawLine({ start: { x: mm(x), y: mm(alto - yInf - 1.5) }, end: { x: mm(x), y: mm(alto - yInf - 7) }, thickness: 0.3, color: gris });
  }
  const xIzq = posiciones[0].x;
  const xDer = posiciones[1].x + posiciones[1].w;
  for (const y of [ySup, yInf]) {
    pagina.drawLine({ start: { x: mm(xIzq - 0.8), y: mm(alto - y) }, end: { x: mm(Math.max(xIzq - 4, 0.5)), y: mm(alto - y) }, thickness: 0.3, color: gris });
    pagina.drawLine({ start: { x: mm(xDer + 0.8), y: mm(alto - y) }, end: { x: mm(Math.min(xDer + 4, 209.5)), y: mm(alto - y) }, thickness: 0.3, color: gris });
  }

  const izquierda = mm(14);
  const anchoTexto = mm(210 - 28);
  let cursor = mm(alto - yInf - 14);
  const escribir = (texto: string, fuente: PDFFont, tamaño: number, color = rgb(0.1, 0.1, 0.1)) => {
    for (const linea of envolver(texto, fuente, tamaño, anchoTexto)) {
      pagina.drawText(linea, { x: izquierda, y: cursor, size: tamaño, font: fuente, color });
      cursor -= tamaño * 1.35;
    }
  };
  escribir(guia.titulo, negrita, 12);
  if (guia.subtitulo) escribir(guia.subtitulo, normal, 9, rgb(0.35, 0.35, 0.35));
  cursor -= mm(1.5);
  for (const d of guia.datos) escribir(`${d.etiqueta}: ${d.valor}`, normal, 9);
  cursor -= mm(1.5);
  guia.pasos.forEach((p, i) => escribir(`${i + 1}. ${p}`, normal, 9));
  return pdf.save();
}

/** Hoja A4 para imprimir en casa: la placa con marcas de corte y, abajo, la guía de armado. */
export async function pdfA4(png: Buffer, guia: GuiaArmado): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(textoWinAnsi(guia.titulo));
  pdf.setCreator('Fábrica de placas');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const imagen = await pdf.embedPng(png);

  const pagina = pdf.addPage([mm(210), mm(297)]);
  const x = mm((210 - ANCHO) / 2);
  const yArriba = mm(297 - 14);
  const y = yArriba - mm(ALTO);
  pagina.drawImage(imagen, { x, y, width: mm(ANCHO), height: mm(ALTO) });
  marcasDeCorte(pagina, x + mm(PLACA.sangrado), y + mm(PLACA.sangrado), mm(PLACA.ancho), mm(PLACA.alto));

  const izquierda = mm(22);
  const anchoTexto = mm(210 - 44);
  let cursor = y - mm(14);
  const escribir = (texto: string, fuente: PDFFont, tamaño: number, color = rgb(0.1, 0.1, 0.1), sangria = 0) => {
    for (const linea of envolver(texto, fuente, tamaño, anchoTexto - sangria)) {
      pagina.drawText(linea, { x: izquierda + sangria, y: cursor, size: tamaño, font: fuente, color });
      cursor -= tamaño * 1.35;
    }
  };

  escribir(guia.titulo, negrita, 13);
  if (guia.subtitulo) escribir(guia.subtitulo, normal, 9, rgb(0.35, 0.35, 0.35));
  cursor -= mm(2);
  for (const d of guia.datos) {
    const etiqueta = `${textoWinAnsi(d.etiqueta)}: `;
    const anchoEtiqueta = negrita.widthOfTextAtSize(etiqueta, 9.5);
    pagina.drawText(etiqueta, { x: izquierda, y: cursor, size: 9.5, font: negrita, color: rgb(0.1, 0.1, 0.1) });
    const lineas = envolver(d.valor, normal, 9.5, anchoTexto - anchoEtiqueta);
    lineas.forEach((l, i) => {
      pagina.drawText(l, { x: izquierda + anchoEtiqueta, y: cursor, size: 9.5, font: normal, color: rgb(0.1, 0.1, 0.1) });
      if (i < lineas.length - 1) cursor -= 9.5 * 1.35;
    });
    cursor -= 9.5 * 1.5;
  }
  cursor -= mm(2);
  guia.pasos.forEach((p, i) => escribir(`${i + 1}. ${p}`, normal, 9.5, rgb(0.1, 0.1, 0.1), 0));
  return pdf.save();
}
