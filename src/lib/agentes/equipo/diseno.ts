import sharp from 'sharp';
import { ErrorFrenado, ErrorPaso } from '../../ia/claude';
import { costoImagenUsd, generarImagen, modeloImagen, saldoImagenes, saldoMinimoUsd, type ImagenBase } from '../../ia/gemini';
import { correccionesDelPedido, textoCorreccionesTomi } from '../../motor/ficha';
import { esperarRevisionDePedrito, mandarParteVersion } from '../../parte/version';
import type { Agente, ContextoPaso } from '../../motor/tipos';
import { componerPlaca } from '../../placa/plantilla';
import { bajarArchivo, db, registrarArchivo, revisar, subirArchivo } from '../../supabase';
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
- Absolutely no text, letters, numbers, logos, QR codes, borders or frames anywhere in the image.
- Do NOT draw rings, circles or halos around the hero, NFC symbols, radio or signal waves, arcs or frames: the print template draws the NFC ring and waves on top.`;

/** Al partir de una versión anterior: Gemini edita esa imagen en vez de generar otra de cero. */
export const INSTRUCCIONES_EDICION = `Edit the attached image (it is a previous version of this same sign). Keep its composition, style, colors and everything that is not mentioned below; change only what the corrections ask for. Return the full edited image in the same vertical 2:3 format.`;

export type EntradaDiseno = {
  concepto_id: string;
  indicaciones?: string | null;
  ronda?: number;
  correccion?: unknown;
  /** Compatibilidad con pasos encolados antes de la ficha: ahora las correcciones de Tomi salen de fab_correcciones_pedido. */
  comentario_tomi?: string | null;
  /** «Partí de la versión X»: Gemini recibe esa imagen para editarla. */
  base_version_id?: string | null;
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
  /** Todas las correcciones de Tomi del pedido, en orden (la ficha). */
  correccionesTomi?: { orden: number; texto: string }[];
  correccion?: Correccion | null;
  reglas: string[];
  /** true si Gemini recibe una versión anterior para editarla. */
  editar?: boolean;
}) {
  const base = completarPrompt(op.plantilla, {
    rubro: op.rubro,
    objeto_nfc: op.idea.objeto_nfc,
    escena: op.idea.escena,
    estilo: op.idea.estilo,
    paleta: op.idea.paleta.map((p) => `${p.hex} (${p.uso})`).join(', ') || 'harmonious colors that match the logo',
  });
  const partes = op.editar ? [INSTRUCCIONES_EDICION, base, INSTRUCCIONES_PLANTILLA] : [base, INSTRUCCIONES_PLANTILLA];
  if (op.indicaciones) partes.push(`Art direction from the team lead: ${op.indicaciones}`);
  const tomi = textoCorreccionesTomi(op.correccionesTomi ?? []);
  if (tomi) partes.push(`${tomi}\nThe client corrections are top priority.`);
  if (op.correccion?.texto) partes.push(`Fix from the previous round: ${op.correccion.texto}`);
  if (op.reglas.length) partes.push(`Always follow these learned rules:\n${op.reglas.map((r) => `- ${r}`).join('\n')}`);
  return partes.join('\n\n');
}

type ImagenDiseno = { datos: Buffer; mime: string; modelo: string; costo: number };
export type Generador = (ctx: ContextoPaso, prompt: string, idea: IdeaEquipo, base: ImagenBase | null) => Promise<ImagenDiseno>;

/** La imagen de fondo de una versión anterior, achicada para mandarla a editar. */
async function imagenDeVersion(versionId: string, pedidoId: string): Promise<{ base: ImagenBase; numero: number }> {
  const v = revisar(await db().from('fab_versiones').select('numero, chequeo, pedido_id').eq('id', versionId).single(), 'leer versión de partida');
  if (v.pedido_id !== pedidoId) throw new ErrorPaso('La versión de partida es de otro pedido.', false);
  const path = (v.chequeo as { imagen_path?: string } | null)?.imagen_path;
  if (!path) throw new ErrorPaso(`La versión ${v.numero} no tiene imagen de Diseño para editar.`, false);
  const datos = await sharp(await bajarArchivo(path)).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return { base: { datos, mime: 'image/jpeg' }, numero: v.numero };
}

/** Antes de pagar una imagen: saldo del AI Gateway y tope del pedido. Si no alcanza, se frena y se le pregunta a Tomi. */
async function controlarGasto(ctx: ContextoPaso) {
  if (ctx.pedido.simulado) return;
  const costo = costoImagenUsd(modeloImagen());
  const saldo = await saldoImagenes();
  if (saldo.ok === false || (saldo.saldo !== null && saldo.saldo < costo)) {
    throw new ErrorPaso(`No hay saldo para la imagen (${saldo.detalle}). Cargá crédito en Vercel → AI Gateway y tocá «Reintentar».`, false);
  }
  if (saldo.saldo !== null && saldo.saldo < saldoMinimoUsd()) {
    await ctx.registrar(`Aviso: queda poco saldo para imágenes (${saldo.detalle}).`, { nivel: 'aviso' });
  }
  const { data: p } = await db().from('fab_pedidos').select('gasto_usd, tope_usd').eq('id', ctx.pedido.id).single();
  const gasto = Number(p?.gasto_usd ?? ctx.pedido.gasto_usd);
  const tope = Number(p?.tope_usd ?? ctx.pedido.tope_usd);
  if (gasto + costo > tope) {
    const frenado = await db().rpc('fab_frenar_por_tope', { p_paso: ctx.paso.id, p_intento: ctx.paso.intento });
    if (frenado.error) throw new Error(`No se pudo frenar por tope: ${frenado.error.message}`);
    throw new ErrorFrenado(`Frenado por tope antes de la imagen: el pedido lleva US$ ${gasto.toFixed(2)} y la imagen cuesta ~US$ ${costo.toFixed(2)} (tope US$ ${tope.toFixed(2)}).`);
  }
}

/** Diseño: una sola imagen por ronda con el prompt que funcionó para el rubro, y la plantilla encima. */
export function crearDiseno(generar: Generador): Agente {
  return async (ctx) => {
    const { comercio, pedido } = ctx;
    const e = entrada<EntradaDiseno>(ctx.paso.entrada);
    if (!e.concepto_id) throw new Error('A Diseño le falta el concepto aprobado por Pedrito.');
    const ronda = Number(e.ronda ?? 1);
    // Primero: Pedrito tiene que haber revisado la imagen anterior (si no, se espera o se frena).
    await esperarRevisionDePedrito(ctx);
    await controlarGasto(ctx);
    const correccion = leerCorreccion(e.correccion);
    const reglas = await reglasDelAgente(ctx, 'diseno', correccion);

    const concepto = revisar(await db().from('fab_conceptos').select('*').eq('id', e.concepto_id).single(), 'leer concepto');
    const idea = datosIdea(concepto);
    const [{ rubro: rubroPrompt, plantilla }, logo, ficha] = await Promise.all([promptDelRubro(comercio.rubro), logoDelComercio(comercio), correccionesDelPedido(pedido.id)]);
    // Pasos viejos que traían el comentario suelto y todavía no está en la ficha.
    const correccionesTomi = ficha.length || !e.comentario_tomi ? ficha : [{ id: '', orden: 1, texto: e.comentario_tomi }];
    const partida = e.base_version_id ? await imagenDeVersion(e.base_version_id, pedido.id) : null;
    const prompt = armarPromptDiseno({
      plantilla,
      rubro: comercio.rubro,
      idea,
      indicaciones: e.indicaciones,
      correccionesTomi,
      correccion,
      reglas,
      editar: !!partida,
    });

    const img = await generar(ctx, prompt, idea, partida?.base ?? null);
    const numero = await proximoNumeroVersion(pedido.id);
    const base = `pedidos/${pedido.id}/diseno/v${numero}`;
    const imagenPath = `${base}-imagen.${EXTENSION[img.mime] ?? 'png'}`;
    await subirArchivo(imagenPath, img.datos, img.mime);
    await registrarArchivo({ pedidoId: pedido.id, comercioId: comercio.id, tipo: 'imagen_diseno', nombre: `Imagen de Diseño (ronda ${ronda})`, path: imagenPath, mime: img.mime, bytes: img.datos.length });

    const colores = { oscuro: idea.color_oscuro };
    const vista = await componerPlaca(img.datos, { rubro: comercio.rubro, ciudad: comercio.ciudad, logo: { png: logo.png, info: logo.info }, colores, modo: 'vista' }, 900);
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
          chequeo: {
            imagen_path: imagenPath,
            imagen_mime: img.mime,
            modelo: img.modelo,
            colores,
            ronda,
            prompt_rubro: rubroPrompt,
            prompt,
            correcciones_usadas: correccionesTomi.filter((c) => c.id).map((c) => c.id),
            parte_de_version: partida?.numero ?? null,
          } as Json,
        })
        .select('id')
        .single(),
      'guardar versión de Diseño',
    );

    // Parte de la versión a Pedrito, en el momento: prompt completo, costo del paso, n.º de pedido e imagen, la imagen.
    const { data: pasoActual } = await db().from('fab_pasos').select('costo_usd').eq('id', ctx.paso.id).single();
    await mandarParteVersion(ctx, {
      versionId: version.id,
      versionNumero: numero,
      ronda,
      trabajador: 'diseno',
      prompt,
      costoUsd: Number(pasoActual?.costo_usd ?? img.costo),
      correcciones: correccionesTomi.filter((c) => c.id),
      reglas,
      baseVersionNumero: partida?.numero ?? null,
      baseVersionId: e.base_version_id ?? null,
      imagen: img.datos,
      imagenPath,
      vista: vista.png,
      vistaPath,
    });

    return {
      salida: { version_id: version.id, numero, imagen_path: imagenPath, vista_path: vistaPath, prompt_rubro: rubroPrompt, modelo: img.modelo, costo: img.costo, ronda, parte_de_version: partida?.numero ?? null },
      resumen: `Diseño ${partida ? `editó la versión ${partida.numero} y generó` : 'generó'} la versión ${numero} (ronda ${ronda}, «${concepto.titulo}», prompt de ${rubroPrompt === '*' ? 'la base' : rubroPrompt}, ${correccionesTomi.length} corrección${correccionesTomi.length === 1 ? '' : 'es'} tuya${correccionesTomi.length === 1 ? '' : 's'}).`,
      siguientes: [{ tipo: 'pedrito', entrada: { revisar: 'diseno', paso_id: ctx.paso.id, ronda } }],
      pedidoEtapa: 'diseno',
    };
  };
}

export const disenoEquipo = crearDiseno(async (ctx, prompt, _idea, base) => generarImagen({ ctx: ctx.ia, prompt, base }));
