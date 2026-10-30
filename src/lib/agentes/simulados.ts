// Agentes de prueba: recorren el mismo circuito (base, archivos, Previas, render, PDFs) sin llamar a la IA.
// Se usan en pedidos marcados como «simulado». La activación del QR también queda simulada.
import type { Agente, TipoPaso } from '../motor/tipos';
import { db, revisar } from '../supabase';
import type { Json } from '../tipos-db';
import { entrada, infoLogo, leerVersion, proximoNumeroVersion } from './comun';
import type { Concepto } from './conceptos';
import { resultadoBoceto } from './boceto';
import { cerrarRevision, type Revision } from './revision';
import { guardarVersion } from './versiones';

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CONCEPTOS_DE_PRUEBA: Omit<Concepto, 'titulo'>[] = [
  {
    patron: 'objeto',
    idea: 'El círculo NFC es el producto estrella visto desde arriba.',
    circulo_nfc: 'Plato visto desde arriba con el producto en el centro.',
    composicion: 'Logo arriba, titular, arte central, franja oscura abajo con el QR.',
    fondo: 'Crema liso',
    paleta: [
      { hex: '#F4EBDD', uso: 'fondo' },
      { hex: '#3B2314', uso: 'textos y franja' },
      { hex: '#D9572B', uso: 'arte' },
    ],
    tipografia_titular: 'DM Serif Display',
    tipografia_textos: 'Montserrat',
    textos: { titular: '¿Te gustó?', bajada: 'CONTALO EN GOOGLE MAPS', nfc: 'ACERCÁ TU CELULAR ACÁ', qr: '¿Sin NFC? Escaneá el QR', extra: null },
    logo: 'Arriba al centro, sobre el fondo crema.',
    referencias_usadas: [],
    por_que: 'Prueba del circuito.',
  },
  {
    patron: 'chorreado',
    idea: 'Algo del rubro chorrea desde arriba sobre el círculo.',
    circulo_nfc: 'Círculo oscuro con gotas que caen encima.',
    composicion: 'Chorreado desde el borde superior, logo abajo a la izquierda, QR abajo a la derecha.',
    fondo: 'Rosa claro',
    paleta: [
      { hex: '#FBE3EC', uso: 'fondo' },
      { hex: '#5A1030', uso: 'textos' },
      { hex: '#C2185B', uso: 'chorreado' },
    ],
    tipografia_titular: 'Playfair Display',
    tipografia_textos: 'Poppins',
    textos: { titular: 'Tu opinión suma', bajada: 'Dejanos tu reseña', nfc: 'ACERCÁ TU CELULAR', qr: '¿Sin NFC? Escaneá', extra: null },
    logo: 'Abajo a la izquierda.',
    referencias_usadas: [],
    por_que: 'Prueba del circuito.',
  },
  {
    patron: 'envoltura',
    idea: 'Una línea suave rodea el círculo como vapor.',
    circulo_nfc: 'Círculo verde envuelto por una línea curva.',
    composicion: 'Titular arriba, arte al centro, logo y QR abajo.',
    fondo: 'Verde muy claro',
    paleta: [
      { hex: '#E8F3EC', uso: 'fondo' },
      { hex: '#1E4D3A', uso: 'textos' },
      { hex: '#5FA67E', uso: 'arte' },
    ],
    tipografia_titular: 'Josefin Sans',
    tipografia_textos: 'Inter',
    textos: { titular: 'Contanos', bajada: 'cómo te fue', nfc: 'APOYÁ TU CELULAR', qr: 'O escaneá el QR', extra: null },
    logo: 'Abajo a la izquierda.',
    referencias_usadas: [],
    por_que: 'Prueba del circuito.',
  },
];

