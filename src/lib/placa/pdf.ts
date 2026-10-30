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
