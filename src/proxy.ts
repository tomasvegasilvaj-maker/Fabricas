import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION, secretoSesion, sesionValida, vistaPublica } from './lib/sesion';

export async function proxy(req: NextRequest) {
  const secreto = await secretoSesion();
  if (secreto && (await sesionValida(req.cookies.get(COOKIE_SESION)?.value, secreto))) return NextResponse.next();
  const api = req.nextUrl.pathname.startsWith('/api/');
  if (vistaPublica()) {
    // Modo vista: sin sesión se leen las páginas y las imágenes. Las acciones del servidor también pasan,
    // pero cada una pide la sesión antes de hacer nada y contesta «tenés que entrar» sin romper la página.
    const lectura = req.method === 'GET' || req.method === 'HEAD';
    if (api ? lectura && req.nextUrl.pathname.startsWith('/api/archivos/') : lectura || req.headers.has('next-action')) {
      return NextResponse.next();
    }
  }
  if (api) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const login = new URL('/login', req.url);
  if (req.nextUrl.pathname !== '/') login.searchParams.set('volver', req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Todo pasa por acá menos el login, las rutas con su propio secreto (motor, webhook, parte), la salud y los estáticos.
  matcher: ['/((?!login|api/motor|api/webhook|api/salud|api/parte|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
