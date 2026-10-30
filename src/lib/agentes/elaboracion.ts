import { imagen, llamarClaude, texto } from '../ia/claude';
import type { Agente } from '../motor/tipos';
import { bajarArchivo, db } from '../supabase';
import type { ChequeoSvg } from '../placa/svg';
import { entrada, fichaComercio, leerVersion, logoDelComercio, proximoNumeroVersion, textoLogo, textoObjetivo } from './comun';
import type { Concepto } from './conceptos';
import { sistemaIlustrador, textoConcepto } from './diseno';
import { guardarVersion, textoChequeo } from './versiones';

export type Correccion = { gravedad: 'alta' | 'media' | 'baja'; descripcion: string; como_arreglar: string };

/** Elaboración: aplica tu comentario, las correcciones del revisor y los errores técnicos. */
export const elaboracion: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const e = entrada<{ version_id: string; comentario: string | null; correcciones: Correccion[] }>(ctx.paso.entrada);
  if (!e.version_id) throw new Error('A la elaboración le falta la versión de partida.');
  const version = await leerVersion(e.version_id);
  const { data: concepto } = version.concepto_id
    ? await db().from('fab_conceptos').select('datos').eq('id', version.concepto_id).single()
    : { data: null };
  const logo = await logoDelComercio(comercio);
  const vista = version.preview_path ? await bajarArchivo(version.preview_path) : null;

  const cambios: string[] = [];
  if (e.comentario) cambios.push(`Pedido de Tomi (es lo más importante, aplicalo tal cual): «${e.comentario}»`);
  if (e.correcciones?.length) {
    cambios.push(`Correcciones del revisor:\n${e.correcciones.map((c) => `- [${c.gravedad}] ${c.descripcion} → ${c.como_arreglar}`).join('\n')}`);
  }
  cambios.push(textoChequeo(version.chequeo as ChequeoSvg | null));
  if (!e.comentario && !e.correcciones?.length) cambios.push('Terminá la placa: puli alineaciones, espacios y textos sin cambiar la idea.');

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'elaboración',
    system: await sistemaIlustrador(comercio.rubro),
    contenido: [
      texto(`${concepto ? `Idea elegida:\n${textoConcepto(concepto.datos as unknown as Concepto)}\n\n` : ''}${fichaComercio(comercio, pedido)}\n${textoObjetivo(pedido.objetivo)}`),
      ...(vista ? [texto('Así se ve la versión actual (el logo ya está pegado y el QR es de muestra):'), imagen(vista, 'image/png')] : []),
      texto(`SVG de la versión actual:\n${version.svg}`),
      texto(`Logo del comercio (se pega solo en el logo-slot). ${textoLogo(logo.info)}`),
      imagen(logo.vista, 'image/png'),
      texto(`Cambios a hacer:\n\n${cambios.join('\n\n')}\n\nDevolvé el SVG completo con los cambios aplicados. Conservá lo que funciona y no cambies la idea salvo que te lo pidan.`),
    ],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 24_000,
  });

  const { version: nueva, chequeo } = await guardarVersion({
    respuesta: r.texto,
    pedidoId: pedido.id,
    comercio,
    conceptoId: version.concepto_id,
    origen: 'elaboracion',
    numero: await proximoNumeroVersion(pedido.id),
    notas: e.comentario ? `Con tu pedido: ${e.comentario}` : e.correcciones?.length ? 'Correcciones de la revisión' : 'Terminación',
  });

  return {
    salida: { version_id: nueva.id, errores: chequeo.errores.length, costo: r.costo, segundos: Math.round(r.segundos) },
    resumen: `Versión ${nueva.numero} lista${chequeo.errores.length ? ` (quedan ${chequeo.errores.length} errores técnicos)` : ''}.`,
    siguientes: [{ tipo: 'revision', entrada: { version_id: nueva.id, comentario: e.comentario ?? null } }],
    pedidoEtapa: 'revision',
  };
};
