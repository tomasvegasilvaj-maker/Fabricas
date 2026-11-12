import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as postCorrecciones } from '@/app/api/parte/correcciones/route';
import { correccionesAutorizadas, validarCorrecciones } from '@/lib/parte/correcciones';
import { svgErrores, svgListado } from '@/lib/parte/capturas';
import { agenteDelPaso, type EstadoFabrica, firmaEstado, pdfEnSeco, sinSecretos } from '@/lib/parte/estado';
import { armarCuerpo, armarResumen, fechaBuenosAires, motivoDe, revisarYMandarParte } from '@/lib/parte/parte';
import { renderizar } from '@/lib/placa/render';

afterEach(() => vi.unstubAllEnvs());

const ID = '3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f';

const valido = {
  tipo: 'correcciones',
  fecha: '2026-11-12T10:30:00-03:00',
  origen: 'pedrito',
  pedido_id: null,
  correcciones: [{ agente: 'diseno', regla: 'Que el NFC quede libre de objetos encima.', reemplaza_a: null, motivo: 'El parte mostró el NFC tapado.' }],
};

function estado(over: Partial<EstadoFabrica> = {}): EstadoFabrica {
  return {
    base: true,
    placas_hechas: 3,
    negocios_activos: 2,
    pedidos: [
      { id: 'a', numero: 1, comercio: 'Barbería Uno', estado: 'listo', etapa: 'listo', linea: 'equipo' },
      { id: 'b', numero: 2, comercio: 'Café Dos', estado: 'en_espera', etapa: 'aprobacion', linea: 'equipo' },
    ],
    errores: [],
    gemini_a4: { estado: 'ok', detalle: 'clave aceptada; PDF A4 armado en seco; sin generar imagen' },
    ultima_vista: null,
    ...over,
  };
}

describe('correcciones de Pedrito: autorización', () => {
  it('sin secreto cargado no entra nadie, ni con header', () => {
    vi.stubEnv('PARTE_CORRECCIONES_SECRET', '');
    expect(correccionesAutorizadas('Bearer algo')).toBe(false);
    expect(correccionesAutorizadas(null)).toBe(false);
  });
  it('con secreto: solo el Bearer exacto', () => {
    vi.stubEnv('PARTE_CORRECCIONES_SECRET', 'secreto-de-prueba');
    expect(correccionesAutorizadas('Bearer secreto-de-prueba')).toBe(true);
    expect(correccionesAutorizadas('Bearer otro')).toBe(false);
    expect(correccionesAutorizadas('secreto-de-prueba')).toBe(false);
    expect(correccionesAutorizadas(null)).toBe(false);
  });
  it('el endpoint responde 401 sin tocar la base', async () => {
    vi.stubEnv('PARTE_CORRECCIONES_SECRET', 'secreto-de-prueba');
    vi.stubEnv('SUPABASE_URL', '');
    const sin = await postCorrecciones(new Request('https://f.test/api/parte/correcciones', { method: 'POST', body: JSON.stringify(valido) }));
    expect(sin.status).toBe(401);
    const mal = await postCorrecciones(new Request('https://f.test/api/parte/correcciones', { method: 'POST', headers: { authorization: 'Bearer nop' }, body: JSON.stringify(valido) }));
    expect(mal.status).toBe(401);
  });
});

describe('correcciones de Pedrito: formato', () => {
  it('acepta el formato de la spec', () => {
    const r = validarCorrecciones(valido);
    expect(r.ok).toBe(true);
  });
  it('acepta pedrito como agente y normaliza la regla a una línea', () => {
    const r = validarCorrecciones({ ...valido, pedido_id: ID, correcciones: [{ agente: 'pedrito', regla: '- Revisá\nel QR   antes', reemplaza_a: ID, motivo: null }] });
    expect(r.ok && r.datos.correcciones[0].regla).toBe('Revisá el QR antes');
  });
  it('rechaza agentes, tipos, ids y reglas inválidas sin guardar nada', () => {
    expect(validarCorrecciones({ ...valido, tipo: 'parte' }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, origen: 'otro' }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, fecha: 'ayer' }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, pedido_id: '1; drop table x' }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, correcciones: [] }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, correcciones: [{ agente: 'grok', regla: 'algo útil' }] }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, correcciones: [{ agente: 'diseno', regla: 'x'.repeat(241) }] }).ok).toBe(false);
    expect(validarCorrecciones({ ...valido, correcciones: [{ agente: 'diseno', regla: 'ok', reemplaza_a: 'no-es-uuid' }] }).ok).toBe(false);
  });
});

