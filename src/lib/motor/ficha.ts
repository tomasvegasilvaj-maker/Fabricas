// La ficha de correcciones de Tomi de cada pedido: se guardan en orden y se acumulan entre rondas
// (una nueva no pisa a las anteriores). Diseño arma cada prompt nuevo desde esta ficha.
import { db, revisar } from '../supabase';
import type { CorreccionPedidoRow } from '../tipos-db';

export async function correccionesDelPedido(pedidoId: string): Promise<CorreccionPedidoRow[]> {
  return revisar(await db().from('fab_correcciones_pedido').select('*').eq('pedido_id', pedidoId).order('orden'), 'leer correcciones del pedido');
}

/** Agrega una corrección al final de la ficha (si dos llegan juntas, la segunda toma el número siguiente). */
export async function agregarCorreccion(op: { pedidoId: string; texto: string; versionId?: string | null; baseVersionId?: string | null }): Promise<CorreccionPedidoRow> {
  for (let intento = 0; intento < 3; intento++) {
    const { data: ultima } = await db().from('fab_correcciones_pedido').select('orden').eq('pedido_id', op.pedidoId).order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await db()
      .from('fab_correcciones_pedido')
      .insert({ pedido_id: op.pedidoId, orden: (ultima?.orden ?? 0) + 1, texto: op.texto.trim(), version_id: op.versionId ?? null, base_version_id: op.baseVersionId ?? null })
      .select('*')
      .single();
    if (!error && data) return data;
    if (error?.code !== '23505') throw new Error(`No se pudo guardar la corrección: ${error?.message ?? 'sin datos'}`);
  }
  throw new Error('No se pudo guardar la corrección (se cruzaron varias a la vez).');
}

/** «partí de la versión 3», «parti de la v3», «desde la versión 3»: el número de versión, o null. */
export function versionDePartida(texto: string): number | null {
  const m = /(?:part[ií](?:r|endo)?|arranc[aá]|empez[aá]|desde)\s+(?:de\s+)?(?:la\s+)?(?:versi[oó]n|v)\s*\.?\s*(\d{1,3})\b/i.exec(texto);
  return m ? Number(m[1]) : null;
}

/** El texto de las correcciones para el prompt: todas, en orden, aclarando que ninguna se descarta. */
export function textoCorreccionesTomi(correcciones: { orden: number; texto: string }[]) {
  if (correcciones.length === 0) return '';
  return `Client corrections, in the order they were requested. ALL of them still apply: a later one only refines an earlier one, it never cancels it unless it says so explicitly.\n${correcciones
    .map((c) => `${c.orden}. ${c.texto}`)
    .join('\n')}`;
}
