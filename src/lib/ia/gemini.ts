// Generación de imágenes con Gemini (Nano Banana). Lo usa el agente Diseño: una sola imagen por ronda.
import { db } from '../supabase';
import { ErrorPaso, type ContextoIA } from './claude';

export const MODELO_IMAGEN_POR_DEFECTO = 'gemini-3-pro-image-preview';
const URL_API = 'https://generativelanguage.googleapis.com/v1beta/models';

export function modeloImagen() {
  return process.env.GEMINI_IMAGE_MODEL?.trim() || MODELO_IMAGEN_POR_DEFECTO;
}

/** Costo aproximado por imagen (precios de lista de Google; se anota en el gasto del pedido). */
export function costoImagenUsd(modelo: string) {
  return /pro/i.test(modelo) ? 0.134 : 0.039;
}

export type ImagenGenerada = { datos: Buffer; mime: string; modelo: string; costo: number; texto: string | null };

type Parte = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };
type RespuestaGemini = {
  candidates?: { content?: { parts?: Parte[] }; finishReason?: string; finishMessage?: string }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** Pasa la respuesta de Gemini a una imagen o a un ErrorPaso con el motivo (exportada para las pruebas). */
export function leerRespuestaGemini(status: number, cuerpo: RespuestaGemini, modelo: string): Omit<ImagenGenerada, 'costo' | 'modelo'> {
  if (status === 401 || status === 403) {
    throw new ErrorPaso(`Gemini no aceptó la clave (${cuerpo.error?.message ?? status}). Revisá GEMINI_API_KEY en Vercel.`, false);
  }
  if (status === 404) {
    throw new ErrorPaso(`Gemini no encontró el modelo «${modelo}». Cambiá GEMINI_IMAGE_MODEL en Vercel por uno de imágenes habilitado.`, false);
  }
  if (status === 429) throw new ErrorPaso('Gemini pidió esperar (límite de uso). Se reintenta solo.', true, 120);
  if (status >= 500) throw new ErrorPaso(`Gemini falló (${status}): ${cuerpo.error?.message ?? 'sin detalle'}`, true, 60);
  if (status >= 400) throw new ErrorPaso(`Gemini rechazó el pedido (${status}): ${cuerpo.error?.message ?? 'sin detalle'}`, false);

  if (cuerpo.promptFeedback?.blockReason) {
    throw new ErrorPaso(`Gemini bloqueó el prompt (${cuerpo.promptFeedback.blockReason}). Ajustá el prompt del rubro o la idea.`, false);
  }
  const candidato = cuerpo.candidates?.[0];
  const partes = candidato?.content?.parts ?? [];
  let texto: string | null = null;
  for (const p of partes) {
    const inline = p.inlineData ?? (p.inline_data ? { mimeType: p.inline_data.mime_type, data: p.inline_data.data } : undefined);
    if (inline?.data) return { datos: Buffer.from(inline.data, 'base64'), mime: inline.mimeType ?? 'image/png', texto };
    if (p.text) texto = (texto ? `${texto}\n` : '') + p.text;
  }
  const motivo = candidato?.finishReason ?? 'sin imagen';
  const bloqueo = /SAFETY|PROHIBITED|BLOCKLIST|RECITATION/i.test(motivo);
  throw new ErrorPaso(`Gemini no devolvió imagen (${motivo})${texto ? `: ${texto.slice(0, 300)}` : ''}.`, !bloqueo, 30);
}

/** Una imagen vertical 2:3 (la proporción de la placa de 10 × 15). Suma el costo al pedido. */
export async function generarImagen(op: { ctx: ContextoIA; prompt: string }): Promise<ImagenGenerada> {
  const clave = process.env.GEMINI_API_KEY?.trim();
  if (!clave) throw new ErrorPaso('Falta la clave de Gemini (GEMINI_API_KEY) en Vercel para que Diseño genere la imagen.', false);
  const modelo = modeloImagen();
  const restante = op.ctx.vence - Date.now();
  if (restante < 30_000) throw new ErrorPaso('No alcanzó el tiempo para generar la imagen; se sigue en la próxima vuelta.', true, 5);

  const corte = AbortSignal.timeout(restante - 5_000);
  let res: Response;
  try {
    res = await fetch(`${URL_API}/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: op.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '2:3', ...(/pro/i.test(modelo) ? { imageSize: '2K' } : {}) },
        },
      }),
      signal: corte,
    });
  } catch (e) {
    if (corte.aborted) throw new ErrorPaso('Gemini tardó más de lo que permite una vuelta del motor.', true, 5);
    throw new ErrorPaso(`No se pudo llegar a Gemini: ${e instanceof Error ? e.message : String(e)}`, true, 60);
  }
  const cuerpo = (await res.json().catch(() => ({}))) as RespuestaGemini;
  const imagen = leerRespuestaGemini(res.status, cuerpo, modelo);

  const costo = costoImagenUsd(modelo);
  const { error } = await db().rpc('fab_sumar_costo', { p_pedido: op.ctx.pedidoId, p_paso: op.ctx.pasoId, p_usd: costo });
  if (error) console.error('No se pudo sumar el costo de la imagen:', error.message);
  return { ...imagen, modelo, costo };
}
