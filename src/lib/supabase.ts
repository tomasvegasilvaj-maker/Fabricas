import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import type { Database, Json } from './tipos-db';

export type Db = SupabaseClient<Database>;

let cliente: Db | null = null;

/** Cliente con la clave de servicio: solo se usa en el servidor. */
export function db(): Db {
  if (!cliente) {
    cliente = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}

export const BUCKET = 'fabrica';

/** Lanza el error de Supabase con un mensaje legible (y si no volvió nada cuando se esperaba algo). */
export function revisar<R extends { data: unknown; error: { message: string } | null }>(resultado: R, que: string): NonNullable<R['data']> {
  if (resultado.error) throw new Error(`${que}: ${resultado.error.message}`);
  if (resultado.data === null || resultado.data === undefined) throw new Error(`${que}: no volvió ningún dato`);
  return resultado.data as NonNullable<R['data']>;
}

export async function subirArchivo(path: string, datos: Buffer | Uint8Array, mime: string) {
  const { error } = await db().storage.from(BUCKET).upload(path, datos, { contentType: mime, upsert: true });
  if (error) throw new Error(`No se pudo guardar ${path}: ${error.message}`);
  return path;
}

export async function bajarArchivo(path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`No se pudo leer ${path}: ${error?.message ?? 'vacío'}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function borrarArchivos(paths: string[]) {
  if (paths.length === 0) return;
  await db().storage.from(BUCKET).remove(paths);
}

/** Registra un archivo del pedido para que aparezca en la app. */
export async function registrarArchivo(a: {
  pedidoId?: string | null;
  comercioId?: string | null;
  tipo: string;
  nombre?: string;
  path: string;
  mime: string;
  bytes?: number;
  meta?: Json;
}) {
  revisar(
    await db()
      .from('fab_archivos')
      .upsert(
        {
          pedido_id: a.pedidoId ?? null,
          comercio_id: a.comercioId ?? null,
          tipo: a.tipo,
          nombre: a.nombre ?? null,
          path: a.path,
          mime: a.mime,
          bytes: a.bytes ?? null,
          meta: a.meta ?? {},
        },
        { onConflict: 'path' },
      )
      .select('id'),
    'registrar archivo',
  );
}

export async function registrarEvento(
  pedidoId: string | null,
  mensaje: string,
  opciones: { pasoId?: string | null; nivel?: 'info' | 'aviso' | 'error'; datos?: Json } = {},
) {
  // Un evento que no se puede guardar no tiene que frenar el trabajo.
  const { error } = await db()
    .from('fab_eventos')
    .insert({
      pedido_id: pedidoId,
      paso_id: opciones.pasoId ?? null,
      nivel: opciones.nivel ?? 'info',
      mensaje: mensaje.slice(0, 2000),
      datos: opciones.datos ?? null,
    });
  if (error) console.error('No se pudo registrar el evento:', error.message);
}
