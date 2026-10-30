import { createHmac } from 'node:crypto';
import { bearerValido } from '../sesion';
import { db } from '../supabase';

/**
 * Clave con la que la app se despierta a sí misma (trabajadores en paralelo). Se deriva de la clave de
 * Supabase, así que no hay que inventarla ni guardarla en ningún lado.
 */
export function claveInterna(): string | null {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base ? createHmac('sha256', base).update('fab:motor').digest('hex') : null;
}

let delLatido: { valor: string | null; hasta: number } | null = null;

/** Clave del latido de Supabase (el cron): vive en Vault como `fab_motor_secret`. */
async function claveDelLatido(): Promise<string | null> {
  if (delLatido && delLatido.hasta > Date.now()) return delLatido.valor;
  const { data, error } = await db().rpc('fab_secreto_motor');
  if (error) console.error('No se pudo leer la clave del latido:', error.message);
  // Si todavía no existe, se vuelve a mirar en un minuto (no en cada pedido).
  delLatido = { valor: data || null, hasta: Date.now() + (data ? 10 : 1) * 60_000 };
  return delLatido.valor;
}

/** El motor acepta a la propia app o al latido de Supabase. */
export async function motorAutorizado(cabecera: string | null): Promise<boolean> {
  if (bearerValido(cabecera, claveInterna())) return true;
  return bearerValido(cabecera, await claveDelLatido());
}

let urlAnotada = false;

/**
 * El latido de Supabase necesita saber a qué URL llamar: la app de producción la anota sola en `fab_config`
 * la primera vez que corre el motor (las Preview no, para no robarle el latido a producción).
 */
export async function anotarUrlDelLatido(url: string) {
  if (urlAnotada || process.env.VERCEL_ENV !== 'production') return;
  const { error } = await db().from('fab_config').upsert({ clave: 'app_url', valor: url, updated_at: new Date().toISOString() });
  if (error) console.error('No se pudo anotar la URL del latido:', error.message);
  else urlAnotada = true;
}

export type EstadoLatido = { url: string | null; clave: boolean; ultima: string | null };

/** Para Ajustes: si el latido ya tiene URL y clave, y cuándo corrió por última vez. */
export async function estadoLatido(): Promise<EstadoLatido | null> {
  const { data, error } = await db().rpc('fab_estado_latido');
  if (error || !data) return null;
  return data as EstadoLatido;
}
