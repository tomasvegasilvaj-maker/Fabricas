import { generarImagen } from '../../ia/gemini';
import type { Agente, ContextoPaso } from '../../motor/tipos';
import { componerPlaca } from '../../placa/plantilla';
import { db, registrarArchivo, revisar, subirArchivo } from '../../supabase';
import type { ConceptoRow, Json } from '../../tipos-db';
import { entrada, logoDelComercio, proximoNumeroVersion } from '../comun';
import { completarPrompt, leerCorreccion, promptDelRubro, reglasDelAgente, type Correccion } from './comun';
import type { IdeaEquipo } from './ideas';

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Zonas que la imagen tiene que dejar tranquilas para que la plantilla se apoye encima. */
export const INSTRUCCIONES_PLANTILLA = `Layout rules (mandatory, a fixed print template is placed on top of this image):
- Top 20% of the image: calm, simple background with no important details (the shop logo goes there on a small panel).
- Exact center of the image: the hero, fully visible, round in silhouette, about 30% of the image width (an NFC tag sits behind it).
- Just below the hero, around 62% of the height: keep a calm horizontal strip (a pill label goes there).
- Bottom 35% of the image: calm background with no important details (a white QR card and a footer band cover it).
- Absolutely no text, letters, numbers, logos, QR codes, borders or frames anywhere in the image.`;

export type EntradaDiseno = {
  concepto_id: string;
  indicaciones?: string | null;
  ronda?: number;
  correccion?: unknown;
  comentario_tomi?: string | null;
};

export function datosIdea(concepto: ConceptoRow): IdeaEquipo {
  const d = (concepto.datos ?? {}) as Partial<IdeaEquipo>;
  return {
    titulo: concepto.titulo,
    idea: d.idea ?? concepto.idea,
    objeto_nfc: d.objeto_nfc ?? concepto.idea,
    escena: d.escena ?? '',
    estilo: d.estilo ?? 'clean modern illustration',
    paleta: d.paleta ?? [],
    color_oscuro: d.color_oscuro ?? '#141414',
    por_que: d.por_que ?? '',
  };
}

/** El prompt final: el del rubro con la idea, la plantilla, las reglas aprendidas y lo que hay que corregir. */
export function armarPromptDiseno(op: {
  plantilla: string;
  rubro: string;
  idea: IdeaEquipo;
  indicaciones?: string | null;
  comentarioTomi?: string | null;
  correccion?: Correccion | null;
  reglas: string[];
}) {
  const base = completarPrompt(op.plantilla, {
    rubro: op.rubro,
    objeto_nfc: op.idea.objeto_nfc,
    escena: op.idea.escena,
    estilo: op.idea.estilo,
    paleta: op.idea.paleta.map((p) => `${p.hex} (${p.uso})`).join(', ') || 'harmonious colors that match the logo',
  });
  const partes = [base, INSTRUCCIONES_PLANTILLA];
  if (op.indicaciones) partes.push(`Art direction from the team lead: ${op.indicaciones}`);
  if (op.comentarioTomi) partes.push(`Change requested by the client (top priority): ${op.comentarioTomi}`);
  if (op.correccion?.texto) partes.push(`Fix from the previous round: ${op.correccion.texto}`);
  if (op.reglas.length) partes.push(`Always follow these learned rules:\n${op.reglas.map((r) => `- ${r}`).join('\n')}`);
  return partes.join('\n\n');
}

type ImagenDiseno = { datos: Buffer; mime: string; modelo: string; costo: number };
export type Generador = (ctx: ContextoPaso, prompt: string, idea: IdeaEquipo) => Promise<ImagenDiseno>;

/** Diseño: una sola imagen por ronda con el prompt que funcionó para el rubro, y la plantilla encima. */
export function crearDiseno(generar: Generador): Agente {
  return async (ctx) => {
    const { comercio, pedido } = ctx;
    const e = entrada<EntradaDiseno>(ctx.paso.entrada);
    if (!e.concepto_id) throw new Error('A Diseño le falta el concepto aprobado por Pedrito.');
    const ronda = Number(e.ronda ?? 1);
    const correccion = leerCorreccion(e.correccion);
    const reglas = await reglasDelAgente(ctx, 'diseno', correccion);

    const concepto = revisar(await db().from('fab_conceptos').select('*').eq('id', e.concepto_id).single(), 'leer concepto');
    const idea = datosIdea(concepto);
    const [{ rubro: rubroPrompt, plantilla }, logo] = await Promise.all([promptDelRubro(comercio.rubro), logoDelComercio(comercio)]);
    const prompt = armarPromptDiseno({
      plantilla,
      rubro: comercio.rubro,
      idea,
      indicaciones: e.indicaciones,
      comentarioTomi: e.comentario_tomi,
      correccion,
      reglas,
    });

    const img = await generar(ctx, prompt, idea);
    const numero = await proximoNumeroVersion(pedido.id);
    const base = `pedidos/${pedido.id}/diseno/v${numero}`;
    const imagenPath = `${base}-imagen.${EXTENSION[img.mime] ?? 'png'}`;
    await subirArchivo(imagenPath, img.datos, img.mime);
    await registrarArchivo({ pedidoId: pedido.id, comercioId: comercio.id, tipo: 'imagen_diseno', nombre: `Imagen de Diseño (ronda ${ronda})`, path: imagenPath, mime: img.mime, bytes: img.datos.length });

    const colores = { oscuro: idea.color_oscuro };
    const vista = await componerPlaca(img.datos, { rubro: comercio.rubro, logo: { png: logo.png, info: logo.info }, colores, modo: 'vista' }, 900);
    const vistaPath = `${base}-vista.png`;
    await subirArchivo(vistaPath, vista.png, 'image/png');
    await registrarArchivo({ pedidoId: pedido.id, comercioId: comercio.id, tipo: 'vista', nombre: `Placa con plantilla (versión ${numero})`, path: vistaPath, mime: 'image/png', bytes: vista.png.length });

    const version = revisar(
      await db()
        .from('fab_versiones')
        .insert({
          pedido_id: pedido.id,
          concepto_id: concepto.id,
          numero,
          origen: 'diseno',
          svg: '',
          preview_path: vistaPath,
          notas: prompt.slice(0, 4000),
          chequeo: { imagen_path: imagenPath, imagen_mime: img.mime, modelo: img.modelo, colores, ronda, prompt_rubro: rubroPrompt } as Json,
        })
        .select('id')
        .single(),
      'guardar versión de Diseño',
    );

    return {
      salida: { version_id: version.id, numero, imagen_path: imagenPath, vista_path: vistaPath, prompt_rubro: rubroPrompt, modelo: img.modelo, costo: img.costo, ronda },
      resumen: `Diseño generó la versión ${numero} (ronda ${ronda}, «${concepto.titulo}», prompt de ${rubroPrompt === '*' ? 'la base' : rubroPrompt}).`,
      siguientes: [{ tipo: 'pedrito', entrada: { revisar: 'diseno', paso_id: ctx.paso.id, ronda } }],
      pedidoEtapa: 'diseno',
    };
  };
}

export const disenoEquipo = crearDiseno(async (ctx, prompt) => generarImagen({ ctx: ctx.ia, prompt }));
