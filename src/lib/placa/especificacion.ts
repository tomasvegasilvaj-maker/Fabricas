import { textoFuentesParaPrompt } from './fuentes';

/** Medidas físicas de la placa, en milímetros (1 unidad del SVG = 1 mm). */
export const PLACA = {
  ancho: 100,
  alto: 150,
  sangrado: 3,
  margenSeguro: 4,
  viewBox: '-3 -3 106 156',
  qrSlot: 20,
  qrSticker: 16,
  nfcRadioMin: 12.5,
  nfcRadioMax: 16,
  textoMinimo: 2.2,
} as const;

export const IDS = { logo: 'logo-slot', qr: 'qr-slot', nfc: 'nfc-zone' } as const;

/** Reglas técnicas que tiene que cumplir todo SVG de placa. Se las damos a los agentes que dibujan. */
export function reglasSvg() {
  return `## Formato técnico del SVG (obligatorio)

- Raíz exacta: <svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLACA.viewBox}" width="106mm" height="156mm">. 1 unidad = 1 mm.
- La placa terminada mide ${PLACA.ancho} × ${PLACA.alto} mm: va de x=0,y=0 a x=${PLACA.ancho},y=${PLACA.alto}. Entre −3 y 0, y entre ${PLACA.ancho}/${PLACA.alto} y +3, está el sangrado: el fondo y todo lo que toque un borde tiene que llegar hasta ahí (empezá con un rect de fondo x="-3" y="-3" width="106" height="156").
- Zona segura: textos, logo, QR y círculo NFC a ${PLACA.margenSeguro} mm o más del corte (x entre ${PLACA.margenSeguro} y ${PLACA.ancho - PLACA.margenSeguro}, y entre ${PLACA.margenSeguro} y ${PLACA.alto - PLACA.margenSeguro}).
- Tres elementos obligatorios, hijos directos del <svg> raíz, con esos id exactos y sin transform (ni ellos ni nada por encima):
  1. <rect id="logo-slot" x=".." y=".." width=".." height=".." fill="none"/> — ahí el sistema pega el logo ORIGINAL del comercio. No dibujes el logo ni lo imites. Respetá la proporción del logo que te paso (ancho/alto). Si el logo no tiene fondo transparente, dibujá detrás un panel del color de su fondo.
  2. <rect id="qr-slot" x=".." y=".." width="${PLACA.qrSlot}" height="${PLACA.qrSlot}" fill="none"/> — el sistema pone ahí un cuadrado blanco de ${PLACA.qrSlot} mm donde se pega el QR autoadhesivo de ${PLACA.qrSticker} mm. No dibujes ningún QR y no pongas nada encima de esa zona. Dejá 2 mm libres alrededor.
  3. <circle id="nfc-zone" cx=".." cy=".." r=".." fill="none"/> con r entre ${PLACA.nfcRadioMin} y ${PLACA.nfcRadioMax} — marca dónde va el chip NFC, pegado detrás de la placa. Es el centro del arte protagonista: lo que dibujes se construye sobre y alrededor de este círculo. El círculo NFC no puede tocar el QR ni el logo.
- Elementos permitidos: g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs, linearGradient, radialGradient, stop, clipPath, mask, pattern, filter (feGaussianBlur, feOffset, feFlood, feComposite, feMerge, feMergeNode, feDropShadow, feColorMatrix, feBlend), use, symbol.
- Prohibido: <image>, <foreignObject>, <script>, <style>, atributos on*, href a archivos o URLs externas, animaciones.
- Tipografías: SOLO estas, escritas exactamente así en font-family (con font-weight y font-style que existan):
${textoFuentesParaPrompt()}
- Textos: cuerpo mínimo ${PLACA.textoMinimo} (mm) en lo secundario y entre 6 y 12 en los titulares. Usá text-anchor="middle" para centrar. Nada de texto en los ${PLACA.margenSeguro} mm del borde. Revisá ortografía y tildes.
- Colores en hex. Pensá en imprenta: contraste alto, nada de textos finos claros sobre fondos claros, degradés suaves solo en superficies chicas.
- Liviano: apuntá a menos de 25 KB. Paths con 1 o 2 decimales, reutilizá con <use> lo que se repite.`;
}
