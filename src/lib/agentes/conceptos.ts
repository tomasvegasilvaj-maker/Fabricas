import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { imagen, llamarClaude, texto } from '../ia/claude';
import type { Agente } from '../motor/tipos';
import { familiaDisponible, textoFuentesParaPrompt } from '../placa/fuentes';
import { bajarArchivo, db, revisar } from '../supabase';
import type { Json } from '../tipos-db';
import {
  entrada,
  fichaComercio,
  logoDelComercio,
  SISTEMA_FABRICA,
  textoInvestigacion,
  textoLogo,
  textoObjetivo,
  textoPreferencias,
} from './comun';

export const EsquemaConcepto = z.object({
  titulo: z.string(),
  patron: z.enum(['objeto', 'chorreado', 'envoltura', 'otro']),
  idea: z.string(),
  circulo_nfc: z.string(),
  composicion: z.string(),
  fondo: z.string(),
  paleta: z.array(z.object({ hex: z.string(), uso: z.string() })),
  tipografia_titular: z.string(),
  tipografia_textos: z.string(),
  textos: z.object({ titular: z.string(), bajada: z.string(), nfc: z.string(), qr: z.string(), extra: z.string().nullable() }),
  logo: z.string(),
  referencias_usadas: z.array(z.number()),
  por_que: z.string(),
});
export type Concepto = z.infer<typeof EsquemaConcepto>;
const EsquemaConceptos = z.object({ conceptos: z.array(EsquemaConcepto) });

async function sistema(rubro: string) {
  return `${SISTEMA_FABRICA}

Sos el director creativo. Proponé 3 ideas de placa para este comercio, bien distintas entre sí, donde el círculo NFC sea el protagonista.

Cómo pensar cada idea:
- El círculo NFC (de 25 a 32 mm de diámetro, en una placa de 100 × 150 mm) es el corazón del dibujo: se convierte en un objeto del rubro, o algo cae o chorrea sobre él desde arriba, o algo lo rodea. Nunca un círculo con un ícono adentro.
- Tiene que notarse que ahí se apoya el celular: ondas de pago sin contacto integradas al dibujo y una frase corta (por ejemplo «Acercá tu celular acá»).
- El logo va tal cual es: no se redibuja ni se recolorea. Decí dónde va, de qué tamaño y qué tiene detrás.
- El QR es un cuadrado blanco de 20 mm donde se pega el sticker: tiene que tener su lugar, sin pisar el dibujo, con una frase tipo «¿Sin NFC? Escaneá el QR».
- Textos en español rioplatense, cortos y cálidos: la placa se lee en 3 segundos. Ortografía y tildes perfectas.
- Que se pueda dibujar en SVG como ilustración plana o semiplana: formas limpias, máximo 5 colores más blanco y negro, buen contraste para imprimir. Nada de fotos ni texturas.
- Las tres ideas distintas de verdad: distinto recurso para el círculo, distinta composición y distinta paleta (siempre compatible con el logo).
- Usá las referencias como punto de partida y transformalas: nunca copies una ilustración.
- En "composicion" describí la placa de arriba hacia abajo con posiciones aproximadas en mm, para que el ilustrador la pueda dibujar sin dudas.

Tipografías disponibles (usá solo estas, con el nombre exacto):
${textoFuentesParaPrompt()}

${await textoPreferencias(rubro)}`;
}

