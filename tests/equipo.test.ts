// Pruebas del equipo de Pedrito: plantilla obligatoria, PDF A4 con dos placas, Gemini, verificación del QR,
// prueba del link y reglas de una línea. No tocan la base ni las APIs.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ErrorPaso } from '@/lib/ia/claude';
import { costoImagenUsd, leerRespuestaGateway, leerRespuestaGemini, modeloImagen, modeloParaGateway, proveedorImagen } from '@/lib/ia/gemini';
import { renderizar } from '@/lib/placa/render';
import { procesarLogo } from '@/lib/placa/logo';
import { pdfA4DosPlacas, posicionesDosPlacas } from '@/lib/placa/pdf';
import { cajaLogo, chequearPlantilla, componerPlaca, PLANTILLA, sinSangrado, svgPlantilla, tamanoPie, textoPie } from '@/lib/placa/plantilla';
import { aplicaAlRubro, completarPrompt, leerCorreccion, reglaDeUnaLinea } from '@/lib/agentes/equipo/comun';
import { armarPromptDiseno, INSTRUCCIONES_PLANTILLA } from '@/lib/agentes/equipo/diseno';
import { evaluarQr, mismoLink, probarEnlace } from '@/lib/agentes/equipo/produccion';
import { imagenDePrueba } from '@/lib/agentes/equipo/simulados';
import type { IdeaEquipo } from '@/lib/agentes/equipo/ideas';
import { etapasDe, indiceEtapa, nombreEtapa } from '@/lib/motor/flujo';

const SALIDA = path.join(__dirname, 'salida');
mkdirSync(SALIDA, { recursive: true });

const IDEA: IdeaEquipo = {
  titulo: 'Pizza vista desde arriba',
  idea: 'El NFC es una pizza.',
  objeto_nfc: 'a glossy pepperoni pizza seen from above',
  escena: 'Warm wooden table with a few basil leaves.',
  estilo: 'soft 3D clay render',
  paleta: [
    { hex: '#F4EBDD', uso: 'fondo' },
    { hex: '#D9572B', uso: 'pizza' },
    { hex: '#3B2314', uso: 'pie' },
  ],
  color_oscuro: '#3B2314',
  por_que: 'Es lo que más venden.',
};

async function logoDePrueba() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300" viewBox="0 0 800 300"><text x="400" y="190" font-family="Montserrat" font-weight="800" font-size="110" text-anchor="middle" fill="#B3261E">PIZZERÍA</text></svg>`;
  const png = (await renderizar(svg, 800)).png;
  return procesarLogo(png, 'image/png');
}

