import { env } from '../env';
import { MIMES_LOGO } from '../placa/logo';
import { db, registrarArchivo, registrarEvento, revisar, subirArchivo } from '../supabase';
import type { ComercioRow, PedidoRow } from '../tipos-db';
import { OBJETIVOS } from './flujo';

// Vercel corta los pedidos de más de 4,5 MB: el logo va hasta 4 MB.
export const MAX_BYTES_LOGO = 4 * 1024 * 1024;

const EXTENSIONES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export type DatosComercio = {
  nombre: string;
  rubro: string;
  ciudad?: string | null;
  direccion?: string | null;
  instagram?: string | null;
  google_maps_url?: string | null;
  whatsapp?: string | null;
  web?: string | null;
  link_resenas?: string | null;
};

export type ArchivoSubido = { datos: Buffer; mime: string; nombre?: string };

export type NuevoPedido = {
  comercioId?: string | null;
  comercio: DatosComercio;
  logo?: ArchivoSubido | null;
  objetivo: string;
  destinoUrl?: string | null;
  ideas?: string | null;
  simulado?: boolean;
  autoAprobar?: boolean;
};

function limpio(v: string | null | undefined, max = 300) {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
}

/** Guarda el logo tal cual lo subiste; la recepción después lo prepara para la placa. */
export async function guardarLogoOriginal(comercioId: string, logo: ArchivoSubido, pedidoId?: string | null) {
  const mime = logo.mime === 'image/jpg' ? 'image/jpeg' : logo.mime;
  if (!MIMES_LOGO.includes(mime)) throw new Error('El logo tiene que ser PNG, JPG, WebP, SVG, GIF o AVIF.');
  if (logo.datos.length === 0) throw new Error('El archivo del logo está vacío.');
  if (logo.datos.length > MAX_BYTES_LOGO) throw new Error('El logo pesa más de 4 MB: achicalo o pasalo a PNG/SVG.');
  const path = `comercios/${comercioId}/logo-original-${Date.now()}.${EXTENSIONES[mime]}`;
  await subirArchivo(path, logo.datos, mime);
  await registrarArchivo({ comercioId, pedidoId, tipo: 'logo_original', nombre: logo.nombre, path, mime, bytes: logo.datos.length });
  revisar(await db().from('fab_comercios').update({ logo_path: path }).eq('id', comercioId).select('id'), 'guardar logo');
  return path;
}

export async function crearPedido(n: NuevoPedido): Promise<PedidoRow> {
  const nombre = limpio(n.comercio.nombre, 120);
  const rubro = limpio(n.comercio.rubro, 120);
  if (!nombre || !rubro) throw new Error('Faltan el nombre y el rubro del comercio.');
  if (!OBJETIVOS[n.objetivo]) throw new Error('Objetivo de placa desconocido.');
  const destino = limpio(n.destinoUrl, 2000);
  if (destino && !/^https?:\/\/\S+$/i.test(destino)) throw new Error('El link de destino tiene que empezar con https://');

  const campos = {
    nombre,
    rubro,
    ciudad: limpio(n.comercio.ciudad, 120),
    direccion: limpio(n.comercio.direccion),
    instagram: limpio(n.comercio.instagram),
    google_maps_url: limpio(n.comercio.google_maps_url, 1000),
    whatsapp: limpio(n.comercio.whatsapp, 60),
    web: limpio(n.comercio.web, 1000),
    link_resenas: limpio(n.comercio.link_resenas, 1000),
  };

  let comercio: ComercioRow;
  if (n.comercioId) {
    // Comercio que ya existe: solo se pisan los datos que vinieron completos.
    const cambios = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null)) as Partial<typeof campos>;
    comercio = revisar(await db().from('fab_comercios').update(cambios).eq('id', n.comercioId).select('*').single(), 'actualizar comercio');
  } else {
    comercio = revisar(await db().from('fab_comercios').insert(campos).select('*').single(), 'crear comercio');
  }

  if (n.logo) await guardarLogoOriginal(comercio.id, n.logo);

  const pedido = revisar(
    await db()
      .from('fab_pedidos')
      .insert({
        comercio_id: comercio.id,
        objetivo: n.objetivo,
        destino_url: destino,
        ideas: limpio(n.ideas, 3000),
        simulado: !!n.simulado,
        auto_aprobar: !!n.simulado && !!n.autoAprobar,
        tope_usd: env.topeUsd,
        estado: 'en_marcha',
        etapa: 'intake',
      })
      .select('*')
      .single(),
    'crear pedido',
  );
  revisar(await db().from('fab_pasos').insert({ pedido_id: pedido.id, tipo: 'intake' }).select('id'), 'encolar recepción');
  await registrarEvento(pedido.id, `Pedido #${pedido.numero} creado para ${comercio.nombre}${pedido.simulado ? ' (prueba simulada, sin IA)' : ''}.`);
  return pedido;
}
