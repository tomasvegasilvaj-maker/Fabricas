import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { imagen, llamarClaude, texto } from '../../ia/claude';
import type { Agente } from '../../motor/tipos';
import { db, revisar } from '../../supabase';
import type { Json } from '../../tipos-db';
import { entrada, fichaComercio, logoDelComercio, SISTEMA_FABRICA, textoLogo, textoObjetivo, textoPreferencias } from '../comun';
import { leerCorreccion, reglasDelAgente, textoCorreccion, textoReglas } from './comun';

export const EsquemaIdea = z.object({
  titulo: z.string(),
  idea: z.string(),
  objeto_nfc: z.string(),
  escena: z.string(),
  estilo: z.string(),
  paleta: z.array(z.object({ hex: z.string(), uso: z.string() })),
  color_oscuro: z.string(),
  por_que: z.string(),
});
export type IdeaEquipo = z.infer<typeof EsquemaIdea>;
const EsquemaIdeas = z.object({ ideas: z.array(EsquemaIdea) });

export const CANTIDAD_IDEAS = 3;

function sistema(preferencias: string, reglas: string[]) {
  return `${SISTEMA_FABRICA}

Sos el agente Ideas del equipo de Pedrito. Proponés ${CANTIDAD_IDEAS} conceptos de placa pensados para el RUBRO del comercio. Después Pedrito elige uno y el agente Diseño lo convierte en una imagen con una IA de imágenes.

La plantilla es fija y la arma el sistema encima de la imagen: logo original arriba al medio, el círculo NFC al centro, una tarjeta blanca con el QR y «¿Sin NFC? Escaneá el código QR» abajo, y un pie con el rubro y «La Calera». Vos solo pensás la ILUSTRACIÓN de fondo y, sobre todo, el objeto protagonista que va justo en el centro, donde se apoya el celular.

Cómo pensar cada concepto:
- El protagonista es un objeto del rubro que se lee como un círculo (una pizza vista desde arriba, una taza con vapor, un frasco de esmalte, un poste de barbería visto de frente…). Va centrado y ocupa más o menos un tercio del ancho.
- La escena alrededor es simple y tranquila arriba (ahí va el logo) y abajo (ahí van la tarjeta del QR y el pie).
- Los tres conceptos bien distintos: otro objeto, otra escena, otra paleta (siempre compatible con el logo).
- Nada de texto, letras, números, logos ni QR dentro de la ilustración.

Formato de cada concepto:
- "titulo", "idea" y "por_que": en español rioplatense, cortos.
- "objeto_nfc", "escena" y "estilo": EN INGLÉS, porque van directo al prompt de la IA de imágenes. "objeto_nfc" es una frase nominal («a glossy pepperoni pizza seen from above»), "escena" una o dos oraciones, "estilo" unas pocas palabras («soft 3D clay render»).
- "paleta": de 3 a 5 colores en hex con su uso. "color_oscuro": el hex más oscuro de la paleta, que se usa para la píldora NFC, el texto del QR y el pie (tiene que contrastar con blanco).

${preferencias}

${textoReglas(reglas)}`.trim();
}

/** Ideas: conceptos para la ilustración según el rubro, con el objeto protagonista del círculo NFC. */
export const ideasEquipo: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const e = entrada<{ ronda: number; correccion: unknown }>(ctx.paso.entrada);
  const ronda = Number(e.ronda ?? 1);
  const correccion = leerCorreccion(e.correccion);
  const reglas = await reglasDelAgente(ctx, 'ideas', correccion);

  const [anteriores, usadas, logo] = await Promise.all([
    db().from('fab_conceptos').select('tanda, titulo, idea').eq('pedido_id', pedido.id).order('tanda').order('indice'),
    db().from('fab_conceptos').select('titulo, idea').eq('elegido', true).neq('pedido_id', pedido.id).order('created_at', { ascending: false }).limit(8),
    logoDelComercio(comercio),
  ]);
  const previas = anteriores.data ?? [];
  const tanda = previas.reduce((m, c) => Math.max(m, c.tanda), 0) + 1;

  const pedidoTexto = [
    fichaComercio(comercio, pedido),
    textoObjetivo(pedido.objetivo),
    previas.length ? `Conceptos que ya se propusieron para esta placa (no los repitas):\n${previas.map((c) => `- ${c.titulo}: ${c.idea}`).join('\n')}` : '',
    usadas.data?.length ? `Conceptos ya usados en otros comercios (cada placa es única):\n${usadas.data.map((c) => `- ${c.titulo}: ${c.idea}`).join('\n')}` : '',
    textoCorreccion(correccion),
    `Proponé exactamente ${CANTIDAD_IDEAS} conceptos.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'ideas del equipo',
    system: sistema(await textoPreferencias(comercio.rubro), reglas),
    contenido: [texto(`Logo del comercio. ${textoLogo(logo.info)}`), imagen(logo.vista, 'image/png'), texto(pedidoTexto)],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 8_000,
    formato: betaZodOutputFormat(EsquemaIdeas),
  });
  const lista = r.datos?.ideas.slice(0, CANTIDAD_IDEAS) ?? [];
  if (lista.length === 0) throw new Error('Ideas no devolvió conceptos.');
  return guardarIdeas(pedido.id, tanda, ronda, ctx.paso.id, lista, r.costo);
};

export async function guardarIdeas(pedidoId: string, tanda: number, ronda: number, pasoId: string, lista: IdeaEquipo[], costo = 0) {
  const filas = lista.map((c, i) => ({
    pedido_id: pedidoId,
    tanda,
    indice: i + 1,
    titulo: c.titulo.slice(0, 200),
    patron: 'objeto',
    idea: c.idea,
    datos: { ...c, linea: 'equipo' } as unknown as Json,
  }));
  const guardados = revisar(await db().from('fab_conceptos').insert(filas).select('id, titulo, indice'), 'guardar ideas');
  return {
    salida: { tanda, ronda, conceptos: guardados.map((c) => c.id), costo } as Json,
    resumen: `Ideas propuso ${guardados.length} conceptos (ronda ${ronda}): ${guardados.map((c) => `«${c.titulo}»`).join(', ')}.`,
    siguientes: [{ tipo: 'pedrito' as const, entrada: { revisar: 'ideas', paso_id: pasoId, ronda } }],
    pedidoEtapa: 'ideas' as const,
  };
}
