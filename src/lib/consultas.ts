import { db, revisar } from './supabase';
import type { ArchivoRow, ComercioRow, ConceptoRow, EventoRow, InspiracionRow, PasoRow, PedidoRow, PreviaRow, VersionRow } from './tipos-db';

export type PedidoConComercio = PedidoRow & { comercio: Pick<ComercioRow, 'id' | 'nombre' | 'rubro' | 'ciudad'> | null };
export type PreviaConPedido = PreviaRow & { pedido: PedidoConComercio | null };

const SELECT_PEDIDO = '*, comercio:fab_comercios(id, nombre, rubro, ciudad)';

export async function resumenFabrica() {
  const [activos, listos, previas, qr, fallidos] = await Promise.all([
    db().from('fab_pedidos').select(SELECT_PEDIDO).in('estado', ['en_marcha', 'en_espera', 'pausado']).order('updated_at', { ascending: false }),
    db().from('fab_pedidos').select(SELECT_PEDIDO).eq('estado', 'listo').order('terminado_at', { ascending: false }).limit(6),
    db().from('fab_previas').select('*, pedido:fab_pedidos(' + SELECT_PEDIDO + ')').eq('estado', 'pendiente').order('created_at'),
    db().from('fab_qr_lote').select('estado'),
    db().from('fab_pasos').select('id', { count: 'exact', head: true }).eq('estado', 'fallido').gte('terminado_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);
  const lote = (qr.data ?? []).reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.estado]: (acc[f.estado] ?? 0) + 1 }), {});
  return {
    activos: revisar(activos, 'pedidos activos') as unknown as PedidoConComercio[],
    listos: revisar(listos, 'pedidos listos') as unknown as PedidoConComercio[],
    previas: revisar(previas, 'previas') as unknown as PreviaConPedido[],
    lote: { libres: lote.libre ?? 0, asignados: lote.asignado ?? 0, reservados: lote.reservado ?? 0, total: qr.data?.length ?? 0 },
    fallosSemana: fallidos.count ?? 0,
  };
}

export async function contarPrevias() {
  const { count } = await db().from('fab_previas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
  return count ?? 0;
}

export async function previasPendientes(pedidoId?: string) {
  let q = db().from('fab_previas').select('*, pedido:fab_pedidos(' + SELECT_PEDIDO + ')').eq('estado', 'pendiente').order('created_at');
  if (pedidoId) q = q.eq('pedido_id', pedidoId);
  return revisar(await q, 'previas') as unknown as PreviaConPedido[];
}

export async function listaPedidos(limite = 100) {
  return revisar(await db().from('fab_pedidos').select(SELECT_PEDIDO).order('created_at', { ascending: false }).limit(limite), 'pedidos') as unknown as PedidoConComercio[];
}

export type DetallePedido = {
  pedido: PedidoRow;
  comercio: ComercioRow;
  pasos: PasoRow[];
  previas: PreviaRow[];
  conceptos: ConceptoRow[];
  versiones: VersionRow[];
  inspiracion: InspiracionRow[];
  archivos: ArchivoRow[];
  eventos: EventoRow[];
};

export async function detallePedido(id: string): Promise<DetallePedido | null> {
  const { data: pedido } = await db().from('fab_pedidos').select('*').eq('id', id).maybeSingle();
  if (!pedido) return null;
  const [comercio, pasos, previas, conceptos, versiones, inspiracion, archivos, eventos] = await Promise.all([
    db().from('fab_comercios').select('*').eq('id', pedido.comercio_id).single(),
    db().from('fab_pasos').select('*').eq('pedido_id', id).order('created_at'),
    db().from('fab_previas').select('*').eq('pedido_id', id).order('created_at', { ascending: false }),
    db().from('fab_conceptos').select('*').eq('pedido_id', id).order('tanda', { ascending: false }).order('indice'),
    db().from('fab_versiones').select('*').eq('pedido_id', id).order('created_at', { ascending: false }),
    db().from('fab_inspiracion').select('*').eq('pedido_id', id).order('created_at'),
    db().from('fab_archivos').select('*').or(`pedido_id.eq.${id},comercio_id.eq.${pedido.comercio_id}`).order('created_at', { ascending: false }),
    db().from('fab_eventos').select('*').eq('pedido_id', id).order('id', { ascending: false }).limit(200),
  ]);
  return {
    pedido,
    comercio: revisar(comercio, 'comercio'),
    pasos: pasos.data ?? [],
    previas: previas.data ?? [],
    conceptos: conceptos.data ?? [],
    versiones: versiones.data ?? [],
    inspiracion: inspiracion.data ?? [],
    archivos: archivos.data ?? [],
    eventos: eventos.data ?? [],
  };
}

/** Datos que necesita cada tarjeta de Previa para mostrarse (bocetos, versión a aprobar, etc.). */
export async function datosParaPrevia(previa: PreviaRow) {
  const d = (previa.datos ?? {}) as Record<string, unknown>;
  if (previa.tipo === 'elegir_concepto') {
    const tanda = Number(d.tanda ?? 1);
    const { data: conceptos } = await db().from('fab_conceptos').select('*').eq('pedido_id', previa.pedido_id).eq('tanda', tanda).order('indice');
    const ids = (conceptos ?? []).map((c) => c.id);
    const { data: versiones } = ids.length
      ? await db().from('fab_versiones').select('*').in('concepto_id', ids).eq('origen', 'boceto').order('created_at', { ascending: false })
      : { data: [] as VersionRow[] };
    return { conceptos: conceptos ?? [], versiones: versiones ?? [] };
  }
  if ((previa.tipo === 'aprobar_final' || previa.tipo === 'falta_dato') && d.version_id) {
    const { data: version } = await db().from('fab_versiones').select('*').eq('id', String(d.version_id)).maybeSingle();
    return { version };
  }
  if (previa.tipo === 'fallo' && d.paso_id) {
    const { data: paso } = await db().from('fab_pasos').select('*').eq('id', String(d.paso_id)).maybeSingle();
    return { paso };
  }
  return {};
}

export async function preferencias() {
  return revisar(await db().from('fab_preferencias').select('*').order('activo', { ascending: false }).order('created_at', { ascending: false }), 'preferencias');
}

export async function loteQr() {
  return revisar(await db().from('fab_qr_lote').select('*').order('lote').order('n'), 'lote');
}
