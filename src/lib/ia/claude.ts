import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AutoParseableBetaOutputFormat } from '@anthropic-ai/sdk/lib/beta-parser';
import type { z } from 'zod';
import { db } from '../supabase';
import { MODELO, costoEstimadoCorte, costoUsd } from './precios';

export type Esfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Error de un paso. `reintentable` decide si vuelve a la cola o termina en una Previa de fallo. */
export class ErrorPaso extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean,
    readonly esperaSeg = 60,
  ) {
    super(mensaje);
    this.name = 'ErrorPaso';
  }
}

export type ContextoIA = {
  pedidoId: string;
  pasoId: string;
  /** Momento (epoch ms) en que el paso tiene que haber terminado. */
  vence: number;
};

let cliente: Anthropic | null = null;

function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ErrorPaso('Falta la clave de Anthropic (ANTHROPIC_API_KEY) en Vercel.', false);
  }
  // Una clave que no está atada a un workspace tiene que decir en cuál trabajar (si no, la API contesta 400).
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  cliente ??= new Anthropic({ maxRetries: 2, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
  return cliente;
}

/** Lo que contestó Anthropic (tipo, mensaje y n.º de request) para mostrarlo en la Previa. Nunca trae la clave. */
function motivoApi(e: InstanceType<typeof Anthropic.APIError>) {
  const cuerpo = (e.error as { error?: { message?: unknown } } | undefined)?.error;
  const mensaje = typeof cuerpo?.message === 'string' ? cuerpo.message : e.message;
  return `${e.type ? `${e.type}: ` : ''}${mensaje}${e.requestID ? ` (${e.requestID})` : ''}`;
}

/** Chequeo gratis (no gasta tokens) de que la clave anda y el modelo está habilitado. Lo usa /api/salud. */
export async function chequearIA(): Promise<{ ok: boolean; motivo?: string }> {
  try {
    await anthropic().models.retrieve(MODELO, {}, { timeout: 8000, maxRetries: 0 });
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.APIError) return { ok: false, motivo: `${e.status ?? 'sin conexión'} ${motivoApi(e)}` };
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) };
  }
}

async function sumarCosto(ctx: ContextoIA, usd: number) {
  if (usd <= 0) return;
  const { error } = await db().rpc('fab_sumar_costo', { p_pedido: ctx.pedidoId, p_paso: ctx.pasoId, p_usd: Math.round(usd * 10000) / 10000 });
  if (error) console.error('No se pudo sumar el costo:', error.message);
}

/** Pasa un error de la API a un ErrorPaso con el motivo que dio Anthropic (exportada para las pruebas). */
export function traducirError(e: unknown, porTiempo: boolean): ErrorPaso {
  if (e instanceof ErrorPaso) return e;
  if (porTiempo || e instanceof Anthropic.APIUserAbortError) {
    return new ErrorPaso('La llamada a la IA tardó más de lo que permite una vuelta del motor y se cortó.', true, 5);
  }
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    const motivo = motivoApi(e);
    console.error(`Anthropic contestó ${s ?? 'sin conexión'}: ${motivo}`);
    if (s === 401) return new ErrorPaso(`Anthropic no aceptó la clave (${motivo}). Cambiá ANTHROPIC_API_KEY en Vercel y volvé a desplegar.`, false);
    if (s === 403) return new ErrorPaso(`Anthropic no deja usar esta clave para este paso (${motivo}).`, false);
    if (s === 429) return new ErrorPaso('La API de Anthropic pidió esperar (límite de uso). Se reintenta solo.', true, 120);
    if (s !== undefined && s >= 400 && s < 500) return new ErrorPaso(`La API de Anthropic rechazó el pedido (${s}): ${motivo}`, false);
    return new ErrorPaso(`La API de Anthropic falló (${s ?? 'sin conexión'}): ${motivo}`, true, 60);
  }
  return new ErrorPaso(e instanceof Error ? e.message : String(e), true, 60);
}

export type RespuestaIA<T> = {
  /** Texto de la última respuesta (sin bloques de herramientas). */
  texto: string;
  datos: T | null;
  mensaje: BetaMessage;
  costo: number;
  segundos: number;
};

/**
 * Llama a Claude con streaming (respuestas largas sin cortes), registra el costo en el pedido
 * y sigue solo si la API pausa un turno largo de herramientas del servidor (búsqueda web).
 * Los rechazos por política pasan a otro modelo automáticamente (fallbacks del lado del servidor).
 */
