import { NextResponse } from 'next/server';
import { haySesion } from '@/lib/auth';
import { bajarArchivo } from '@/lib/supabase';

const TIPOS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
};

/** Sirve los archivos privados del almacenamiento (vistas previas, PDFs) solo con sesión. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await haySesion())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const partes = (await params).path;
  if (!partes.length || partes.some((p) => !p || p === '.' || p === '..' || p.includes('\\')) || !['pedidos', 'comercios'].includes(partes[0])) {
    return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
  }
  const path = partes.join('/');
  let datos: Buffer;
  try {
    datos = await bajarArchivo(path);
  } catch {
    return NextResponse.json({ error: 'No existe' }, { status: 404 });
  }
  const nombre = partes.at(-1)!;
  const extension = nombre.split('.').pop()?.toLowerCase() ?? '';
  const descargar = new URL(req.url).searchParams.get('descargar') === '1';
  const cabeceras: Record<string, string> = {
    'Content-Type': TIPOS[extension] ?? 'application/octet-stream',
    'Content-Length': String(datos.length),
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    // Un SVG abierto directo no puede correr nada.
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
  };
  if (descargar) cabeceras['Content-Disposition'] = `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"`;
  return new NextResponse(new Uint8Array(datos), { headers: cabeceras });
}
