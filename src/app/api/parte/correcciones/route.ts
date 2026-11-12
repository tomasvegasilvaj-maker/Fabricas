import { NextResponse } from 'next/server';
import { faltaBase } from '@/lib/configuracion';
import { correccionesAutorizadas, ErrorCorrecciones, guardarCorrecciones, MAX_BYTES_CORRECCIONES, validarCorrecciones } from '@/lib/parte/correcciones';

export const dynamic = 'force-dynamic';

function respuesta(cuerpo: Record<string, unknown>, status: number) {
  return NextResponse.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Entrada de Pedrito: las correcciones que juntó de Ideas, Diseño, Estructura y Producción.
 * Se guardan en fab_reglas_agente y la línea del equipo las relee antes de cada trabajo.
 */
export async function POST(req: Request) {
  // Sin el secreto correcto no se lee ni se guarda nada.
  if (!correccionesAutorizadas(req.headers.get('authorization'))) return respuesta({ ok: false, error: 'No autorizado' }, 401);
  if (faltaBase()) return respuesta({ ok: false, error: 'Falta configurar Supabase en la app.' }, 503);

  const largo = Number(req.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES_CORRECCIONES) return respuesta({ ok: false, error: 'El cuerpo es demasiado grande.' }, 413);
  const crudo = await req.text();
  if (crudo.length > MAX_BYTES_CORRECCIONES) return respuesta({ ok: false, error: 'El cuerpo es demasiado grande.' }, 413);

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return respuesta({ ok: false, error: 'El cuerpo no es JSON válido.' }, 400);
  }
  const v = validarCorrecciones(cuerpo);
  if (!v.ok) return respuesta({ ok: false, error: 'Formato inválido: no se guardó nada.', detalle: v.errores }, 422);

  try {
    const reglas = await guardarCorrecciones(v.datos);
    return respuesta(
      {
        ok: true,
        guardadas: reglas.filter((r) => !r.ya_existia).length,
        reglas,
        nota: 'Ideas, Diseño, Estructura, Producción y Pedrito leen estas reglas en la próxima generación.',
      },
      200,
    );
  } catch (e) {
    const status = e instanceof ErrorCorrecciones ? e.status : 500;
    console.error('Correcciones de Pedrito: no se guardaron.', status, e instanceof Error ? e.message : String(e));
    return respuesta({ ok: false, error: `No se guardó ninguna corrección: ${e instanceof Error ? e.message : 'error de la base'}` }, status);
  }
}
