import sharp from 'sharp';
import { OBJETIVOS, urlQr } from '../motor/flujo';
import type { Agente } from '../motor/tipos';
import { PLACA } from '../placa/especificacion';
import { dataUri } from '../placa/logo';
import { pdfA4, pdfPlaca } from '../placa/pdf';
import { anchoParaDpi, renderizar } from '../placa/render';
import { armarSvgFinal, type ChequeoSvg } from '../placa/svg';
import { db, registrarArchivo, subirArchivo } from '../supabase';
import { entrada, leerVersion, logoDelComercio } from './comun';

function nombreArchivo(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
}

/** Imprenta: PDF con sangrado, hoja A4 con marcas de corte y guía, foto 10×15 y el SVG final. */
export const imprenta: Agente = async ({ comercio, pedido, paso }) => {
  const e = entrada<{ version_id: string; n: number; codigo: string; lote: string; destino: string }>(paso.entrada);
  if (!e.version_id || !e.codigo) throw new Error('A la imprenta le faltan la versión o el QR.');
  const version = await leerVersion(e.version_id);
  const { png: logo } = await logoDelComercio(comercio);
  const svg = armarSvgFinal(version.svg, { logoDataUri: dataUri(logo), modoQr: 'imprenta' });

  const alta = await renderizar(svg, anchoParaDpi(600));
  const media = await renderizar(svg, anchoParaDpi(300));
  // 10×15 sin sangrado para laboratorio de fotos: se recorta el sangrado a 300 dpi.
  const pxMm = media.ancho / (PLACA.ancho + 2 * PLACA.sangrado);
  const foto = await sharp(media.png)
    .extract({
      left: Math.round(PLACA.sangrado * pxMm),
      top: Math.round(PLACA.sangrado * pxMm),
      width: Math.round(PLACA.ancho * pxMm),
      height: Math.round(PLACA.alto * pxMm),
    })
    .flatten({ background: '#ffffff' })
    .withMetadata({ density: 300 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();

  const url = urlQr(e.codigo);
  const nfc = (version.chequeo as ChequeoSvg | null)?.slots?.nfc;
  const objetivo = OBJETIVOS[pedido.objetivo]?.nombre ?? pedido.objetivo;
  const titulo = `Placa #${pedido.numero} · ${comercio.nombre}`;
  const [pdf, a4] = await Promise.all([
    pdfPlaca(alta.png, titulo),
    pdfA4(media.png, {
      titulo,
      subtitulo: `${objetivo} · versión ${version.numero}${pedido.simulado ? ' · PRUEBA (no se activó ningún QR)' : ''}`,
      datos: [
        { etiqueta: 'QR', valor: `n.º ${e.n} del lote ${e.lote} (código ${e.codigo})` },
        { etiqueta: 'Link del QR y del NFC', valor: url },
        { etiqueta: 'Destino', valor: e.destino ?? '' },
      ],
      pasos: [
        'Imprimí al 100 % (sin «ajustar a la página») en cartulina de 250 g o más. Si va afuera o se toca mucho, plastificala.',
        'Cortá por las marcas.',
        `Pegá el QR n.º ${e.n} (código ${e.codigo}) derecho en el cuadrado blanco, dentro de las marquitas.`,
        `Grabá el tag NFC con NFC Tools: Escribir > Agregar un registro > URL > ${url}. Probalo y recién después bloquealo.`,
        nfc
          ? `Pegá el tag detrás de la placa, centrado detrás del círculo: a ${nfc.cx.toFixed(0)} mm del borde izquierdo y ${nfc.cy.toFixed(0)} mm del borde de arriba (medido sobre la placa ya cortada).`
          : 'Pegá el tag detrás de la placa, centrado detrás del círculo NFC.',
        `Probá con un Android y un iPhone: el QR y el NFC tienen que abrir ${e.destino}.`,
      ],
    }),
  ]);

  const base = `pedidos/${pedido.id}/final/placa-${pedido.numero}-${nombreArchivo(comercio.nombre)}`;
  const archivos = [
    { path: `${base}-imprenta.pdf`, datos: Buffer.from(pdf), mime: 'application/pdf', tipo: 'pdf_imprenta', nombre: 'PDF para imprenta (106 × 156 mm con sangrado)' },
    { path: `${base}-A4.pdf`, datos: Buffer.from(a4), mime: 'application/pdf', tipo: 'pdf_a4', nombre: 'Hoja A4 con marcas de corte y guía de armado' },
    { path: `${base}-10x15.jpg`, datos: foto, mime: 'image/jpeg', tipo: 'foto_10x15', nombre: 'Foto 10 × 15 (300 dpi, sin sangrado)' },
    { path: `${base}.svg`, datos: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml', tipo: 'svg_final', nombre: 'SVG final con logo' },
  ];
  for (const a of archivos) {
    await subirArchivo(a.path, a.datos, a.mime);
    await registrarArchivo({ pedidoId: pedido.id, comercioId: comercio.id, tipo: a.tipo, nombre: a.nombre, path: a.path, mime: a.mime, bytes: a.datos.length, meta: { version_id: version.id } });
  }
  await db().from('fab_pedidos').update({ version_final_id: version.id }).eq('id', pedido.id);

  return {
    salida: { archivos: archivos.map((a) => a.path), qr: { n: e.n, codigo: e.codigo, url }, destino: e.destino },
    resumen: `Archivos listos para imprimir: PDF de imprenta, hoja A4 con guía, foto 10×15 y SVG. QR n.º ${e.n}.`,
    pedidoEstado: 'listo',
    pedidoEtapa: 'listo',
  };
};
