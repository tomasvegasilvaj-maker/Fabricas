import { isIP } from 'node:net';
import sharp from 'sharp';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const MAX_BYTES = 8 * 1024 * 1024;

/** Solo URLs públicas http(s): nada de localhost ni redes internas (las URLs las propone la IA). */
export function urlPublica(valor: string | null | undefined): URL | null {
  if (!valor) return null;
  let u: URL;
  try {
    u = new URL(valor.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return null;
  if (isIP(host)) {
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(':')) return null;
  }
  return u;
}

async function leer(url: URL, accept: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'es-AR,es;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(9000) });
  if (!r.ok) return null;
  const largo = Number(r.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES) return null;
  const datos = Buffer.from(await r.arrayBuffer());
  if (datos.length > MAX_BYTES) return null;
  return { datos, tipo: r.headers.get('content-type') ?? '' };
}

/** Busca la imagen principal de una página (og:image / twitter:image). */
export async function imagenDePagina(pagina: string): Promise<string | null> {
  const u = urlPublica(pagina);
  if (!u) return null;
  const r = await leer(u, 'text/html,application/xhtml+xml');
  if (!r || !r.tipo.includes('html')) return null;
  const html = r.datos.subarray(0, 600_000).toString('utf8');
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const clave of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    for (const meta of metas) {
      const nombre = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(meta)?.[1]?.toLowerCase();
      const contenido = /content\s*=\s*["']([^"']+)["']/i.exec(meta)?.[1];
      if (nombre === clave && contenido) {
        try {
          return new URL(contenido.replace(/&amp;/g, '&'), u).toString();
        } catch {
          // sigue
        }
      }
    }
  }
  return null;
}

/** Baja una imagen y la deja en JPEG liviano para mandársela a la IA. */
export async function bajarImagen(url: string, lado = 768): Promise<Buffer | null> {
  const u = urlPublica(url);
  if (!u) return null;
  try {
    const r = await leer(u, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8');
    if (!r || !r.tipo.startsWith('image/')) return null;
    const img = sharp(r.datos, { failOn: 'error', animated: false });
    const meta = await img.metadata();
    if (!meta.width || !meta.height || meta.width < 160 || meta.height < 160) return null;
    return await img
      .rotate()
      .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}
