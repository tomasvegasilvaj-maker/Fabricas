// Respuesta de Pedrito a un parte de versión: «ok» o «alerta» (el prompt contradice una corrección de Tomi o dos
// trabajadores se pisan). Pedrito no modifica nada: la app solo anota su respuesta y, con una alerta, frena la
// imagen siguiente hasta que Tomi decida.
import { z } from 'zod';
import { patearMotor } from '../motor/patear';
import { db } from '../supabase';
import type { Json } from '../tipos-db';

const Alerta = z.object({
  tipo: z.enum(['contradice_correccion', 'trabajadores_se_pisan', 'otro']),
  detalle: z.string().trim().min(3).max(600),
  correccion_id: z.uuid().nullish(),
  trabajadores: z.array(z.enum(['ideas', 'diseno', 'estructura', 'produccion', 'pedrito'])).max(5).nullish(),
});

export const EsquemaRevision = z
  .object({
    tipo: z.literal('revision'),
    fecha: z.string().trim().min(1).max(40),
    origen: z.literal('pedrito'),
    version_id: z.uuid(),
    estado: z.enum(['ok', 'alerta']),
    alertas: z.array(Alerta).max(10).default([]),
  })
  .refine((r) => r.estado === 'ok' || r.alertas.length > 0, { message: 'una alerta tiene que traer al menos un motivo en «alertas»', path: ['alertas'] });

export type CuerpoRevision = z.infer<typeof EsquemaRevision>;

export function validarRevision(cuerpo: unknown): { ok: true; datos: CuerpoRevision } | { ok: false; errores: string[] } {
  const r = EsquemaRevision.safeParse(cuerpo);
  if (!r.success) return { ok: false, errores: r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`) };
  if (Number.isNaN(Date.parse(r.data.fecha))) return { ok: false, errores: ['fecha: tiene que ser ISO 8601'] };
  return { ok: true, datos: r.data };
}

export async function guardarRevision(r: CuerpoRevision) {
  const { data: parte, error } = await db().from('fab_partes_version').select('id, pedido_id, version_numero, pedido_numero').eq('version_id', r.version_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!parte) return { encontrado: false as const };
  const { error: e2 } = await db()
    .from('fab_partes_version')
    .update({ respuesta: r.estado, alertas: r.alertas as unknown as Json, respondido_at: new Date().toISOString() })
    .eq('id', parte.id);
  if (e2) throw new Error(e2.message);
  // Si Diseño está esperando esta revisión, que la vea ya y no en la próxima vuelta.
  await patearMotor(1).catch(() => undefined);
  return { encontrado: true as const, pedido_numero: parte.pedido_numero, version_numero: parte.version_numero };
}
