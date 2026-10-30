import { after, NextResponse } from 'next/server';
import { correrMotor } from '@/lib/motor/motor';
import { bearerValido } from '@/lib/sesion';

export const maxDuration = 300;

/** Lo llaman el reloj de Supabase (cada minuto) y el propio motor cuando hay más trabajo. */
export async function POST(req: Request) {
  const inicio = Date.now();
  if (!bearerValido(req.headers.get('authorization'), process.env.MOTOR_SECRET ?? null)) {
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
