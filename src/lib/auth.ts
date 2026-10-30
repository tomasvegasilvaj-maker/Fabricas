import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_SESION, secretoSesion, sesionValida } from './sesion';

/** Segunda barrera además del proxy: las páginas y acciones verifican la sesión otra vez. */
export async function haySesion() {
  // cookies() va primero: además de leer la sesión, marca la página como dinámica aunque falte el secreto en el build.
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  const secreto = await secretoSesion();
  if (!secreto) return false;
  return sesionValida(token, secreto);
}

export async function requiereSesion() {
  if (!(await haySesion())) redirect('/login');
}
