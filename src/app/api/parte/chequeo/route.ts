import { NextResponse } from 'next/server';
import { faltaBase } from '@/lib/configuracion';
import { motorAutorizado } from '@/lib/motor/secreto';
import { revisarYMandarParte } from '@/lib/parte/parte';
import { bearerValido } from '@/lib/sesion';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Chequeo de respaldo: lo llaman el Vercel Cron (con CRON_SECRET) y el reloj de Supabase cada 30 min
 * (con la clave del latido). Manda el parte a Pedrito solo si cambió algo o apareció un error.
 */
async function chequear(req: Request) {
  const cabecera = req.headers.get('authorization');
  const autorizado = bearerValido(cabecera, process.env.CRON_SECRET?.trim() || null) || (!faltaBase() && (await motorAutorizado(cabecera)));
  if (!autorizado) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (faltaBase()) return NextResponse.json({ error: 'Falta configurar Supabase' }, { status: 503 });
  try {
    const r = await revisarYMandarParte({ origen: 'chequeo' });
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Chequeo del parte:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ enviado: false, razon: 'error', detalle: 'El chequeo falló; mirá los logs de Vercel.' }, { status: 500 });
  }
}

export const GET = chequear;
export const POST = chequear;
