import { afterEach, describe, expect, it, vi } from 'vitest';
import { claveInterna } from '@/lib/motor/secreto';
import { bearerValido, crearSesion, secretoSesion, sesionValida } from '@/lib/sesion';

afterEach(() => vi.unstubAllEnvs());

describe('secreto de la sesión', () => {
  it('usa SESSION_SECRET si está', async () => {
    vi.stubEnv('SESSION_SECRET', 'propio');
    expect(await secretoSesion()).toBe('propio');
  });

  it('si falta, lo deriva de la clave de Supabase y de la contraseña', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'clave-servicio');
    vi.stubEnv('APP_PASSWORD', 'uno');
    const a = await secretoSesion();
    expect(a).toMatch(/^[\w-]{40,}$/);
    expect(await secretoSesion()).toBe(a);
    vi.stubEnv('APP_PASSWORD', 'dos');
    expect(await secretoSesion()).not.toBe(a);
  });

  it('sin datos no hay secreto', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('APP_PASSWORD', 'uno');
    expect(await secretoSesion()).toBeNull();
  });

  it('una sesión firmada con otro secreto no vale', async () => {
    const token = await crearSesion('a');
    expect(await sesionValida(token, 'a')).toBe(true);
    expect(await sesionValida(token, 'b')).toBe(false);
  });
});

describe('clave interna del motor', () => {
  it('se deriva de la clave de Supabase y la acepta el motor', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'clave-servicio');
    const clave = claveInterna();
    expect(clave).toMatch(/^[0-9a-f]{64}$/);
    expect(bearerValido(`Bearer ${clave}`, clave)).toBe(true);
    expect(bearerValido('Bearer otra', clave)).toBe(false);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(claveInterna()).toBeNull();
  });
});
