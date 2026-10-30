import { imagen, llamarClaude, texto } from '../ia/claude';
import type { Agente, ResultadoPaso } from '../motor/tipos';
import type { ChequeoSvg } from '../placa/svg';
import type { ComercioRow, ConceptoRow, VersionRow } from '../tipos-db';
import { db, revisar } from '../supabase';
import { entrada, fichaComercio, logoDelComercio, textoLogo, textoObjetivo } from './comun';
import type { Concepto } from './conceptos';
import { medidaLogoSugerida, sistemaIlustrador, textoConcepto } from './diseno';
import { guardarVersion } from './versiones';

/** Boceto: un SVG por idea. Corre en paralelo con los otros dos; el último deja la Previa para elegir. */
export const boceto: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const { concepto_id: conceptoId, tanda } = entrada<{ concepto_id: string; tanda: number }>(ctx.paso.entrada);
  if (!conceptoId) throw new Error('Al boceto le falta la idea.');
  const concepto = revisar(await db().from('fab_conceptos').select('*').eq('id', conceptoId).single(), 'leer idea');
  const datos = concepto.datos as unknown as Concepto;
  const logo = await logoDelComercio(comercio);

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: `boceto ${concepto.indice}`,
    system: await sistemaIlustrador(comercio.rubro),
    contenido: [
      texto(`Idea a dibujar:\n${textoConcepto(datos)}\n\n${fichaComercio(comercio, pedido)}\n${textoObjetivo(pedido.objetivo)}`),
      texto(
        `Este es el logo. Se pega solo en el logo-slot: vos no lo dibujes. ${textoLogo(logo.info)} El logo-slot tiene que tener esa proporción, por ejemplo ${medidaLogoSugerida(logo.info)}.`,
      ),
      imagen(logo.vista, 'image/png'),
    ],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 24_000,
  });

  const { version, chequeo } = await guardarVersion({
    respuesta: r.texto,
    pedidoId: pedido.id,
    comercio,
    conceptoId,
    origen: 'boceto',
    numero: concepto.indice,
    notas: `Boceto de «${concepto.titulo}»`,
  });

  return resultadoBoceto(comercio, concepto, version, chequeo, tanda ?? concepto.tanda, { costo: r.costo, segundos: Math.round(r.segundos) });
};

export function resultadoBoceto(
  comercio: ComercioRow,
  concepto: ConceptoRow,
  version: VersionRow,
  chequeo: ChequeoSvg,
  tanda: number,
  extra: Record<string, number> = {},
): ResultadoPaso {
  return {
    salida: { version_id: version.id, errores: chequeo.errores.length, avisos: chequeo.avisos.length, ...extra },
    resumen: `Boceto ${concepto.indice} listo («${concepto.titulo}»)${chequeo.errores.length ? ` con ${chequeo.errores.length} errores técnicos para corregir` : ''}.`,
    esperarTipos: ['boceto'],
    previa: {
      tipo: 'elegir_concepto',
      titulo: `Elegí la idea para ${comercio.nombre}`,
      detalle: 'Mirá los bocetos y elegí uno. Si querés, dejá un comentario y se aplica antes de la revisión.',
      datos: { tanda },
    },
    pedidoEstado: 'en_espera',
    pedidoEtapa: 'eleccion',
  };
}
