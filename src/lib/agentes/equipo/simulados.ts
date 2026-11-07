// Versiones de prueba del equipo de Pedrito: mismo circuito (base, reglas, plantilla, PDF, QR simulado,
// prueba del link) sin llamar a Claude ni a Gemini. Pedrito corrige una vez a Diseño para probar que la
// regla se guarda (marcada como de prueba, así no la leen los pedidos reales).
import { renderizar } from '../../placa/render';
import { entrada } from '../comun';
import type { Agente } from '../../motor/tipos';
import { db } from '../../supabase';
import { leerCorreccion, reglasDelAgente } from './comun';
import { crearDiseno } from './diseno';
import { crearEstructura } from './estructura';
import { guardarIdeas, type IdeaEquipo } from './ideas';
import { crearPedrito, type Juez } from './pedrito';

const IDEAS_DE_PRUEBA: IdeaEquipo[] = [
  {
    titulo: 'El producto estrella visto desde arriba',
    idea: 'El círculo NFC es el producto más pedido del local, visto desde arriba.',
    objeto_nfc: 'the shop best-selling product seen from above',
    escena: 'Soft cream background with a few small props scattered at the sides.',
    estilo: 'soft 3D clay render',
    paleta: [
      { hex: '#F4EBDD', uso: 'fondo' },
      { hex: '#D9572B', uso: 'objeto' },
      { hex: '#3B2314', uso: 'textos y pie' },
    ],
    color_oscuro: '#3B2314',
    por_que: 'Prueba del circuito.',
  },
  {
    titulo: 'Herramienta del oficio',
    idea: 'La herramienta típica del rubro forma el círculo.',
    objeto_nfc: 'the typical tool of the trade arranged in a circle',
    escena: 'Pastel pink background, clean and airy.',
    estilo: 'flat vector illustration',
    paleta: [
      { hex: '#FBE3EC', uso: 'fondo' },
      { hex: '#C2185B', uso: 'objeto' },
      { hex: '#5A1030', uso: 'textos y pie' },
    ],
    color_oscuro: '#5A1030',
    por_que: 'Prueba del circuito.',
  },
  {
    titulo: 'Vapor que envuelve',
    idea: 'Una línea suave rodea el círculo como vapor.',
    objeto_nfc: 'a round object wrapped by a soft swirl of steam',
    escena: 'Very light green background.',
    estilo: 'minimal semi-flat illustration',
    paleta: [
      { hex: '#E8F3EC', uso: 'fondo' },
      { hex: '#5FA67E', uso: 'objeto' },
      { hex: '#1E4D3A', uso: 'textos y pie' },
    ],
    color_oscuro: '#1E4D3A',
    por_que: 'Prueba del circuito.',
  },
];

export const REGLA_DE_PRUEBA = 'Prueba: que el objeto central llene el círculo NFC sin tocar el anillo punteado.';

const ideas: Agente = async (ctx) => {
  const e = entrada<{ ronda: number; correccion: unknown }>(ctx.paso.entrada);
  const ronda = Number(e.ronda ?? 1);
  await reglasDelAgente(ctx, 'ideas', leerCorreccion(e.correccion));
  const { data } = await db().from('fab_conceptos').select('tanda').eq('pedido_id', ctx.pedido.id).order('tanda', { ascending: false }).limit(1).maybeSingle();
  return guardarIdeas(ctx.pedido.id, (data?.tanda ?? 0) + 1, ronda, ctx.paso.id, IDEAS_DE_PRUEBA);
};

/** Imagen de mentira de 1024 × 1536 (2:3): fondo de la paleta y un objeto redondo al centro. */
export async function imagenDePrueba(idea: IdeaEquipo, ronda: number) {
  const fondo = idea.paleta[0]?.hex ?? '#F4EBDD';
  const objeto = idea.paleta[1]?.hex ?? '#D9572B';
  const radio = ronda > 1 ? 150 : 110; // la ronda 2 «arregla» lo que pidió Pedrito
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
  <defs><radialGradient id="g" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.6"/><stop offset="1" stop-color="${fondo}"/></radialGradient></defs>
  <rect width="1024" height="1536" fill="${fondo}"/><rect width="1024" height="1536" fill="url(#g)"/>
  <circle cx="512" cy="768" r="${radio + 18}" fill="#000000" fill-opacity="0.08"/>
  <circle cx="512" cy="768" r="${radio}" fill="${objeto}"/>
  <circle cx="470" cy="725" r="${Math.round(radio * 0.28)}" fill="#FFFFFF" fill-opacity="0.35"/>
</svg>`;
  return (await renderizar(svg, 1024)).png;
}

const diseno = crearDiseno(async (ctx, _prompt, idea) => {
  const ronda = Number(entrada<{ ronda: number }>(ctx.paso.entrada).ronda ?? 1);
  return { datos: await imagenDePrueba(idea, ronda), mime: 'image/png', modelo: 'prueba', costo: 0 };
});

const estructura = crearEstructura(async () => null);

const juezDePrueba: Juez = {
  async ideas() {
    return { aprobar: true, elegido: 1, indicaciones: 'Keep it simple and centered.', correccion: null, motivo: 'Prueba: se elige la primera idea.' };
  },
  async diseno(_ctx, { ronda }) {
    if (ronda === 1) {
      return {
        aprobar: false,
        correccion: { texto: 'Prueba: el objeto del centro quedó chico, que llene el círculo NFC.', regla: REGLA_DE_PRUEBA },
        motivo: 'Prueba de corrección.',
        observaciones: [],
      };
    }
    return { aprobar: true, correccion: null, motivo: 'Prueba: la segunda ronda está bien.', observaciones: [] };
  },
};

export const AGENTES_EQUIPO_SIMULADOS = { pedrito: crearPedrito(juezDePrueba), ideas, diseno, estructura };