describe('parte: contenido', () => {
  it('fecha ISO con zona de Buenos Aires', () => {
    expect(fechaBuenosAires(new Date('2026-11-12T13:00:00Z'))).toBe('2026-11-12T10:00:00-03:00');
  });
  it('tres líneas: métricas contra el objetivo, errores y Gemini', () => {
    const r = armarResumen(estado(), new Date('2026-11-12T13:00:00Z'));
    expect(r).toHaveLength(3);
    expect(r[0]).toContain('3/20');
    expect(r[0]).toContain('2/10');
    expect(r[1]).toBe('sin errores');
    expect(r[2]).toContain('funciona');
  });
  it('el cuerpo respeta el formato de Pedrito', () => {
    const e = estado({ errores: [{ donde: 'Pedido Café Dos · paso diseno', mensaje: 'Gemini no devolvió imagen', agente: 'diseno', clave: 'paso:1' }] });
    const c = armarCuerpo(e, [{ pantalla: 'error', url: 'https://x.test/e.png' }], 'error');
    expect(Object.keys(c).sort()).toEqual(['capturas', 'errores', 'fecha', 'gemini_a4', 'metricas', 'motivo', 'resumen', 'tipo'].sort());
    expect(c.metricas).toEqual({ placas_hechas: 3, negocios_activos: 2, objetivo_placas: 20, objetivo_negocios: 10, fecha_objetivo: '2026-12-31' });
    expect(c.errores[0]).toEqual({ donde: 'Pedido Café Dos · paso diseno', mensaje: 'Gemini no devolvió imagen', agente: 'diseno' });
  });
  it('la huella no cambia si no cambia nada, y sí con un pedido o un error nuevo', () => {
    const a = firmaEstado(estado());
    expect(firmaEstado(estado({ gemini_a4: { estado: 'ok', detalle: 'saldo distinto' } }))).toBe(a);
    expect(firmaEstado(estado({ placas_hechas: 4 }))).not.toBe(a);
    expect(firmaEstado(estado({ errores: [{ donde: 'x', mensaje: 'y', agente: 'app', clave: 'paso:9' }] }))).not.toBe(a);
  });
  it('motivo «error» solo si hay un error que no estaba en el último parte', () => {
    const e = estado({ errores: [{ donde: 'x', mensaje: 'y', agente: 'app', clave: 'paso:9' }] });
    expect(motivoDe(e, [])).toBe('error');
    expect(motivoDe(e, ['paso:9'])).toBe('cambio_estado');
    expect(motivoDe(estado(), ['paso:9'])).toBe('cambio_estado');
  });
  it('atribuye los pasos a cada agente', () => {
    expect(agenteDelPaso('conceptos')).toBe('ideas');
    expect(agenteDelPaso('diseno')).toBe('diseno');
    expect(agenteDelPaso('revision')).toBe('estructura');
    expect(agenteDelPaso('activacion')).toBe('produccion');
    expect(agenteDelPaso('pedrito')).toBe('app');
  });
  it('no deja pasar claves en los mensajes', () => {
    expect(sinSecretos('fallo con Bearer abcdefghijklmnop123')).toBe('fallo con Bearer ***');
    expect(sinSecretos('https://x.test/?key=AIzaSyA123456789012345')).not.toContain('AIza');
  });
});

describe('parte: envío', () => {
  it('sin las variables del webhook no manda nada ni toca la base', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PARTE_WEBHOOK_URL', '');
    vi.stubEnv('PARTE_WEBHOOK_SECRET', '');
    const r = await revisarYMandarParte({ origen: 'test' });
    expect(r).toMatchObject({ enviado: false, razon: 'sin_configurar' });
  });
  it('fuera de Producción no manda', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PARTE_WEBHOOK_URL', 'https://pedrito.test/hook');
    vi.stubEnv('PARTE_WEBHOOK_SECRET', 's');
    const r = await revisarYMandarParte({ origen: 'test' });
    expect(r).toMatchObject({ enviado: false, razon: 'sin_configurar' });
  });
});

describe('parte: preflight y capturas (sin Gemini)', () => {
  it('arma el A4 de dos placas en seco', async () => {
    expect(await pdfEnSeco()).toBeGreaterThan(500);
  });
  it('dibuja las pantallas de listado y de errores', async () => {
    const e = estado({ errores: [{ donde: 'Pedido <Café> & Co', mensaje: 'algo '.repeat(80), agente: 'diseno', clave: 'paso:1' }] });
    for (const svg of [svgListado(e, '2026-11-12 10:00'), svgErrores(e, '2026-11-12 10:00')]) {
      const { png } = await renderizar(svg, 900, '#f6f4ef');
      const meta = await sharp(png).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(900);
    }
  });
});
