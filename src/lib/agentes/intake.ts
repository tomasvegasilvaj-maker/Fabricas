import sharp from 'sharp';
import { procesarLogo } from '../placa/logo';
import { bajarArchivo, db, registrarArchivo, revisar, subirArchivo } from '../supabase';
import type { Json } from '../tipos-db';
import type { Agente, ResultadoPaso } from '../motor/tipos';

const DIAS_INVESTIGACION_VIGENTE = 60;

const MIME_POR_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  avif: 'image/avif',
};

function faltaLogo(detalle: string): ResultadoPaso {
  return {
    salida: { falta: 'logo', detalle },
    resumen: detalle,
    previa: { tipo: 'falta_dato', titulo: 'Falta el logo', detalle, datos: { campo: 'logo' } },
    pedidoEstado: 'en_espera',
    pedidoEtapa: 'intake',
  };
}

/** Logo de mentira para los pedidos de prueba que llegan sin logo. */
async function logoDePrueba(nombre: string) {
  const texto = nombre.replace(/[<&>"]/g, '').slice(0, 18).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><text x="400" y="190" font-family="Montserrat" font-weight="800" font-size="96" text-anchor="middle" fill="#2B2B2B">${texto}</text></svg>`;
  return sharp({ create: { width: 800, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

/** Recepción: prepara el logo original (sin redibujarlo) y decide si hace falta investigar. */
export const intake: Agente = async ({ comercio, pedido }) => {
  let original: Buffer;
  let mime: string;
  if (!comercio.logo_path) {
    if (!pedido.simulado) return faltaLogo(`Para empezar la placa de ${comercio.nombre} hace falta su logo (PNG, JPG, SVG o WebP).`);
    original = await logoDePrueba(comercio.nombre);
    mime = 'image/png';
  } else {
    original = await bajarArchivo(comercio.logo_path);
    mime = MIME_POR_EXTENSION[comercio.logo_path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
  }

  let procesado;
  try {
    procesado = await procesarLogo(original, mime);
  } catch (e) {
    return faltaLogo(`No se pudo leer el logo (${e instanceof Error ? e.message : String(e)}). Subí otro archivo.`);
  }
  const { png, vista, info } = procesado;
  const base = `comercios/${comercio.id}`;
  const path = `${base}/logo.png`;
  const vistaPath = `${base}/logo-vista.png`;
  await Promise.all([subirArchivo(path, png, 'image/png'), subirArchivo(vistaPath, vista, 'image/png')]);
  await registrarArchivo({ comercioId: comercio.id, pedidoId: pedido.id, tipo: 'logo', nombre: 'Logo preparado', path, mime: 'image/png', bytes: png.length, meta: info as unknown as Json });
  revisar(
    await db()
      .from('fab_comercios')
      .update({ logo_info: { ...info, path, vista_path: vistaPath } as unknown as Json })
      .eq('id', comercio.id)
      .select('id'),
    'guardar logo preparado',
  );

  const fondo = info.transparente ? 'fondo transparente' : info.fondo ? `fondo ${info.fondo}` : 'fondo irregular';
  const fecha = (comercio.investigacion as { fecha?: string } | null)?.fecha;
  const vigente = fecha && Date.now() - new Date(fecha).getTime() < DIAS_INVESTIGACION_VIGENTE * 86_400_000;
  return {
    salida: { logo: info as unknown as Json, investigacion_vigente: !!vigente },
    resumen: `Logo listo: ${info.ancho}×${info.alto} px, ${fondo}, colores ${info.colores.join(' ') || '—'}.${vigente ? ' La investigación del comercio está al día: se pasa directo a la inspiración.' : ''}`,
    siguientes: [{ tipo: vigente ? 'inspiracion' : 'investigacion' }],
    pedidoEtapa: vigente ? 'inspiracion' : 'investigacion',
  };
};
