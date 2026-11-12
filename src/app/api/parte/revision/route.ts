import { NextResponse } from 'next/server';
import { faltaBase } from '@/lib/configuracion';
import { correccionesAutorizadas } from '@/lib/parte/correcciones';
import { guardarRevision, validarRevision } from '@/lib/parte/revision';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 32 * 1024;

function respuesta(cuerpo: Record<string, unknown>, status: number) {
  return NextResponse.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Pedrito contesta el parte de una versión (mismo secreto que las correcciones). */
export async function POST(req: Request) {
  if (!correccionesAutorizadas(req.headers.get('authorization'))) return respuesta({ ok: false, error: 'No autorizado' }, 401);
  if (faltaBase()) return respuesta({ ok: false, error: 'Falta configurar Supabase en la app.' }, 503);
  const crudo = await req.text();
  if (crudo.length > MAX_BYTES) return respuesta({ ok: false, error: 'El cuerpo es demasiado grande.' }, 413);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return respuesta({ ok: false, error: 'El cuerpo no es JSON válido.' }, 400);
  }
  const v = validarRevision(cuerpo);
  if (!v.ok) return respuesta({ ok: false, error: 'Formato inválido: no se guardó nada.', detalle: v.errores }, 422);
  try {
    const r = await guardarRevision(v.datos);
    if (!r.encontrado) return respuesta({ ok: false, error: 'No hay un parte para esa version_id.' }, 404);
    return respuesta(
      {
        ok: true,
        pedido: r.pedido_numero,
        version: r.version_numero,
        estado: v.datos.estado,
        nota: v.datos.estado === 'alerta' ? 'La imagen siguiente queda frenada hasta que Tomi decida.' : 'Diseño puede seguir con la imagen siguiente.',
      },
      200,
    );
  } catch (e) {
    console.error('Revisión de Pedrito: no se guardó.', e instanceof Error ? e.message : String(e));
    return respuesta({ ok: false, error: 'No se pudo guardar la revisión.' }, 500);
  }
}
