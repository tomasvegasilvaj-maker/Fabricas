// Sesión de un solo usuario (Tomi): cookie firmada con HMAC, sin base de datos.
// Usa Web Crypto para funcionar igual en el proxy y en las acciones del servidor.

export const COOKIE_SESION = 'fab_sesion';
export const DURACION_SESION_SEG = 60 * 60 * 24 * 30;

const codificador = new TextEncoder();

function aBase64Url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function clave(secreto: string) {
  return crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function firmar(texto: string, secreto: string) {
  return aBase64Url(await crypto.subtle.sign('HMAC', await clave(secreto), codificador.encode(texto)));
}

function igualesSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

export async function crearSesion(secreto: string, ahora = Date.now()) {
  const vence = Math.floor(ahora / 1000) + DURACION_SESION_SEG;
  return `${vence}.${await firmar(String(vence), secreto)}`;
}

export async function sesionValida(token: string | undefined, secreto: string, ahora = Date.now()) {
  if (!token) return false;
  const [vence, firma] = token.split('.');
  if (!vence || !firma || !/^\d+$/.test(vence)) return false;
  if (Number(vence) < Math.floor(ahora / 1000)) return false;
  return igualesSeguro(firma, await firmar(vence, secreto));
}

/** Compara contraseñas sin filtrar el largo por el tiempo de respuesta. */
export async function mismaClave(ingresada: string, real: string) {
  const [a, b] = await Promise.all([firmar(ingresada, 'clave'), firmar(real, 'clave')]);
  return igualesSeguro(a, b);
}

/** Bearer token de las rutas internas (motor, webhook). */
export function bearerValido(cabecera: string | null, secreto: string | null) {
  if (!secreto || !cabecera?.startsWith('Bearer ')) return false;
  return igualesSeguro(cabecera.slice(7), secreto);
}