export function svgDePrueba(c: Concepto, proporcion: number, variante = 0) {
  const [fondo, principal, acento] = [c.paleta[0]?.hex ?? '#F4EBDD', c.paleta[1]?.hex ?? '#3B2314', c.paleta[2]?.hex ?? '#C2185B'];
  let lw = 40;
  let lh = lw / proporcion;
  if (lh > 22) {
    lh = 22;
    lw = lh * proporcion;
  }
  const lx = (100 - lw) / 2;
  const arte =
    c.patron === 'chorreado'
      ? `<path d="M30 -3 H70 V58 Q66 70 62 58 Q58 76 54 58 Q50 66 46 58 Q42 80 38 58 Q34 66 30 58 Z" fill="${acento}"/>`
      : c.patron === 'envoltura'
        ? `<path d="M26 98 C14 64 44 50 52 58 C60 66 90 66 76 98" fill="none" stroke="${acento}" stroke-width="2.4" stroke-linecap="round"/>`
        : `<circle cx="50" cy="80" r="21" fill="${acento}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 106 156" width="106mm" height="156mm">
<rect x="-3" y="-3" width="106" height="156" fill="${fondo}"/>
${arte}
<rect id="logo-slot" x="${lx.toFixed(1)}" y="${c.patron === 'chorreado' ? 100 - lh : 8}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" fill="none"/>
<text x="50" y="${c.patron === 'chorreado' ? 12 : 44}" text-anchor="middle" font-family="${c.tipografia_titular}" font-size="8" fill="${principal}">${xml(c.textos.titular)}${variante ? ' ' : ''}</text>
<text x="50" y="${c.patron === 'chorreado' ? 18 : 51}" text-anchor="middle" font-family="${c.tipografia_textos}" font-size="3.2" fill="${principal}">${xml(c.textos.bajada)}</text>
<circle cx="50" cy="80" r="15.5" fill="${principal}"/>
<circle id="nfc-zone" cx="50" cy="80" r="14" fill="none"/>
<path d="M47 74 a8 8 0 0 1 0 12 M51 71 a12 12 0 0 1 0 18" fill="none" stroke="${fondo}" stroke-width="1.3" stroke-linecap="round"/>
<text x="50" y="${c.patron === 'chorreado' ? 104 : 108}" text-anchor="middle" font-family="${c.tipografia_textos}" font-weight="700" font-size="3.4" fill="${principal}">${xml(c.textos.nfc)}</text>
<rect x="-3" y="118" width="106" height="35" fill="${principal}"/>
<rect id="qr-slot" x="74" y="124" width="20" height="20" fill="none"/>
<text x="8" y="134" font-family="${c.tipografia_textos}" font-size="3.4" fill="${fondo}">${xml(c.textos.qr)}</text>
</svg>`;
}

const investigacion: Agente = async ({ comercio }) => {
  const datos = {
    encontrado: false,
    resumen: `Investigación simulada de ${comercio.nombre}.`,
    estilo_visual: null,
    colores_marca: [],
    tono: null,
    publico: null,
    destacados: [],
    diferenciales: [],
    frases_clientes: [],
    objetos_del_rubro: [],
    contacto: { direccion: null, instagram: null, whatsapp: null, web: null, google_maps_url: null, place_id: null, link_resenas: null },
    google: { puntaje: null, cantidad_resenas: null },
    fuentes: [],
    simulada: true,
    fecha: new Date(0).toISOString(),
  };
  await db().from('fab_comercios').update({ investigacion: datos as unknown as Json }).eq('id', comercio.id);
  return { salida: { simulada: true }, resumen: 'Investigación simulada.', siguientes: [{ tipo: 'inspiracion' }], pedidoEtapa: 'inspiracion' };
};

const inspiracion: Agente = async () => ({
  salida: { simulada: true },
  resumen: 'Inspiración simulada (sin búsqueda).',
  siguientes: [{ tipo: 'conceptos', entrada: {} }],
  pedidoEtapa: 'conceptos',
});

