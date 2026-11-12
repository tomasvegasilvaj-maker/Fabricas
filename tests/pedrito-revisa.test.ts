import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as postRevision } from '@/app/api/parte/revision/route';
import { ErrorPaso, ErrorSinRespuesta, traducirError } from '@/lib/ia/claude';
import { mensajeParaGateway, partesGoogle } from '@/lib/ia/gemini';
import { textoCorreccionesTomi, versionDePartida } from '@/lib/motor/ficha';
import { puedeReintentar } from '@/lib/motor/motor';
import { validarRevision } from '@/lib/parte/revision';
import { armarCuerpoVersion, esperaPedritoSeg } from '@/lib/parte/version';
import { ciudadDelPie, textoPie } from '@/lib/placa/plantilla';

afterEach(() => vi.unstubAllEnvs());

const V = '3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f';

describe('ficha de correcciones', () => {
  it('reconoce «partí de la versión X»', () => {
    expect(versionDePartida('Partí de la versión 3 y poné el fondo más claro')).toBe(3);
    expect(versionDePartida('parti de la v2')).toBe(2);
    expect(versionDePartida('desde la versión 12')).toBe(12);
    expect(versionDePartida('el fondo más claro')).toBeNull();
  });
  it('arma todas las correcciones en orden y aclara que se suman', () => {
    const t = textoCorreccionesTomi([
      { orden: 1, texto: 'más queso' },
      { orden: 2, texto: 'fondo claro' },
    ]);
    expect(t).toContain('1. más queso\n2. fondo claro');
    expect(t).toContain('ALL of them still apply');
    expect(textoCorreccionesTomi([])).toBe('');
  });
});

describe('Gemini edita una versión', () => {
  const base = { datos: Buffer.from('abc'), mime: 'image/jpeg' };
  it('Gateway: texto + imagen', () => {
    const m = mensajeParaGateway('cambiá el fondo', base) as { content: { type: string; image_url?: { url: string } }[] };
    expect(m.content[0]).toEqual({ type: 'text', text: 'cambiá el fondo' });
    expect(m.content[1].image_url?.url).toBe(`data:image/jpeg;base64,${base.datos.toString('base64')}`);
    expect(mensajeParaGateway('solo texto')).toEqual({ role: 'user', content: 'solo texto' });
  });
  it('Google: texto + inline_data', () => {
    expect(partesGoogle('x', base)).toEqual([{ text: 'x' }, { inline_data: { mime_type: 'image/jpeg', data: base.datos.toString('base64') } }]);
    expect(partesGoogle('x')).toEqual([{ text: 'x' }]);
  });
});

describe('sin reintentos en loop', () => {
  it('un solo reintento y solo para errores pasajeros', () => {
    const pasajero = new ErrorPaso('429', true, 120);
    expect(puedeReintentar(pasajero, 1, 3)).toBe(true);
    expect(puedeReintentar(pasajero, 2, 3)).toBe(false);
    expect(puedeReintentar(new ErrorPaso('clave', false), 1, 3)).toBe(false);
    expect(puedeReintentar(new ErrorSinRespuesta('no contestó'), 1, 3)).toBe(false);
  });
  it('si la IA no contesta a tiempo, no se reintenta: va a Tomi', () => {
    expect(traducirError(new Error('x'), true)).toBeInstanceOf(ErrorSinRespuesta);
  });
});

describe('revisión de Pedrito', () => {
  it('valida ok y alerta', () => {
    expect(validarRevision({ tipo: 'revision', fecha: '2026-11-12T15:00:00-03:00', origen: 'pedrito', version_id: V, estado: 'ok' }).ok).toBe(true);
    expect(
      validarRevision({
        tipo: 'revision',
        fecha: '2026-11-12T15:00:00-03:00',
        origen: 'pedrito',
        version_id: V,
        estado: 'alerta',
        alertas: [{ tipo: 'contradice_correccion', detalle: 'El prompt pide fondo oscuro y Tomi pidió claro.' }],
      }).ok,
    ).toBe(true);
  });
  it('una alerta sin motivo o con formato raro no pasa', () => {
    expect(validarRevision({ tipo: 'revision', fecha: '2026-11-12T15:00:00-03:00', origen: 'pedrito', version_id: V, estado: 'alerta' }).ok).toBe(false);
    expect(validarRevision({ tipo: 'revision', fecha: 'ayer', origen: 'pedrito', version_id: V, estado: 'ok' }).ok).toBe(false);
    expect(validarRevision({ tipo: 'revision', fecha: '2026-11-12T15:00:00-03:00', origen: 'pedrito', version_id: 'x', estado: 'ok' }).ok).toBe(false);
  });
  it('sin el secreto responde 401', async () => {
    vi.stubEnv('PARTE_CORRECCIONES_SECRET', 'secreto');
    const r = await postRevision(new Request('https://f.test/api/parte/revision', { method: 'POST', headers: { authorization: 'Bearer otro' }, body: '{}' }));
    expect(r.status).toBe(401);
  });
  it('espera 5 minutos por defecto y se puede cambiar', () => {
    expect(esperaPedritoSeg()).toBe(300);
    vi.stubEnv('PEDRITO_ESPERA_SEG', '600');
    expect(esperaPedritoSeg()).toBe(600);
  });
});

describe('parte de versión', () => {
  it('lleva prompt, trabajador, costo, n.º de pedido e imagen, correcciones e imagen en base64', () => {
    const c = armarCuerpoVersion(
      { pedido: { id: 'p', numero: 8, tope_usd: 2 } as never, comercio: { nombre: '3D Córdoba', rubro: 'Arquitectura' } as never },
      {
        versionId: V,
        versionNumero: 4,
        ronda: 2,
        trabajador: 'diseno',
        prompt: 'PROMPT COMPLETO',
        costoUsd: 0.134,
        correcciones: [{ id: 'c1', orden: 1, texto: 'fondo claro' }],
        reglas: ['Centrá el objeto'],
        baseVersionNumero: 3,
        baseVersionId: 'v3',
        imagen: Buffer.from(''),
        imagenPath: 'a',
        vista: Buffer.from(''),
        vistaPath: 'b',
      },
      1.75,
      { placa: { mime: 'image/jpeg', base64: 'AAA' }, fondo: { mime: 'image/jpeg', base64: 'BBB' } },
    );
    expect(c).toMatchObject({
      tipo: 'parte_version',
      pedido: { numero: 8 },
      version: { numero: 4, parte_de_version: 3 },
      trabajador: 'diseno',
      prompt: 'PROMPT COMPLETO',
      costo_paso_usd: 0.134,
      gasto_pedido_usd: 1.75,
      correcciones_usadas: ['c1'],
      imagen_placa: { mime: 'image/jpeg', base64: 'AAA' },
    });
    expect(c.responder_a).toMatch(/\/api\/parte\/revision$/);
  });
});

describe('datos del comercio en su ficha', () => {
  it('el pie usa la ciudad del comercio, o La Calera si falta', () => {
    expect(textoPie('Café', 'Río Ceballos')).toBe('CAFÉ · RÍO CEBALLOS');
    expect(textoPie('Café', null)).toBe('CAFÉ · LA CALERA');
    expect(ciudadDelPie('  ')).toBe('La Calera');
  });
});
