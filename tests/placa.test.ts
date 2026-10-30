import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { armarSvgFinal, extraerSvg, limpiarYValidar } from '@/lib/placa/svg';
import { anchoParaDpi, renderizar, renderizarVista, revisarSangrado } from '@/lib/placa/render';
import { dataUri, procesarLogo } from '@/lib/placa/logo';
import { pdfA4, pdfPlaca, textoWinAnsi } from '@/lib/placa/pdf';
import { familiaDisponible } from '@/lib/placa/fuentes';

const SALIDA = path.join(__dirname, 'salida');
mkdirSync(SALIDA, { recursive: true });
const cafe = readFileSync(path.join(__dirname, 'fixtures/placa-cafe.svg'), 'utf8');
const qrMuestra = dataUri(readFileSync(path.join(__dirname, '../assets/qr-muestra.png')));

function reemplazar(svg: string, de: string, a: string) {
  if (!svg.includes(de)) throw new Error(`No está: ${de}`);
  return svg.replace(de, a);
}

describe('fuentes', () => {
  it('lleva cualquier font-family a una disponible', () => {
    expect(familiaDisponible("'Playfair Display', serif")).toBe('Playfair Display');
    expect(familiaDisponible('Helvetica Neue, Arial, sans-serif')).toBe('Inter');
    expect(familiaDisponible('serif')).toBe('DM Serif Display');
    expect(familiaDisponible('Comic Sans MS')).toBe('Montserrat');
  });
});

describe('limpiarYValidar', () => {
  it('acepta una placa bien armada', () => {
    const { chequeo, svg } = limpiarYValidar(cafe);
    expect(chequeo.errores).toEqual([]);
    expect(chequeo.slots.qr).toEqual({ x: 74, y: 124, ancho: 20, alto: 20 });
    expect(chequeo.slots.nfc).toEqual({ cx: 50, cy: 80, r: 14 });
    expect(chequeo.fuentes.sort()).toEqual(['DM Serif Display', 'Montserrat']);
    // el degradé interno sobrevive a la limpieza
    expect(svg).toContain('fill="url(#cafe)"');
  });

  it('extrae el SVG de una respuesta con texto alrededor', () => {
    expect(extraerSvg('Acá va:\n```svg\n<svg a="1"></svg>\n```')).toBe('<svg a="1"></svg>');
    expect(extraerSvg('sin dibujo')).toBeNull();
  });

  it('saca lo peligroso y lo externo', () => {
    let sucio = reemplazar(cafe, '<defs>', '<defs><script>alert(1)</script>');
    sucio = reemplazar(sucio, '<rect x="-3" y="-3"', '<image href="https://x.com/a.png" width="5" height="5"/><rect onclick="x()" x="-3" y="-3"');
    sucio = reemplazar(sucio, 'fill="#E2D3BF"/>', 'fill="url(https://malo.com/x.svg#a)"/>');
    const { svg, chequeo } = limpiarYValidar(sucio);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('onclick');
    expect(svg).not.toContain('malo.com');
    expect(chequeo.avisos.join(' ')).toContain('script');
    expect(chequeo.errores).toEqual([]);
  });

  it('marca errores de formato y de slots', () => {
    const sinNfc = reemplazar(cafe, '<circle id="nfc-zone" cx="50" cy="80" r="14" fill="none"/>', '');
    expect(limpiarYValidar(sinNfc).chequeo.errores.join(' ')).toContain('nfc-zone');

    const viewBoxMal = reemplazar(cafe, 'viewBox="-3 -3 106 156"', 'viewBox="0 0 1000 1500"');
    expect(limpiarYValidar(viewBoxMal).chequeo.errores.join(' ')).toContain('viewBox');

    const radioMal = reemplazar(cafe, 'r="14" fill="none"', 'r="22" fill="none"');
    expect(limpiarYValidar(radioMal).chequeo.errores.join(' ')).toContain('radio');

    const qrPisaNfc = reemplazar(cafe, 'id="qr-slot" x="74" y="124"', 'id="qr-slot" x="55" y="80"');
    expect(limpiarYValidar(qrPisaNfc).chequeo.errores.join(' ')).toContain('QR toca');

    const conTransform = reemplazar(cafe, '<rect id="qr-slot"', '<rect transform="rotate(5)" id="qr-slot"');
    expect(limpiarYValidar(conTransform).chequeo.errores.join(' ')).toContain('transform');

    expect(limpiarYValidar('<svg><g>').chequeo.errores.length).toBeGreaterThan(0);
  });

  it('ajusta solo el tamaño del QR y avisa', () => {
    const qrGrande = reemplazar(cafe, 'id="qr-slot" x="74" y="124" width="20" height="20"', 'id="qr-slot" x="73" y="123" width="22" height="22"');
    const { chequeo } = limpiarYValidar(qrGrande);
    expect(chequeo.slots.qr).toEqual({ x: 74, y: 124, ancho: 20, alto: 20 });
    expect(chequeo.avisos.join(' ')).toContain('se ajustó');
  });

  it('avisa textos chicos o fuera de la zona segura', () => {
    const chico = reemplazar(cafe, 'font-size="3.2" fill="#F4EBDD">Escaneá', 'font-size="1.5" fill="#F4EBDD">Escaneá');
    expect(limpiarYValidar(chico).chequeo.avisos.join(' ')).toContain('más chicos');
    const afuera = reemplazar(cafe, 'x="8" y="131"', 'x="1" y="131"');
    expect(limpiarYValidar(afuera).chequeo.avisos.join(' ')).toContain('zona segura');
  });
});

