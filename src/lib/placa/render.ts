import { renderAsync, type ResvgRenderOptions } from '@resvg/resvg-js';
import { archivosDeFuentes, familiasEnSvg, FUENTE_POR_DEFECTO } from './fuentes';
import { PLACA } from './especificacion';

export type Render = { png: Buffer; ancho: number; alto: number };

const MM_POR_PULGADA = 25.4;
const ANCHO_CON_SANGRADO = PLACA.ancho + 2 * PLACA.sangrado;

function opciones(svg: string, fitTo: ResvgRenderOptions['fitTo'], extra: Partial<ResvgRenderOptions> = {}): ResvgRenderOptions {
  return {
    fitTo,
    font: {
      fontFiles: archivosDeFuentes(familiasEnSvg(svg)),
      loadSystemFonts: false,
      defaultFontFamily: FUENTE_POR_DEFECTO,
      sansSerifFamily: FUENTE_POR_DEFECTO,
      serifFamily: 'DM Serif Display',
      cursiveFamily: 'Dancing Script',
    },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
    logLevel: 'off',
    ...extra,
  };
}

/** Dibuja la placa completa (con sangrado) a un ancho en píxeles. */
export async function renderizar(svg: string, anchoPx: number, fondo?: string): Promise<Render> {
  const img = await renderAsync(svg, opciones(svg, { mode: 'width', value: Math.round(anchoPx) }, fondo ? { background: fondo } : {}));
  return { png: img.asPng(), ancho: img.width, alto: img.height };
}

/** Píxeles de ancho de la placa con sangrado para una resolución dada. */
export function anchoParaDpi(dpi: number) {
  return Math.round((ANCHO_CON_SANGRADO / MM_POR_PULGADA) * dpi);
}

/** Vista previa liviana para la app y para el agente revisor. */
export function renderizarVista(svg: string, anchoPx = 900) {
  return renderizar(svg, anchoPx);
}

/**
 * Revisa que el fondo llegue hasta el borde del sangrado: si queda algo transparente en el
 * milímetro exterior, al cortar puede aparecer un filete blanco.
 */
export async function revisarSangrado(svg: string): Promise<string | null> {
  const porMm = 2;
  const img = await renderAsync(svg, opciones(svg, { mode: 'width', value: ANCHO_CON_SANGRADO * porMm }));
  const { width: ancho, height: alto } = img;
  const px = img.pixels;
  let transparentes = 0;
  let total = 0;
  const borde = porMm; // 1 mm
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (x >= borde && x < ancho - borde && y >= borde && y < alto - borde) continue;
      total++;
      if (px[(y * ancho + x) * 4 + 3] < 250) transparentes++;
    }
  }
  if (transparentes / total > 0.01) {
    return `El fondo no llega al sangrado: ${Math.round((transparentes / total) * 100)} % del borde exterior quedó vacío. Empezá con un rect de fondo x="-3" y="-3" width="106" height="156".`;
  }
  return null;
}
