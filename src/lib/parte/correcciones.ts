// Correcciones que Pedrito (el bot de Grok) le devuelve a la app después de leer un parte.
// Solo se aceptan reglas de texto en este formato: nada del cuerpo se ejecuta ni se interpreta como código.
// Se guardan en fab_reglas_agente (la misma tabla que ya leen Ideas, Diseño, Estructura, Producción y Pedrito).
import { z } from 'zod';
import { bearerValido } from '../sesion';
import { db } from '../supabase';
import type { Json } from '../tipos-db';

export const AGENTES_CORRECCION = ['ideas', 'diseno', 'estructura', 'produccion', 'pedrito'] as const;
export type AgenteCorreccion = (typeof AGENTES_CORRECCION)[number];

/** Tope de tamaño del cuerpo: un lote de correcciones de texto no necesita más. */
export const MAX_BYTES_CORRECCIONES = 64 * 1024;

const uuidONulo = z.preprocess((v) => (v === '' || v === 'null' ? null : v), z.uuid().nullable().optional());

const Correccion = z.object({
  agente: z.enum(AGENTES_CORRECCION),
  regla: z
    .string()
    // Una sola línea, sin viñetas ni espacios de más. Si es larga se rechaza (no se corta a escondidas).
    .transform((t) => t.replace(/[\r\n]+/g, ' ').replace(/^\s*[-*•]+\s*/, '').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(3, 'la regla es muy corta').max(240, 'la regla supera los 240 caracteres: mandala más corta')),
  reemplaza_a: uuidONulo,
  motivo: z.string().trim().max(300).nullish(),
});

export const EsquemaCorrecciones = z.object({
  tipo: z.literal('correcciones'),
  fecha: z.string().trim().min(1).max(40),
  origen: z.literal('pedrito'),
  pedido_id: uuidONulo,
  correcciones: z.array(Correccion).min(1).max(20),
});
export type CuerpoCorrecciones = z.infer<typeof EsquemaCorrecciones>;

/** Bearer PARTE_CORRECCIONES_SECRET. Si el secreto no está cargado en Vercel, no entra nadie. */
export function correccionesAutorizadas(cabecera: string | null) {
  const secreto = process.env.PARTE_CORRECCIONES_SECRET?.trim() || null;
  return bearerValido(cabecera, secreto);
}

export function validarCorrecciones(cuerpo: unknown): { ok: true; datos: CuerpoCorrecciones } | { ok: false; errores: string[] } {
  const r = EsquemaCorrecciones.safeParse(cuerpo);
  if (r.success) {
    if (Number.isNaN(Date.parse(r.data.fecha))) return { ok: false, errores: ['fecha: tiene que ser ISO 8601 (por ejemplo 2026-11-12T10:30:00-03:00)'] };
    return { ok: true, datos: r.data };
  }
  return { ok: false, errores: r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`) };
}

export type ReglaGuardada = { id: string; agente: string; resumen: string; reemplaza_a: string | null; ya_existia: boolean };

/** Guarda todas las correcciones o ninguna (una sola función en la base). */
export async function guardarCorrecciones(c: CuerpoCorrecciones): Promise<ReglaGuardada[]> {
  const filas = c.correcciones.map((x) => ({ agente: x.agente, regla: x.regla, reemplaza_a: x.reemplaza_a ?? null, motivo: x.motivo ?? null }));
  const { data, error } = await db().rpc('fab_guardar_correcciones', { p_pedido: c.pedido_id ?? null, p_correcciones: filas as unknown as Json });
  if (error) throw new ErrorCorrecciones(error.code, error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    agente: r.agente,
    resumen: r.texto.length > 120 ? `${r.texto.slice(0, 117)}…` : r.texto,
    reemplaza_a: r.reemplaza_a,
    ya_existia: r.ya_existia,
  }));
}

export class ErrorCorrecciones extends Error {
  /** 4xx si el problema está en lo que mandó Pedrito (id inexistente, agente que no coincide); 500 si es de la base. */
  readonly status: number;
  constructor(codigo: string | undefined, mensaje: string) {
    super(mensaje);
    this.status = codigo === 'P0002' ? 404 : codigo === '22023' || codigo === '22P02' || codigo === '23514' ? 422 : 500;
  }
}
