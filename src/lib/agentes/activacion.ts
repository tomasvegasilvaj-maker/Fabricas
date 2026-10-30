import { destinoSugerido } from '../motor/destino';
import { urlQr } from '../motor/flujo';
import type { Agente } from '../motor/tipos';
import { db, revisar } from '../supabase';
import { entrada } from './comun';

/** Activación: asigna el próximo QR libre del lote y lo apunta al link. El NFC se graba con la misma URL. */
export const activacion: Agente = async ({ comercio, pedido, paso }) => {
  const e = entrada<{ version_id: string; destino: string | null }>(paso.entrada);
  const placeId = (comercio.investigacion as { contacto?: { place_id?: string | null } } | null)?.contacto?.place_id ?? null;
  const destino = e.destino ?? pedido.destino_url ?? destinoSugerido(pedido.objetivo, comercio, placeId).url;
  if (!destino) {
    return {
      salida: { falta: 'destino' },
      resumen: 'Falta el link al que tiene que apuntar el QR.',
      previa: {
        tipo: 'falta_dato',
        titulo: `Falta el link de destino de ${comercio.nombre}`,
        detalle: 'Pegá el link al que tienen que llevar el QR y el NFC (reseñas de Google, WhatsApp, Instagram, etc.).',
        datos: { campo: 'destino', version_id: e.version_id ?? null },
      },
      pedidoEstado: 'en_espera',
      pedidoEtapa: 'activacion',
    };
  }

  const filas = revisar(
    await db().rpc('fab_asignar_qr', { p_pedido: pedido.id, p_url: destino, p_etiqueta: comercio.nombre, p_simular: pedido.simulado }),
    'asignar QR',
  );
  const qr = filas[0];
  if (!qr) throw new Error('No se pudo asignar un QR del lote.');

  if (!pedido.simulado) {
    await db().from('fab_pedidos').update({ destino_url: destino }).eq('id', pedido.id);
    if (pedido.objetivo === 'resenas' && !comercio.link_resenas) await db().from('fab_comercios').update({ link_resenas: destino }).eq('id', comercio.id);
  }

  const url = urlQr(qr.codigo);
  return {
    salida: { n: qr.n, codigo: qr.codigo, lote: qr.lote, url_qr: url, destino, simulado: pedido.simulado },
    resumen: pedido.simulado
      ? `Prueba: se usaría el QR n.º ${qr.n} (${qr.codigo}); no se activó nada.`
      : `QR n.º ${qr.n} del lote ${qr.lote} (${qr.codigo}) activado: ${url} → ${destino}`,
    siguientes: [{ tipo: 'imprenta', entrada: { version_id: e.version_id ?? null, n: qr.n, codigo: qr.codigo, lote: qr.lote, destino } }],
    pedidoEtapa: 'imprenta',
  };
};
