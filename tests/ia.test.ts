import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { traducirError } from '@/lib/ia/claude';

function errorApi(status: number, tipo: string, mensaje: string) {
  const cuerpo = { type: 'error', error: { type: tipo, message: mensaje }, request_id: 'req_prueba' };
  return Anthropic.APIError.generate(status, cuerpo, undefined, new Headers({ 'request-id': 'req_prueba' }));
}

describe('errores de Anthropic', () => {
  it('muestra el motivo que dio la API y decide si se reintenta', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const clave = traducirError(errorApi(401, 'authentication_error', 'invalid x-api-key'), false);
    expect(clave.reintentable).toBe(false);
    expect(clave.message).toContain('authentication_error: invalid x-api-key (req_prueba)');
    expect(clave.message).toContain('ANTHROPIC_API_KEY');

    const permiso = traducirError(errorApi(403, 'permission_error', 'Not allowed'), false);
    expect(permiso.reintentable).toBe(false);
    expect(permiso.message).toContain('permission_error: Not allowed');

    const workspace = traducirError(errorApi(400, 'invalid_request_error', 'This API key is not scoped to a workspace'), false);
    expect(workspace.message).toContain('(400): invalid_request_error: This API key is not scoped to a workspace');

    expect(traducirError(errorApi(429, 'rate_limit_error', 'Slow down'), false).reintentable).toBe(true);
    expect(traducirError(errorApi(529, 'overloaded_error', 'Overloaded'), false).reintentable).toBe(true);
  });
});
