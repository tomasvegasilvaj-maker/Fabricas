import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ErrorPaso } from '../ia/claude';
import { dataUri } from '../placa/logo';
import { renderizarVista, revisarSangrado } from '../placa/render';
import { armarSvgFinal, extraerSvg, limpiarYValidar, type ChequeoSvg } from '../placa/svg';
import { db, revisar, subirArchivo } from '../supabase';
import type { ComercioRow, Json, VersionRow } from '../tipos-db';
import { logoDelComercio } from './comun';

let qrMuestra: string | null = null;
export function qrMuestraDataUri() {
  qrMuestra ??= dataUri(readFileSync(path.join(process.cwd(), 'assets', 'qr-muestra.png')));
  return qrMuestra;
}

/** Arma la vista previa (logo real + QR de muestra) de un SVG ya limpio. */
export async function vistaPrevia(svgLimpio: string, comercio: ComercioRow, anchoPx = 900) {
  const { png: logo } = await logoDelComercio(comercio);
  const final = armarSvgFinal(svgLimpio, { logoDataUri: dataUri(logo), modoQr: 'muestra', qrMuestraDataUri: qrMuestraDataUri() });
  return { final, render: await renderizarVista(final, anchoPx) };
}

/**
 * Toma la respuesta del diseñador, la limpia y la chequea, dibuja la vista previa y guarda la versión.
 * Si ni siquiera hay un SVG legible, el paso se reintenta.
 */
export async function guardarVersion(op: {
  respuesta: string;
  pedidoId: string;
  comercio: ComercioRow;
  conceptoId: string | null;
  origen: 'boceto' | 'elaboracion';
  numero: number;
  notas?: string | null;
}): Promise<{ version: VersionRow; chequeo: ChequeoSvg }> {
  const crudo = extraerSvg(op.respuesta);
  if (!crudo) throw new ErrorPaso('La IA no devolvió un SVG.', true, 5);
  const { svg, chequeo } = limpiarYValidar(crudo);
  if (!svg) throw new ErrorPaso(`El SVG vino roto: ${chequeo.errores.join(' ')}`, true, 5);

  const { final, render } = await vistaPrevia(svg, op.comercio);
  const sangrado = await revisarSangrado(final);
  if (sangrado) chequeo.errores.push(sangrado);

  const id = randomUUID();
  const previewPath = `pedidos/${op.pedidoId}/versiones/${id}.png`;
  await subirArchivo(previewPath, render.png, 'image/png');
  const version = revisar(
    await db()
      .from('fab_versiones')
      .insert({
        id,
        pedido_id: op.pedidoId,
        concepto_id: op.conceptoId,
        numero: op.numero,
        origen: op.origen,
        svg,
        preview_path: previewPath,
        notas: op.notas ?? null,
        chequeo: chequeo as unknown as Json,
      })
      .select('*')
      .single(),
    'guardar versión',
  );
  return { version, chequeo };
}

export function textoChequeo(chequeo: ChequeoSvg | null | undefined) {
  if (!chequeo) return 'Sin chequeo automático.';
  const partes: string[] = [];
  if (chequeo.errores.length) partes.push(`Errores técnicos (hay que corregirlos):\n${chequeo.errores.map((e) => `- ${e}`).join('\n')}`);
  if (chequeo.avisos.length) partes.push(`Avisos:\n${chequeo.avisos.map((e) => `- ${e}`).join('\n')}`);
  return partes.join('\n') || 'El chequeo automático no encontró problemas.';
}