const conceptos: Agente = async ({ pedido }) => {
  const { data: previas } = await db().from('fab_conceptos').select('tanda').eq('pedido_id', pedido.id).order('tanda', { ascending: false }).limit(1);
  const tanda = (previas?.[0]?.tanda ?? 0) + 1;
  const filas = CONCEPTOS_DE_PRUEBA.map((c, i) => {
    const titulo = ['Plato protagonista', 'Chorreado de color', 'Envuelto en vapor'][i];
    return { pedido_id: pedido.id, tanda, indice: i + 1, titulo, patron: c.patron, idea: c.idea, datos: { ...c, titulo } as unknown as Json };
  });
  const guardados = revisar(await db().from('fab_conceptos').insert(filas).select('id'), 'guardar ideas de prueba');
  return {
    salida: { tanda, conceptos: guardados.map((c) => c.id) },
    resumen: `3 ideas de prueba (tanda ${tanda}).`,
    siguientes: guardados.map((c) => ({ tipo: 'boceto' as const, entrada: { concepto_id: c.id, tanda }, max_intentos: 2 })),
    pedidoEtapa: 'bocetos',
  };
};

const boceto: Agente = async ({ comercio, pedido, paso }) => {
  const { concepto_id: conceptoId, tanda } = entrada<{ concepto_id: string; tanda: number }>(paso.entrada);
  const concepto = revisar(await db().from('fab_conceptos').select('*').eq('id', conceptoId!).single(), 'leer idea');
  const info = infoLogo(comercio);
  const { version, chequeo } = await guardarVersion({
    respuesta: svgDePrueba(concepto.datos as unknown as Concepto, info?.proporcion ?? 2),
    pedidoId: pedido.id,
    comercio,
    conceptoId: concepto.id,
    origen: 'boceto',
    numero: concepto.indice,
    notas: `Boceto de prueba de «${concepto.titulo}»`,
  });
  return resultadoBoceto(comercio, concepto, version, chequeo, tanda ?? concepto.tanda);
};

const elaboracion: Agente = async ({ comercio, pedido, paso }) => {
  const e = entrada<{ version_id: string; comentario: string | null }>(paso.entrada);
  const version = await leerVersion(e.version_id!);
  const { version: nueva } = await guardarVersion({
    respuesta: version.svg,
    pedidoId: pedido.id,
    comercio,
    conceptoId: version.concepto_id,
    origen: 'elaboracion',
    numero: await proximoNumeroVersion(pedido.id),
    notas: e.comentario ? `Prueba con tu pedido: ${e.comentario}` : 'Elaboración de prueba',
  });
  return {
    salida: { version_id: nueva.id },
    resumen: `Versión ${nueva.numero} de prueba.`,
    siguientes: [{ tipo: 'revision', entrada: { version_id: nueva.id, comentario: e.comentario ?? null } }],
    pedidoEtapa: 'revision',
  };
};

const revision: Agente = async (ctx) => {
  const e = entrada<{ version_id: string; comentario: string | null }>(ctx.paso.entrada);
  const version = await leerVersion(e.version_id!);
  const rev: Revision = {
    puntajes: { nfc_protagonista: 4, se_entiende_nfc: 4, legibilidad: 4, marca: 4, composicion: 4, originalidad: 3, imprenta: 4 },
    problemas: [],
    pedido_cumplido: e.comentario ? true : null,
    veredicto: 'aprobada',
    resumen: 'Revisión simulada: aprobada.',
  };
  // Para probar las Previas, una placa con errores técnicos igual pasa (la revisión simulada no los corrige).
  const sinErrores = { ...version, chequeo: { ...(version.chequeo as object), errores: [] } as unknown as Json };
  return cerrarRevision({ ...ctx, pedido: { ...ctx.pedido, ronda: 99 } }, sinErrores, rev, 0, e.comentario ?? null);
};

export const AGENTES_SIMULADOS: Partial<Record<TipoPaso, Agente>> = { investigacion, inspiracion, conceptos, boceto, elaboracion, revision };