export async function llamarClaude<T = null>(op: {
  ctx: ContextoIA;
  etiqueta: string;
  system: string;
  contenido: string | BetaContentBlockParam[];
  herramientas?: BetaToolUnion[];
  esfuerzo?: Esfuerzo;
  maxTokens: number;
  formato?: AutoParseableBetaOutputFormat<T>;
}): Promise<RespuestaIA<T>> {
  const mensajes: BetaMessageParam[] = [{ role: 'user', content: op.contenido }];
  const inicioTotal = Date.now();
  let costoTotal = 0;

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const restante = op.ctx.vence - Date.now();
    if (restante < 20_000) throw new ErrorPaso(`No alcanzó el tiempo para ${op.etiqueta}; se sigue en la próxima vuelta.`, true, 5);
    const corte = AbortSignal.timeout(restante);
    const inicio = Date.now();
    let tokensEntrada = 0;
    let caracteres = 0;

    let mensaje: BetaMessage & { parsed_output?: T | null };
    try {
      const stream = anthropic().beta.messages.stream(
        {
          model: MODELO,
          max_tokens: op.maxTokens,
          system: op.system,
          messages: mensajes,
          ...(op.herramientas?.length ? { tools: op.herramientas } : {}),
          output_config: { effort: op.esfuerzo ?? 'medium', ...(op.formato ? { format: op.formato } : {}) },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: corte },
      );
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'message_start') tokensEntrada = ev.message.usage.input_tokens ?? 0;
      });
      stream.on('text', (d) => (caracteres += d.length));
      stream.on('thinking', (d) => (caracteres += d.length));
      mensaje = (await stream.finalMessage()) as BetaMessage & { parsed_output?: T | null };
    } catch (e) {
      if (tokensEntrada || caracteres) await sumarCosto(op.ctx, costoEstimadoCorte(tokensEntrada, caracteres, (Date.now() - inicio) / 1000));
      throw traducirError(e, corte.aborted);
    }

    const costo = costoUsd(mensaje.model, mensaje.usage);
    costoTotal += costo;
    await sumarCosto(op.ctx, costo);

    if (mensaje.stop_reason === 'pause_turn') {
      mensajes.push({ role: 'assistant', content: mensaje.content as unknown as BetaContentBlockParam[] });
      continue;
    }
    if (mensaje.stop_reason === 'refusal') {
      throw new ErrorPaso(`La IA no quiso hacer este paso (${op.etiqueta}). Probá reformular las ideas del pedido.`, false);
    }
    if (mensaje.stop_reason === 'max_tokens') {
      throw new ErrorPaso(`La respuesta de la IA se cortó por larga (${op.etiqueta}).`, true, 5);
    }
    const texto = mensaje.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { texto, datos: mensaje.parsed_output ?? null, mensaje, costo: costoTotal, segundos: (Date.now() - inicioTotal) / 1000 };
  }
  throw new ErrorPaso(`La IA no terminó ${op.etiqueta} después de varias pausas.`, true, 30);
}

/** Toma el último bloque JSON de un texto (```json … ``` o el último objeto suelto) y lo valida. */
export function extraerJson<S extends z.ZodType>(texto: string, esquema: S): z.infer<S> | null {
  const candidatos: string[] = [];
  for (const m of texto.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidatos.push(m[1]);
  const ultimaLlave = texto.lastIndexOf('}');
  if (ultimaLlave !== -1) {
    // Busca hacia atrás la llave que abre el último objeto completo.
    let profundidad = 0;
    for (let i = ultimaLlave; i >= 0; i--) {
      if (texto[i] === '}') profundidad++;
      else if (texto[i] === '{' && --profundidad === 0) {
        candidatos.push(texto.slice(i, ultimaLlave + 1));
        break;
      }
    }
  }
  for (const c of candidatos.reverse()) {
    try {
      const r = esquema.safeParse(JSON.parse(c));
      if (r.success) return r.data;
    } catch {
      // probá el siguiente
    }
  }
  return null;
}

export function imagen(datos: Buffer, mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'): BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: mime, data: datos.toString('base64') } };
}

export function texto(t: string): BetaContentBlockParam {
  return { type: 'text', text: t };
}