describe('render', () => {
  it('dibuja la placa con logo y QR de muestra, y revisa el sangrado', async () => {
    const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="200" y="130" font-size="110" text-anchor="middle" font-family="Montserrat" font-weight="800" fill="#7A4A2A">CAFÉ</text></svg>') }])
      .png()
      .toBuffer();
    const { svg: limpio } = limpiarYValidar(cafe);
    const final = armarSvgFinal(limpio, { logoDataUri: dataUri(logo), modoQr: 'muestra', qrMuestraDataUri: qrMuestra });
    expect(final).toContain('<image');
    expect(final).not.toContain('id="logo-slot" x="30" y="8" width="40" height="20" fill="none"');

    const vista = await renderizarVista(final, 600);
    expect(vista.ancho).toBe(600);
    expect(vista.alto).toBe(Math.round((600 * 156) / 106));
    writeFileSync(path.join(SALIDA, 'placa-cafe-vista.png'), vista.png);

    // El cuadrado del QR queda blanco y el sticker de muestra adentro.
    const { data, info } = await sharp(vista.png).raw().toBuffer({ resolveWithObject: true });
    const pxPorMm = info.width / 106;
    const punto = (xMm: number, yMm: number) => {
      const i = (Math.round((yMm + 3) * pxPorMm) * info.width + Math.round((xMm + 3) * pxPorMm)) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(punto(74.8, 124.8)).toEqual([255, 255, 255]);

    expect(await revisarSangrado(final)).toBeNull();
    const sinFondo = final.replace('<rect x="-3" y="-3" width="106" height="156" fill="#F4EBDD"/>', '<rect x="0" y="0" width="100" height="150" fill="#F4EBDD"/>');
    expect(await revisarSangrado(sinFondo)).toContain('sangrado');

    const imprenta = armarSvgFinal(limpio, { logoDataUri: dataUri(logo), modoQr: 'imprenta' });
    const alta = await renderizar(imprenta, anchoParaDpi(300));
    expect(alta.ancho).toBe(1252);
    writeFileSync(path.join(SALIDA, 'placa-cafe-300dpi.png'), alta.png);

    const pdf = await pdfPlaca(alta.png, 'Placa de prueba');
    const leido = await PDFDocument.load(pdf);
    const pagina = leido.getPage(0);
    expect(Math.round((pagina.getWidth() * 25.4) / 72)).toBe(106);
    expect(Math.round((pagina.getTrimBox().width * 25.4) / 72)).toBe(100);
    writeFileSync(path.join(SALIDA, 'placa-cafe.pdf'), pdf);

    const a4 = await pdfA4(alta.png, {
      titulo: 'Placa #12 · Café de Prueba',
      subtitulo: 'Reseñas en Google · versión 2',
      datos: [
        { etiqueta: 'QR', valor: 'n.º 3 del lote A4-1 (código NVGWX6XU)' },
        { etiqueta: 'NFC', valor: 'grabá https://qr-pasoapaso.vercel.app/q/NVGWX6XU' },
      ],
      pasos: ['Imprimí al 100 % (sin “ajustar a la página”) → en papel de 250 g o más.', 'Cortá por las marcas.', '¿Listo? Probalo con dos celulares.'],
    });
    expect((await PDFDocument.load(a4)).getPageCount()).toBe(1);
    writeFileSync(path.join(SALIDA, 'placa-cafe-A4.pdf'), a4);
  });
});

describe('logo', () => {
  it('detecta fondo blanco parejo, recorta y saca colores', async () => {
    const jpg = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#FFFFFF' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect x="250" y="300" width="300" height="200" fill="#C2185B"/><rect x="250" y="500" width="300" height="40" fill="#1A1A1A"/></svg>') }])
      .jpeg()
      .toBuffer();
    const { info, png, vista } = await procesarLogo(jpg, 'image/jpeg');
    expect(info.transparente).toBe(false);
    expect(info.fondo).toBe('#FFFFFF');
    expect(info.ancho).toBeLessThan(400);
    expect(info.proporcion).toBeGreaterThan(1);
    expect(info.colores[0]).toMatch(/^#C[0-9A-F]1[0-9A-F]5[0-9A-F]$/);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect((await sharp(vista).metadata()).width).toBeLessThanOrEqual(768);
  });

  it('reconoce un PNG transparente y un SVG', async () => {
    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><circle cx="250" cy="250" r="100" fill="#D4AF37"/></svg>') }])
      .png()
      .toBuffer();
    const t = await procesarLogo(png, 'image/png');
    expect(t.info.transparente).toBe(true);
    expect(t.info.fondo).toBeNull();
    expect(t.info.proporcion).toBeCloseTo(1, 1);

    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#000"/><text x="100" y="65" font-size="40" text-anchor="middle" fill="#FFD700">LOGO</text></svg>');
    const s = await procesarLogo(svg, 'application/octet-stream');
    expect(s.info.formatoOriginal).toBe('image/svg+xml');
    expect(s.info.fondo).toBe('#000000');
  });
});

describe('pdf', () => {
  it('limpia caracteres que Helvetica no tiene', () => {
    expect(textoWinAnsi('Imprimí → ¿listo? “sí” ✓ 🎉')).toBe('Imprimí -> ¿listo? "sí" OK ');
  });
});
