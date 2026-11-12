import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { imagenParaClaude } from '@/lib/agentes/equipo/estructura';
import { gastaIA } from '@/lib/motor/tipos';

describe('tope de gasto: qué pasos gastan IA', () => {
  it('frena los agentes con IA', () => {
    for (const t of ['ideas', 'diseno', 'estructura', 'investigacion', 'boceto'] as const) expect(gastaIA(t, {})).toBe(true);
  });
  it('no frena los pasos sin IA', () => {
    for (const t of ['intake', 'activacion', 'imprenta', 'produccion'] as const) expect(gastaIA(t, {})).toBe(false);
  });
  it('Pedrito solo gasta cuando mira ideas o la imagen', () => {
    expect(gastaIA('pedrito', { revisar: 'ideas' })).toBe(true);
    expect(gastaIA('pedrito', { revisar: 'diseno' })).toBe(true);
    expect(gastaIA('pedrito', { revisar: 'inicio' })).toBe(false);
    expect(gastaIA('pedrito', { revisar: 'estructura' })).toBe(false);
    expect(gastaIA('pedrito', { revisar: 'produccion' })).toBe(false);
    expect(gastaIA('pedrito', null)).toBe(false);
  });
});

describe('imagen de Diseño para Claude', () => {
  it('una imagen 2K pesada queda chica y en JPG', async () => {
    // Ruido: el peor caso para el PNG (pesa varios MB, como una ilustración 2K).
    const ancho = 1696;
    const alto = 2528;
    const crudo = randomBytes(ancho * alto * 3);
    const png = await sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } }).png().toBuffer();
    expect(png.length).toBeGreaterThan(5 * 1024 * 1024);
    const salida = await imagenParaClaude(png);
    const meta = await sharp(salida).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1500);
    expect(salida.length).toBeLessThan(3.5 * 1024 * 1024);
  });
});
