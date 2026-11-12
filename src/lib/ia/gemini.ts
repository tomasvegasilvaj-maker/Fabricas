// Generación de imágenes con Gemini (Nano Banana). Lo usa el agente Diseño: una sola imagen por ronda.
// Dos caminos para el mismo modelo: Vercel AI Gateway (AI_GATEWAY_API_KEY, se paga con créditos de Vercel)
// o la API de Google directo (GEMINI_API_KEY, pide facturación en Google). Si están las dos, va por el Gateway.
import { db } from '../supabase';
import { ErrorPaso, type ContextoIA } from './claude';

export const MODELO_IMAGEN_POR_DEFECTO = 'gemini-3-pro-image-preview';
const URL_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const URL_GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export type ProveedorImagen = 'gateway' | 'google' | null;

/** Por dónde salen las imágenes según las claves cargadas en Vercel. */
export function proveedorImagen(): ProveedorImagen {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return 'gateway';
  if (process.env.GEMINI_API_KEY?.trim()) return 'google';
  return null;
}

/** El nombre del modelo como lo pide cada camino: el Gateway usa «google/…» y sin «-preview». */
export function modeloParaGateway(modelo: string) {
  return modelo.includes('/') ? modelo : `google/${modelo.replace(/-preview$/, '')}`;
}

export function modeloImagen(proveedor: ProveedorImagen = proveedorImagen()) {
  const modelo = process.env.GEMINI_IMAGE_MODEL?.trim() || MODELO_IMAGEN_POR_DEFECTO;
  return proveedor === 'gateway' ? modeloParaGateway(modelo) : modelo.replace(/^google\//, '');
}

/** Costo aproximado por imagen (precios de lista de Google, iguales en el Gateway; se anota en el gasto del pedido). */
export function costoImagenUsd(modelo: string) {
  if (/pro/i.test(modelo)) return 0.134;
  if (/3\.1-flash-image/i.test(modelo)) return 0.067;
  return 0.039;
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

type RespuestaGateway = {
  choices?: { message?: { content?: string | null; images?: { type?: string; image_url?: { url?: string } }[] }; finish_reason?: string }[];
  error?: { message?: string; type?: string; code?: string | number } | string;
};

function mensajeGateway(cuerpo: RespuestaGateway) {
  return typeof cuerpo.error === 'string' ? cuerpo.error : (cuerpo.error?.message ?? '');
}

/** Pasa la respuesta del AI Gateway a una imagen o a un ErrorPaso con el motivo (exportada para las pruebas). */
export function leerRespuestaGateway(status: number, cuerpo: RespuestaGateway, modelo: string): Omit<ImagenGenerada, 'costo' | 'modelo'> {
  const detalle = mensajeGateway(cuerpo);
  const sinCredito = status === 402 || /insufficient[_ ](funds|credits?|balance)|out of credits|credit balance/i.test(detalle);
  if (sinCredito && status >= 400) {
    throw new ErrorPaso(`El AI Gateway de Vercel no tiene crédito para la imagen (${detalle || status}). Cargá créditos en Vercel → AI Gateway.`, false);
  }
  if (status === 401 || status === 403) {
    throw new ErrorPaso(`El AI Gateway no aceptó la clave (${detalle || status}). Revisá AI_GATEWAY_API_KEY en Vercel.`, false);
  }
  if (status === 404 || (status === 400 && /model/i.test(detalle))) {
    throw new ErrorPaso(`El AI Gateway no encontró el modelo «${modelo}» (${detalle || status}). Cambiá GEMINI_IMAGE_MODEL en Vercel por uno de imágenes del Gateway.`, false);
  }
  if (status === 429) throw new ErrorPaso('El AI Gateway pidió esperar (límite de uso). Se reintenta solo.', true, 120);
  if (status >= 500) throw new ErrorPaso(`El AI Gateway falló (${status}): ${detalle || 'sin detalle'}`, true, 60);
  if (status >= 400) throw new ErrorPaso(`El AI Gateway rechazó el pedido (${status}): ${detalle || 'sin detalle'}`, false);

  const eleccion = cuerpo.choices?.[0];
  const texto = eleccion?.message?.content?.trim() || null;
  for (const img of eleccion?.message?.images ?? []) {
    const url = img.image_url?.url ?? '';
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (m) return { datos: Buffer.from(m[2], 'base64'), mime: m[1], texto };
  }
  const motivo = eleccion?.finish_reason ?? 'sin imagen';
  const bloqueo = /safety|content_filter|prohibited|blocklist|recitation/i.test(motivo);
  throw new ErrorPaso(`El AI Gateway no devolvió imagen (${motivo})${texto ? `: ${texto.slice(0, 300)}` : ''}.`, !bloqueo, 30);
}

/** Una imagen vertical 2:3 (la proporción de la placa de 10 × 15). Suma el costo al pedido. */
export async function generarImagen(op: { ctx: ContextoIA; prompt: string }): Promise<ImagenGenerada> {
  const proveedor = proveedorImagen();
  if (!proveedor) {
    throw new ErrorPaso('Falta la clave para las imágenes de Diseño: cargá AI_GATEWAY_API_KEY (Vercel AI Gateway) o GEMINI_API_KEY (Google) en Vercel.', false);
  }
  const modelo = modeloImagen(proveedor);
  const restante = op.ctx.vence - Date.now();
  if (restante < 30_000) throw new ErrorPaso('No alcanzó el tiempo para generar la imagen; se sigue en la próxima vuelta.', true, 5);

  const corte = AbortSignal.timeout(restante - 5_000);
  const imagen = proveedor === 'gateway' ? await pedirAlGateway(op.prompt, modelo, corte) : await pedirAGoogle(op.prompt, modelo, corte);

  const costo = costoImagenUsd(modelo);
  const { error } = await db().rpc('fab_sumar_costo', { p_pedido: op.ctx.pedidoId, p_paso: op.ctx.pasoId, p_usd: costo });
  if (error) console.error('No se pudo sumar el costo de la imagen:', error.message);
  return { ...imagen, modelo, costo };
}

async function pedirAlGateway(prompt: string, modelo: string, corte: AbortSignal) {
  const clave = process.env.AI_GATEWAY_API_KEY!.trim();
  let res: Response;
  try {
    res = await fetch(URL_GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['text', 'image'],
        stream: false,
        // Se le pasa a Google tal cual: vertical 2:3 y, en el modelo pro, 2K.
        providerOptions: { google: { imageConfig: { aspectRatio: '2:3', ...(/pro/i.test(modelo) ? { imageSize: '2K' } : {}) } } },
      }),
      signal: corte,
    });
  } catch (e) {
    if (corte.aborted) throw new ErrorPaso('El AI Gateway tardó más de lo que permite una vuelta del motor.', true, 5);
    throw new ErrorPaso(`No se pudo llegar al AI Gateway: ${e instanceof Error ? e.message : String(e)}`, true, 60);
  }
  const cuerpo = (await res.json().catch(() => ({}))) as RespuestaGateway;
  return leerRespuestaGateway(res.status, cuerpo, modelo);
}

async function pedirAGoogle(prompt: string, modelo: string, corte: AbortSignal) {
  const clave = process.env.GEMINI_API_KEY!.trim();
  let res: Response;
  try {
    res = await fetch(`${URL_API}/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
  return leerRespuestaGemini(res.status, cuerpo, modelo);
}
