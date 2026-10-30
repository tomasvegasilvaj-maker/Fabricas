import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION, secretoSesion, sesionValida } from './lib/sesion';

export async function proxy(req: NextRequest) {
  const secreto = await secretoSesion();
  if (secreto && (await sesionValida(req.cookies.get(COOKIE_SESION)?.value, secreto))) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const login = new URL('/login', req.url);
  if (req.nextUrl.pathname !== '/') login.searchParams.set('volver', req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Todo pide sesión menos el login, las rutas con su propio secreto (motor, webhook), la salud y los estáticos.
  matcher: ['/((?!login|api/motor|api/webhook|api/salud|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