/** Ideas: tres conceptos distintos con el círculo NFC como protagonista. */
export const conceptos: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const { feedback } = entrada<{ feedback: string | null }>(ctx.paso.entrada);

  const [anteriores, elegidosOtros, inspiracion, fotos, logo] = await Promise.all([
    db().from('fab_conceptos').select('tanda, titulo, idea, patron').eq('pedido_id', pedido.id).order('tanda').order('indice'),
    db().from('fab_conceptos').select('titulo, idea').eq('elegido', true).neq('pedido_id', pedido.id).order('created_at', { ascending: false }).limit(8),
    db().from('fab_inspiracion').select('*').eq('pedido_id', pedido.id).not('imagen_path', 'is', null).order('created_at').limit(6),
    db().from('fab_archivos').select('path').eq('comercio_id', comercio.id).eq('tipo', 'foto_local').order('created_at').limit(2),
    logoDelComercio(comercio),
  ]);
  const previas = anteriores.data ?? [];
  const tanda = previas.reduce((m, c) => Math.max(m, c.tanda), 0) + 1;

  const contenido: BetaContentBlockParam[] = [
    texto(`${fichaComercio(comercio, pedido)}\n\n${textoObjetivo(pedido.objetivo)}\n\nLo que sabemos del comercio:\n${textoInvestigacion(comercio.investigacion)}`),
    texto(`Este es el logo del comercio. ${textoLogo(logo.info)}`),
    imagen(logo.vista, 'image/png'),
  ];

  for (const [i, ref] of (inspiracion.data ?? []).entries()) {
    try {
      const jpg = await bajarArchivo(ref.imagen_path!);
      contenido.push(texto(`Referencia ${i + 1} — ${ref.titulo} (camino: ${ref.patron ?? 'otro'}). ${ref.nota ?? ''}`), imagen(jpg, 'image/jpeg'));
    } catch {
      // una referencia que no se puede leer no frena las ideas
    }
  }
  for (const f of fotos.data ?? []) {
    try {
      contenido.push(texto('Foto del local (de Google Maps):'), imagen(await bajarArchivo(f.path), 'image/jpeg'));
    } catch {
      // idem
    }
  }

  const pedidoFinal: string[] = [];
  if (previas.length) {
    pedidoFinal.push(`Ideas que ya se propusieron para esta placa (no las repitas):\n${previas.map((c) => `- ${c.titulo} (${c.patron}): ${c.idea}`).join('\n')}`);
  }
  if (feedback) pedidoFinal.push(`Tomi pidió ideas nuevas con este comentario, tenelo muy en cuenta: «${feedback}»`);
  if (elegidosOtros.data?.length) {
    pedidoFinal.push(`Ideas ya usadas en placas de otros comercios (cada placa es única, no las recicles):\n${elegidosOtros.data.map((c) => `- ${c.titulo}: ${c.idea}`).join('\n')}`);
  }
  pedidoFinal.push('Proponé exactamente 3 ideas. En "referencias_usadas" poné los números de las referencias en las que te apoyaste (o [] si ninguna).');
  contenido.push(texto(pedidoFinal.join('\n\n')));

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'ideas de placa',
    system: await sistema(comercio.rubro),
    contenido,
    esfuerzo: ctx.esfuerzo('high'),
    maxTokens: 16_000,
    formato: betaZodOutputFormat(EsquemaConceptos),
  });
  const lista = r.datos?.conceptos.slice(0, 3) ?? [];
  if (lista.length === 0) throw new Error('La IA no devolvió ideas.');

  const filas = lista.map((c, i) => {
    const datos: Concepto = { ...c, tipografia_titular: familiaDisponible(c.tipografia_titular), tipografia_textos: familiaDisponible(c.tipografia_textos) };
    return { pedido_id: pedido.id, tanda, indice: i + 1, titulo: c.titulo.slice(0, 200), patron: c.patron, idea: c.idea, datos: datos as unknown as Json };
  });
  const guardados = revisar(await db().from('fab_conceptos').insert(filas).select('id, titulo'), 'guardar ideas');

  return {
    salida: { tanda, conceptos: guardados.map((c) => c.id), costo: r.costo },
    resumen: `${guardados.length} ideas (tanda ${tanda}): ${guardados.map((c) => `«${c.titulo}»`).join(', ')}.`,
    siguientes: guardados.map((c) => ({ tipo: 'boceto' as const, entrada: { concepto_id: c.id, tanda }, max_intentos: 2 })),
    pedidoEtapa: 'bocetos',
  };
};
