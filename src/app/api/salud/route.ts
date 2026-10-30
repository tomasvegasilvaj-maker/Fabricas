import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { faltaBase } from '@/lib/configuracion';
import { configuracionFaltante } from '@/lib/env';
import { archivosDeFuentes } from '@/lib/placa/fuentes';
import { renderizar } from '@/lib/placa/render';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SVG_PRUEBA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 106 156" width="106mm" height="156mm">
  <rect width="106" height="156" fill="#f4efe6"/>
  <text x="53" y="60" font-family="Montserrat" font-weight="700" font-size="9" text-anchor="middle">Prueba</text>
  <circle cx="53" cy="105" r="14" fill="#c2185b"/>
</svg>`;

/** Chequeo rápido después de cada despliegue: dibujo de placas, fuentes, base y variables (sin mostrar valores). */
export async function GET() {
  const t0 = Date.now();
  let render: { ok: boolean; ms?: number; error?: string };
  try {
    const { png } = await renderizar(SVG_PRUEBA, 300);
    const meta = await sharp(png).metadata();
    render = { ok: meta.format === 'png' && (meta.width ?? 0) === 300, ms: Date.now() - t0 };
  } catch (e) {
    render = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let base: 'ok' | 'sin configurar' | 'error' = 'sin configurar';
  if (!faltaBase()) {
    const { error } = await db().from('fab_qr_lote').select('codigo', { count: 'exact', head: true });
    base = error ? 'error' : 'ok';
  }

  const fuentes = archivosDeFuentes().length;
  const faltan = configuracionFaltante();
  return NextResponse.json(
    { ok: render.ok && fuentes > 0 && base === 'ok' && faltan.length === 0, faltan, base, fuentes, render, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
