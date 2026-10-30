import { after, NextResponse } from 'next/server';
import { faltaBase } from '@/lib/configuracion';
import { correrMotor } from '@/lib/motor/motor';
import { motorAutorizado } from '@/lib/motor/secreto';

export const maxDuration = 300;

/** Lo llaman el reloj de Supabase (cada minuto) y el propio motor cuando hay más trabajo. */
export async function POST(req: Request) {
  const inicio = Date.now();
  if (faltaBase()) return NextResponse.json({ error: 'Falta configurar Supabase' }, { status: 503 });
  if (!(await motorAutorizado(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  after(async () => {
    try {
      await correrMotor(inicio);
    } catch (e) {
      console.error('Motor:', e);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