describe('plantilla obligatoria', () => {
  it('pone logo arriba al medio, NFC al centro, QR abajo y pie con rubro y La Calera', async () => {
    const logo = await logoDePrueba();
    const chequeo = chequearPlantilla('Pizzería', logo.info);
    expect(chequeo.fallas).toEqual([]);
    expect(chequeo.textos.qr).toBe('¿Sin NFC? Escaneá el código QR');
    expect(chequeo.textos.pie).toBe('PIZZERÍA · LA CALERA');
    expect(PLANTILLA.nfc.cx).toBe(50);
    expect(PLANTILLA.nfc.cy).toBe(75);
    const caja = cajaLogo(logo.info.proporcion);
    expect(caja.x + caja.w / 2).toBeCloseTo(50, 1);
    expect(caja.w / caja.h).toBeCloseTo(logo.info.proporcion, 1);

    const svg = svgPlantilla({ rubro: 'Pizzería', logo: { png: logo.png, info: logo.info }, modo: 'imprenta', qrNumero: 12 });
    expect(svg).toContain('¿Sin NFC?');
    expect(svg).toContain('Escaneá el código QR');
    expect(svg).toContain('PIZZERÍA · LA CALERA');
    expect(svg).toContain('QR n.º 12');
    expect(svg).toContain('ACERCÁ TU CELULAR ACÁ');
  });

  it('achica el pie cuando el rubro es largo', () => {
    expect(tamanoPie(textoPie('Café'))).toBe(3.2);
    const largo = textoPie('Estética, depilación definitiva y uñas esculpidas');
    expect(tamanoPie(largo) * (largo.length * 0.74 + 0.5)).toBeLessThanOrEqual(100 - 8 - 4 + 0.01);
  });

  it('compone la placa sobre la imagen de Diseño y recorta el sangrado a 10 × 15', async () => {
    const logo = await logoDePrueba();
    const fondo = await imagenDePrueba(IDEA, 1);
    const placa = await componerPlaca(fondo, { rubro: 'Pizzería', logo: { png: logo.png, info: logo.info }, colores: { oscuro: IDEA.color_oscuro }, modo: 'vista' }, 900);
    expect(placa.ancho).toBe(900);
    expect(placa.alto).toBe(Math.round((900 * 156) / 106));
    writeFileSync(path.join(SALIDA, 'equipo-vista.png'), placa.png);

    // El centro de la tarjeta del QR es blanco y el pie es del color oscuro de la idea.
    const pxMm = placa.ancho / 106;
    const punto = async (xMm: number, yMm: number) => {
      const { data } = await sharp(placa.png)
        .extract({ left: Math.round((xMm + 3) * pxMm), top: Math.round((yMm + 3) * pxMm), width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return [...data.subarray(0, 3)];
    };
    expect(await punto(PLANTILLA.tarjetaQr.x + 3, PLANTILLA.tarjetaQr.y + 3)).toEqual([255, 255, 255]);
    expect(await punto(3, 148)).toEqual([0x3b, 0x23, 0x14]);

    const recortada = await sinSangrado(placa.png, placa.ancho);
    const meta = await sharp(recortada).metadata();
    expect((meta.width ?? 0) / (meta.height ?? 1)).toBeCloseTo(100 / 150, 2);
  });
});

describe('PDF A4 con dos placas', () => {
  it('acomoda dos 10 × 15 lado a lado dentro de la A4', async () => {
    const pos = posicionesDosPlacas();
    expect(pos).toHaveLength(2);
    expect(pos[0].x).toBeGreaterThanOrEqual(3.9);
    expect(pos[1].x + pos[1].w).toBeLessThanOrEqual(210 - 3.9);
    expect(pos[1].x - (pos[0].x + pos[0].w)).toBeCloseTo(2, 5);

    // La placa armada de verdad (a 300 dpi, sin sangrado), como la prepara Producción.
    const logo = await logoDePrueba();
    const placa = await componerPlaca(await imagenDePrueba(IDEA, 2), { rubro: 'Pizzería', logo: { png: logo.png, info: logo.info }, colores: { oscuro: IDEA.color_oscuro }, modo: 'imprenta', qrNumero: 12 }, 1252);
    const jpg = await sharp(await sinSangrado(placa.png, placa.ancho)).jpeg({ quality: 90 }).toBuffer();
    const bytes = await pdfA4DosPlacas(jpg, {
      titulo: 'Placa #7 · Pizzería Don Tito',
      subtitulo: 'Reseñas · versión 2',
      datos: [{ etiqueta: 'QR', valor: 'n.º 12 del lote A4-1 (código ABC12345)' }],
      pasos: ['Imprimí al 100 %.', 'Cortá por las guías.'],
    });
    writeFileSync(path.join(SALIDA, 'equipo-a4-dos-placas.pdf'), bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo((210 * 72) / 25.4, 0);
    expect(height).toBeCloseTo((297 * 72) / 25.4, 0);
  });
});

describe('Gemini', () => {
  it('saca la imagen de la respuesta', () => {
    const png = Buffer.from('imagen');
    const r = leerRespuestaGemini(200, { candidates: [{ content: { parts: [{ text: 'listo' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }, 'gemini-3-pro-image-preview');
    expect(r.datos.equals(png)).toBe(true);
    expect(r.mime).toBe('image/png');
  });

  it('distingue errores que se reintentan de los que no', () => {
    const atrapar = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e as ErrorPaso;
      }
      throw new Error('no falló');
    };
    expect(atrapar(() => leerRespuestaGemini(429, {}, 'm')).reintentable).toBe(true);
    expect(atrapar(() => leerRespuestaGemini(403, { error: { message: 'API key not valid' } }, 'm')).reintentable).toBe(false);
    expect(atrapar(() => leerRespuestaGemini(404, {}, 'modelo-viejo')).message).toContain('GEMINI_IMAGE_MODEL');
    expect(atrapar(() => leerRespuestaGemini(200, { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }, 'm')).reintentable).toBe(false);
    expect(atrapar(() => leerRespuestaGemini(200, { promptFeedback: { blockReason: 'SAFETY' } }, 'm')).reintentable).toBe(false);
  });

  it('cobra más el modelo pro', () => {
    expect(costoImagenUsd('gemini-3-pro-image-preview')).toBeGreaterThan(costoImagenUsd('gemini-2.5-flash-image'));
  });
});

describe('Imágenes por Vercel AI Gateway', () => {
  const atrapar = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e as ErrorPaso;
    }
    throw new Error('no falló');
  };

  it('saca la imagen del data URI', () => {
    const png = Buffer.from('imagen');
    const r = leerRespuestaGateway(200, { choices: [{ message: { content: 'listo', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }] }, 'google/gemini-3-pro-image');
    expect(r.datos.equals(png)).toBe(true);
    expect(r.mime).toBe('image/png');
    expect(r.texto).toBe('listo');
  });

  it('avisa sin crédito, clave mala y modelo inexistente sin reintentar', () => {
    const sinCredito = atrapar(() => leerRespuestaGateway(402, { error: { message: 'Insufficient funds' } }, 'm'));
    expect(sinCredito.reintentable).toBe(false);
    expect(sinCredito.message).toContain('crédito');
    expect(atrapar(() => leerRespuestaGateway(401, { error: { message: 'Invalid API key' } }, 'm')).message).toContain('AI_GATEWAY_API_KEY');
    expect(atrapar(() => leerRespuestaGateway(404, {}, 'google/nada')).message).toContain('GEMINI_IMAGE_MODEL');
    expect(atrapar(() => leerRespuestaGateway(429, {}, 'm')).reintentable).toBe(true);
    expect(atrapar(() => leerRespuestaGateway(200, { choices: [{ message: { content: 'no puedo' }, finish_reason: 'content_filter' }] }, 'm')).reintentable).toBe(false);
  });

  it('elige el camino por la clave y traduce el nombre del modelo', () => {
    const antes = { ...process.env };
    try {
      delete process.env.AI_GATEWAY_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_IMAGE_MODEL;
      expect(proveedorImagen()).toBeNull();
      process.env.GEMINI_API_KEY = 'x';
      expect(proveedorImagen()).toBe('google');
      expect(modeloImagen()).toBe('gemini-3-pro-image-preview');
      process.env.AI_GATEWAY_API_KEY = 'y';
      expect(proveedorImagen()).toBe('gateway');
      expect(modeloImagen()).toBe('google/gemini-3-pro-image');
      process.env.GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
      expect(modeloImagen()).toBe('google/gemini-2.5-flash-image');
      expect(modeloParaGateway('google/gemini-3.1-flash-image')).toBe('google/gemini-3.1-flash-image');
    } finally {
      process.env = antes;
    }
  });
});

describe('prompt de Diseño', () => {
  it('completa el prompt del rubro y suma plantilla, corrección y reglas', () => {
    const prompt = armarPromptDiseno({
      plantilla: 'Sign for a {rubro}. Hero: {objeto_nfc}. {escena} Style: {estilo}. Palette: {paleta}. {desconocido}',
      rubro: 'pizzería',
      idea: IDEA,
      indicaciones: 'Keep the pizza big.',
      comentarioTomi: 'más queso',
      correccion: { texto: 'The pizza was off-center.', regla: 'Centrá siempre el objeto.' },
      reglas: ['Centrá siempre el objeto.'],
    });
    expect(prompt).toContain('Hero: a glossy pepperoni pizza seen from above.');
    expect(prompt).toContain('#D9572B (pizza)');
    expect(prompt).toContain('{desconocido}');
    expect(prompt).toContain(INSTRUCCIONES_PLANTILLA);
    expect(prompt).toContain('Change requested by the client (top priority): más queso');
    expect(prompt).toContain('Fix from the previous round: The pizza was off-center.');
    expect(prompt).toContain('- Centrá siempre el objeto.');
    expect(completarPrompt('{a}-{b}', { a: '1' })).toBe('1-{b}');
  });
});

describe('reglas de una línea', () => {
  it('deja una sola línea corta, sin viñetas', () => {
    expect(reglaDeUnaLinea('- Que el objeto\n llene   el círculo.')).toBe('Que el objeto llene el círculo.');
    expect(reglaDeUnaLinea('x'.repeat(400))).toHaveLength(240);
  });

  it('lee la corrección que manda Pedrito', () => {
    expect(leerCorreccion(null)).toBeNull();
    expect(leerCorreccion({ texto: 'Arreglá X', regla: 'Siempre Y\nY más', solo_rubro: true })).toEqual({ texto: 'Arreglá X', regla: 'Siempre Y Y más', solo_rubro: true });
  });

  it('aplica las reglas del rubro sin importar tildes ni mayúsculas', () => {
    expect(aplicaAlRubro(null, 'Barbería')).toBe(true);
    expect(aplicaAlRubro('barberia', 'Barbería y peluquería')).toBe(true);
    expect(aplicaAlRubro('Pizzería', 'Barbería')).toBe(false);
  });
});

describe('Producción', () => {
  const fila = { codigo: 'ABC12345', n: 12, estado: 'asignado', pedido_id: 'p1', url: 'https://g.page/r/xyz/review' };

  it('compara links sin importar la barra final ni mayúsculas del host', () => {
    expect(mismoLink('https://G.page/r/xyz/review/', 'https://g.page/r/xyz/review')).toBe(true);
    expect(mismoLink('https://g.page/r/xyz/review?a=1', 'https://g.page/r/xyz/review')).toBe(false);
  });

  it('verifica que el QR del lote sea el del pedido y apunte al destino', () => {
    const base = { codigo: 'ABC12345', pedidoId: 'p1', destino: 'https://g.page/r/xyz/review', simulado: false, delPedido: ['ABC12345'] };
    expect(evaluarQr({ ...base, fila }).ok).toBe(true);
    expect(evaluarQr({ ...base, fila: { ...fila, pedido_id: 'otro' } }).detalle).toContain('otro pedido');
    expect(evaluarQr({ ...base, fila: { ...fila, url: 'https://otro.com' } }).ok).toBe(false);
    expect(evaluarQr({ ...base, fila, delPedido: ['ABC12345', 'ZZZ'] }).detalle).toContain('ZZZ');
    expect(evaluarQr({ ...base, fila: null }).ok).toBe(false);
    expect(evaluarQr({ ...base, simulado: true, fila: { ...fila, estado: 'libre', pedido_id: null, url: null } }).ok).toBe(true);
  });

  const respuesta = (status: number, location?: string) => new Response(null, { status, headers: location ? { location } : {} });

  it('prueba que el QR redirija al destino y que el destino abra', async () => {
    const destino = 'https://g.page/r/xyz/review';
    const ok = await probarEnlace('https://qr-pasoapaso.vercel.app/q/ABC', destino, false, (async (url: string | URL | Request) =>
      String(url).includes('/q/') ? respuesta(302, destino) : respuesta(200)) as typeof fetch);
    expect(ok.ok).toBe(true);
    expect(ok.qr_status).toBe(302);

    const mal = await probarEnlace('https://qr-pasoapaso.vercel.app/q/ABC', destino, false, (async (url: string | URL | Request) =>
      String(url).includes('/q/') ? respuesta(302, '/activar?c=ABC') : respuesta(200)) as typeof fetch);
    expect(mal.ok).toBe(false);
    expect(mal.nota).toContain('no redirige');

    const robots = await probarEnlace('https://qr-pasoapaso.vercel.app/q/ABC', destino, false, (async (url: string | URL | Request) =>
      String(url).includes('/q/') ? respuesta(302, destino) : respuesta(429)) as typeof fetch);
    expect(robots.ok).toBe(true);
    expect(robots.nota).toContain('celular');

    const caido = await probarEnlace('https://qr-pasoapaso.vercel.app/q/ABC', destino, false, (async (url: string | URL | Request) =>
      String(url).includes('/q/') ? respuesta(302, destino) : respuesta(404)) as typeof fetch);
    expect(caido.ok).toBe(false);
  });
});

describe('etapas por línea', () => {
  it('usa las etapas del equipo para los pedidos del equipo', () => {
    expect(etapasDe('equipo').map((e) => e.id)).toEqual(['intake', 'ideas', 'diseno', 'estructura', 'aprobacion', 'produccion']);
    expect(indiceEtapa('estructura', 'equipo')).toBe(3);
    expect(indiceEtapa('revision')).toBe(7);
    expect(nombreEtapa('produccion')).toBe('Producción');
  });
});
