import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearSesion, secretoSesion } from '@/lib/sesion';
import { proxy } from '@/proxy';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'clave-servicio');
  vi.stubEnv('APP_PASSWORD', 'uno');
});
afterEach(() => vi.unstubAllEnvs());

async function pedir(ruta: string, op: { method?: string; accion?: boolean; sesion?: string } = {}) {
  const headers = new Headers();
  if (op.accion) headers.set('next-action', 'abc123');
  if (op.sesion) headers.set('cookie', `fab_sesion=${op.sesion}`);
  return proxy(new NextRequest(`https://fabrica.test${ruta}`, { method: op.method ?? 'GET', headers }));
}

const pasa = (r: Response) => r.headers.get('x-middleware-next') === '1';

describe('modo vista', () => {
  it('sin sesión deja mirar páginas e imágenes, y nada más', async () => {
    expect(pasa(await pedir('/'))).toBe(true);
    expect(pasa(await pedir('/pedidos/123'))).toBe(true);
    expect(pasa(await pedir('/api/archivos/pedidos/1/vista.png'))).toBe(true);
    // Las acciones del servidor pasan, pero cada una pide la sesión (lo controla la última prueba).
    expect(pasa(await pedir('/pedidos/123', { method: 'POST', accion: true }))).toBe(true);
    expect((await pedir('/pedidos', { method: 'POST' })).status).toBe(307);
    expect((await pedir('/api/archivos/pedidos/1/vista.png', { method: 'POST' })).status).toBe(401);
    expect((await pedir('/api/otra')).status).toBe(401);
  });

  it('con VISTA_PUBLICA=no vuelve a pedir la contraseña para todo', async () => {
    vi.stubEnv('VISTA_PUBLICA', 'no');
    const pagina = await pedir('/pedidos/123');
    expect(pagina.status).toBe(307);
    expect(pagina.headers.get('location')).toBe('https://fabrica.test/login?volver=%2Fpedidos%2F123');
    expect((await pedir('/pedidos/123', { method: 'POST', accion: true })).status).toBe(307);
    expect((await pedir('/api/archivos/pedidos/1/vista.png')).status).toBe(401);
  });

  it('con sesión pasa todo', async () => {
    vi.stubEnv('VISTA_PUBLICA', 'no');
    const sesion = await crearSesion((await secretoSesion())!);
    expect(pasa(await pedir('/pedidos', { method: 'POST', sesion }))).toBe(true);
    expect(pasa(await pedir('/api/archivos/pedidos/1/vista.png', { sesion }))).toBe(true);
  });

  it('cada acción del servidor que cambia algo pide la sesión antes de hacer nada', () => {
    const fuente = readFileSync(path.join(__dirname, '../src/app/acciones.ts'), 'utf8');
    const acciones = [...fuente.matchAll(/^export async function (\w+)\(([\s\S]*?)^\}/gm)];
    expect(acciones.length).toBeGreaterThanOrEqual(6);
    for (const [, nombre, cuerpo] of acciones) {
      if (nombre === 'entrar' || nombre === 'salir') continue;
      // Lo primero que espera tiene que ser la sesión: antes solo se leen campos del formulario.
      expect(cuerpo.indexOf('await '), nombre).toBe(cuerpo.indexOf('await exigirSesion()'));
      expect(cuerpo.indexOf('await exigirSesion()'), nombre).toBeGreaterThan(0);
    }
  });
});
