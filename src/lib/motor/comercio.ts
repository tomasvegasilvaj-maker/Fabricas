// La ficha del comercio (nombre, rubro, ciudad, logo) se corrige acá, no en el prompt: la plantilla dibuja
// esos datos encima de la imagen, así que cambiarlos no le pide nada a Gemini ni gasta una imagen nueva.
import { infoLogo, proximoNumeroVersion } from '../agentes/comun';
import { procesarLogo } from '../placa/logo';
import { componerPlaca } from '../placa/plantilla';
import { bajarArchivo, db, registrarArchivo, registrarEvento, revisar, subirArchivo } from '../supabase';
import type { Json } from '../tipos-db';
import { guardarLogoOriginal, type ArchivoSubido } from './pedidos';

export type CambiosComercio = { nombre?: string; rubro?: string; ciudad?: string | null; logo?: ArchivoSubido | null };

function limpio(t: string | null | undefined, max: number) {
  const v = t?.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : '';
}

/** Prepara el logo nuevo igual que la recepción (PNG recortado + vista + datos de color y proporción). */
async function prepararLogo(comercioId: string, pedidoId: string, logo: ArchivoSubido) {
  await guardarLogoOriginal(comercioId, logo, pedidoId);
  const { png, vista, info } = await procesarLogo(logo.datos, logo.mime === 'image/jpg' ? 'image/jpeg' : logo.mime);
  const path = `comercios/${comercioId}/logo-${Date.now()}.png`;
  const vistaPath = `comercios/${comercioId}/logo-vista-${Date.now()}.png`;
  await Promise.all([subirArchivo(path, png, 'image/png'), subirArchivo(vistaPath, vista, 'image/png')]);
  await registrarArchivo({ comercioId, pedidoId, tipo: 'logo', nombre: 'Logo preparado', path, mime: 'image/png', bytes: png.length, meta: info as unknown as Json });
  revisar(await db().from('fab_comercios').update({ logo_info: { ...info, path, vista_path: vistaPath } as unknown as Json }).eq('id', comercioId).select('id'), 'guardar logo preparado');
}

/**
 * Guarda los datos del comercio y, si hay una placa esperando tu aprobación, la vuelve a armar con la misma
 * imagen y los datos nuevos (versión nueva, sin Gemini). Devuelve el n.º de esa versión, si la hubo.
 */
export async function corregirFichaComercio(pedidoId: string, c: CambiosComercio): Promise<{ version: number | null; cambios: string[] }> {
  const pedido = revisar(await db().from('fab_pedidos').select('id, comercio_id, linea').eq('id', pedidoId).single(), 'leer pedido');
  const actual = revisar(await db().from('fab_comercios').select('*').eq('id', pedido.comercio_id).single(), 'leer comercio');
  const campos: { nombre?: string; rubro?: string; ciudad?: string | null } = {};
  const cambios: string[] = [];
  const nombre = limpio(c.nombre, 120);
  const rubro = limpio(c.rubro, 120);
  const ciudad = limpio(c.ciudad, 120);
  if (nombre && nombre !== actual.nombre) (campos.nombre = nombre), cambios.push(`nombre «${nombre}»`);
  if (rubro && rubro !== actual.rubro) (campos.rubro = rubro), cambios.push(`rubro «${rubro}»`);
  if (c.ciudad !== undefined && (ciudad || null) !== actual.ciudad) (campos.ciudad = ciudad || null), cambios.push(`ciudad «${ciudad || 'La Calera'}»`);
  if (Object.keys(campos).length) revisar(await db().from('fab_comercios').update(campos).eq('id', actual.id).select('id'), 'guardar ficha del comercio');
  if (c.logo) {
    await prepararLogo(actual.id, pedidoId, c.logo);
    cambios.push('logo nuevo');
  }
  if (cambios.length === 0) return { version: null, cambios };
  await registrarEvento(pedidoId, `Corregiste la ficha del comercio: ${cambios.join(', ')}. No se le pidió nada a Gemini.`);

  // Si la placa está esperando tu aprobación, se rearma con la misma imagen y los datos nuevos.
  if (pedido.linea !== 'equipo') return { version: null, cambios };
  const { data: previa } = await db().from('fab_previas').select('*').eq('pedido_id', pedidoId).eq('tipo', 'aprobar_final').eq('estado', 'pendiente').maybeSingle();
  const versionId = (previa?.datos as { version_id?: string } | null)?.version_id;
  if (!previa || !versionId) return { version: null, cambios };
  const v = revisar(await db().from('fab_versiones').select('*').eq('id', versionId).single(), 'leer versión');
  const chequeo = (v.chequeo ?? {}) as { imagen_path?: string; colores?: { oscuro?: string } };
  if (!chequeo.imagen_path) return { version: null, cambios };
  const comercio = revisar(await db().from('fab_comercios').select('*').eq('id', actual.id).single(), 'leer comercio');
  const logoInfo = infoLogo(comercio);
  if (!logoInfo) return { version: null, cambios };
  const [imagen, logoPng] = await Promise.all([bajarArchivo(chequeo.imagen_path), bajarArchivo(logoInfo.path)]);
  const vista = await componerPlaca(imagen, { rubro: comercio.rubro, ciudad: comercio.ciudad, logo: { png: logoPng, info: logoInfo }, colores: chequeo.colores, modo: 'vista' }, 900);
  const numero = await proximoNumeroVersion(pedidoId);
  const vistaPath = `pedidos/${pedidoId}/diseno/v${numero}-vista.png`;
  await subirArchivo(vistaPath, vista.png, 'image/png');
  await registrarArchivo({ pedidoId, comercioId: comercio.id, tipo: 'vista', nombre: `Placa con plantilla (versión ${numero}, datos del comercio)`, path: vistaPath, mime: 'image/png', bytes: vista.png.length });
  const nueva = revisar(
    await db()
      .from('fab_versiones')
      .insert({
        pedido_id: pedidoId,
        concepto_id: v.concepto_id,
        numero,
        origen: 'diseno',
        svg: '',
        preview_path: vistaPath,
        notas: `Misma imagen que la versión ${v.numero}, con la ficha del comercio corregida (${cambios.join(', ')}).`,
        chequeo: { ...(v.chequeo as Record<string, unknown>), datos_comercio_de_version: v.numero } as Json,
      })
      .select('id')
      .single(),
    'guardar versión',
  );
  await db()
    .from('fab_previas')
    .update({ datos: { ...(previa.datos as Record<string, unknown>), version_id: nueva.id } as Json })
    .eq('id', previa.id);
  return { version: numero, cambios };
}
