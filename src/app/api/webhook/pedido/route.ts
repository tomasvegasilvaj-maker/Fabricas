import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { urlPublica } from '@/lib/agentes/web';
import { env } from '@/lib/env';
import { correrMotor } from '@/lib/motor/motor';
import { crearPedido, MAX_BYTES_LOGO, type ArchivoSubido } from '@/lib/motor/pedidos';
import { MIMES_LOGO } from '@/lib/placa/logo';
import { bearerValido } from '@/lib/sesion';

export const maxDuration = 300;

const texto = (max: number) => z.string().trim().max(max).nullish();

const Esquema = z.object({
  comercio_id: z.uuid().nullish(),
  comercio: z.object({
    nombre: z.string().trim().min(1).max(120),
    rubro: z.string().trim().min(1).max(120),
    ciudad: texto(120),
    direccion: texto(300),
    instagram: texto(300),
    google_maps_url: texto(1000),
    whatsapp: texto(60),
    web: texto(1000),
    link_resenas: texto(1000),
  }),
  objetivo: z.string(),
  destino_url: texto(2000),
  ideas: texto(3000),
  /** El logo va por link (https) o en base64 (con o sin el prefijo data:). */
  logo_url: texto(2000),
  logo_base64: z.string().nullish(),
  logo_mime: texto(60),
  simulado: z.boolean().optional(),
  auto_aprobar: z.boolean().optional(),
});

/** Reconoce el formato por los primeros bytes, por si el servidor manda un tipo genérico. */
function mimePorContenido(datos: Buffer): string | null {
  if (datos.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff) return 'image/jpeg';
  if (datos.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (datos.subarray(0, 4).toString('latin1') === 'RIFF' && datos.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (datos.subarray(4, 12).toString('latin1').startsWith('ftypavi')) return 'image/avif';
  if (/<svg[\s>]/i.test(datos.subarray(0, 4096).toString('utf8'))) return 'image/svg+xml';
  return null;
}

function mimeFinal(declarado: string | null | undefined, datos: Buffer) {
  const limpio = declarado?.split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (limpio && MIMES_LOGO.includes(limpio)) return limpio;
  return mimePorContenido(datos) ?? limpio ?? 'application/octet-stream';
}

async function logoDesdeLink(link: string): Promise<ArchivoSubido> {
  const u = urlPublica(link);
  if (!u) throw new Error('logo_url tiene que ser un link público http(s).');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`No se pudo bajar el logo (${r.status}).`);
  if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES_LOGO) throw new Error('El logo pesa más de 4 MB.');
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > MAX_BYTES_LOGO) throw new Error('El logo pesa más de 4 MB.');
  return { datos, mime: mimeFinal(r.headers.get('content-type'), datos), nombre: u.pathname.split('/').pop() || 'logo' };
}

function logoDesdeBase64(valor: string, mime: string | null | undefined): ArchivoSubido {
  const m = /^data:([^;,]+)?(;base64)?,/i.exec(valor);
  const datos = Buffer.from(m ? valor.slice(m[0].length) : valor, 'base64');
  if (datos.length === 0) throw new Error('logo_base64 está vacío o no es base64.');
  if (datos.length > MAX_BYTES_LOGO) throw new Error('El logo pesa más de 4 MB.');
  return { datos, mime: mimeFinal(m?.[1] ?? mime, datos), nombre: 'logo' };
}

/**
 * Carga un pedido desde otro sistema (n8n, Make, un formulario). Pide `Authorization: Bearer WEBHOOK_SECRET`.
 * Ojo: Vercel corta los pedidos de más de 4,5 MB, así que un logo en base64 tiene que pesar menos de ~3 MB.
 */
export async function POST(req: Request) {
  const inicio = Date.now();
  if (!env.webhookSecret) return NextResponse.json({ error: 'El webhook está apagado: falta WEBHOOK_SECRET.' }, { status: 503 });
  if (!bearerValido(req.headers.get('authorization'), env.webhookSecret)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: 'El cuerpo tiene que ser JSON.' }, { status: 400 });
  }
  const leido = Esquema.safeParse(cuerpo);
  if (!leido.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: z.flattenError(leido.error).fieldErrors }, { status: 400 });
  }
  const d = leido.data;

  let pedido;
  try {
    const logo = d.logo_base64 ? logoDesdeBase64(d.logo_base64, d.logo_mime) : d.logo_url ? await logoDesdeLink(d.logo_url) : null;
    pedido = await crearPedido({
      comercioId: d.comercio_id ?? null,
      comercio: d.comercio,
      logo,
      objetivo: d.objetivo,
      destinoUrl: d.destino_url,
      ideas: d.ideas,
      simulado: d.simulado,
      autoAprobar: d.auto_aprobar,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }

  after(async () => {
    try {
      await correrMotor(inicio);
    } catch (e) {
      console.error('Motor:', e);
    }
  });
  return NextResponse.json(
    { id: pedido.id, numero: pedido.numero, url: `${env.appUrl}/pedidos/${pedido.id}`, falta_logo: !d.logo_base64 && !d.logo_url && !d.comercio_id },
    { status: 201 },
  );
}
