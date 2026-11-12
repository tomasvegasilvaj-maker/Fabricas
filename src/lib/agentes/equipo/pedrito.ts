// Pedrito, el jefe del equipo: decide el orden (Ideas → Diseño → Estructura → tu confirmación → Producción),
// pasa los resultados de un agente al siguiente y da el visto bueno entre etapas. Cuando algo no está bien,
// le devuelve el trabajo al agente con una corrección y una regla de una línea que el agente guarda.
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { imagen, llamarClaude, texto } from '../../ia/claude';
import { destinoSugerido } from '../../motor/destino';
import type { AgenteEquipo, Agente, ContextoPaso, ResultadoPaso } from '../../motor/tipos';
import { bajarArchivo, db, revisar } from '../../supabase';
import type { ConceptoRow, Json } from '../../tipos-db';
import { entrada, fichaComercio, logoDelComercio, SISTEMA_FABRICA, textoObjetivo, textoPreferencias } from '../comun';
import { correccionesDelPedido } from '../../motor/ficha';
import { leerPaso, MAX_RONDAS, objeto, reglaDeUnaLinea, type Correccion } from './comun';
import type { ResultadoEstructura } from './estructura';
import type { PruebaEnlace, VerificacionQr } from './produccion';

export type DecisionIdeas = { aprobar: boolean; elegido: number; indicaciones: string; correccion: Correccion | null; motivo: string };
export type DecisionDiseno = { aprobar: boolean; correccion: Correccion | null; motivo: string; observaciones: string[] };

/** Lo que Pedrito decide mirando el trabajo (con IA en los pedidos reales, fijo en las pruebas). */
export type Juez = {
  ideas(ctx: ContextoPaso, op: { conceptos: ConceptoRow[]; ultima: boolean; ronda: number }): Promise<DecisionIdeas>;
  diseno(ctx: ContextoPaso, op: { vista: Buffer; concepto: ConceptoRow; indicaciones: string; comentarioTomi: string | null; ultima: boolean; ronda: number }): Promise<DecisionDiseno>;
};

/** Contexto que viaja entre Diseño, Estructura y las rondas de corrección. */
type ContextoDiseno = { concepto_id: string; indicaciones: string; comentario_tomi: string | null };

function contextoDe(valor: unknown): ContextoDiseno {
  const c = objeto(valor as Json);
  return {
    concepto_id: String(c.concepto_id ?? ''),
    indicaciones: typeof c.indicaciones === 'string' ? c.indicaciones : '',
    comentario_tomi: typeof c.comentario_tomi === 'string' ? c.comentario_tomi : null,
  };
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

async function previaConfirmacion(ctx: ContextoPaso, versionId: string, resumen: string, pendientes: string[], noCumple = false): Promise<ResultadoPaso> {
  const { comercio, pedido } = ctx;
  const placeId = (comercio.investigacion as { contacto?: { place_id?: string | null } } | null)?.contacto?.place_id ?? null;
  const sugerido = destinoSugerido(pedido.objetivo, comercio, placeId);
  const destino = pedido.destino_url ?? sugerido.url ?? (pedido.simulado ? 'https://example.com/' : '');
  const { data: qr } = await db().rpc('fab_asignar_qr', { p_pedido: pedido.id, p_url: destino || 'https://example.com', p_etiqueta: 'consulta', p_simular: true });
  return {
    salida: { version_id: versionId, pendientes, destino_sugerido: destino },
    resumen: noCumple
      ? `La versión NO cumple después de las rondas permitidas: Pedrito no la aprueba y te la devuelve para que decidas. Problemas: ${pendientes.join(' ')}`
      : `Pedrito dio el visto bueno a la versión y te la pasa para que la confirmes.${pendientes.length ? ` Pendientes: ${pendientes.join(' ')}` : ''}`,
    previa: {
      tipo: 'aprobar_final',
      titulo: noCumple ? `La placa de ${comercio.nombre} NO cumple: decidí vos` : `Confirmá la placa de ${comercio.nombre}`,
      detalle: noCumple
        ? 'Pedrito no la aprobó y ya no quedan rondas automáticas. Pedí cambios (podés partir de esta versión) o, si igual te sirve, aprobala vos.'
        : 'Pedrito ya le dio el visto bueno. Si te gusta, confirmá el link: Producción activa el QR del lote, arma el PDF A4 con dos placas y prueba que el link abra.',
      datos: {
        version_id: versionId,
        resumen,
        pendientes,
        no_cumple: noCumple,
        destino_sugerido: destino,
        destino_explicacion: pedido.destino_url ? 'Link que cargaste en el pedido.' : sugerido.explicacion,
        qr_siguiente: qr?.[0] ?? null,
      } as Json,
    },
    pedidoEstado: 'en_espera',
    pedidoEtapa: 'aprobacion',
  };
}

/** Pedrito devolvió el trabajo sin escribir qué cambiar: igual vuelve, con su motivo (nunca se aprueba por omisión). */
function sinCorreccion(motivo: string): Correccion {
  return { texto: motivo.trim() || 'Pedrito no lo aprobó: revisalo contra el concepto y la plantilla.', regla: '' };
}

function fallo(pasoId: string, tipo: AgenteEquipo, titulo: string, detalle: string, salida: Json): ResultadoPaso {
  return {
    salida,
    resumen: `Pedrito frenó la línea: ${detalle}`,
    previa: { tipo: 'fallo', titulo, detalle, datos: { paso_id: pasoId, tipo } },
    pedidoEstado: 'en_espera',
  };
}

export function crearPedrito(juez: Juez): Agente {
  return async (ctx) => {
    const e = entrada<{ revisar: string; paso_id: string; ronda: number }>(ctx.paso.entrada);
    const ronda = Number(e.ronda ?? 1);

    if (e.revisar === 'inicio') {
      return {
        salida: { orden: ['ideas', 'diseno', 'estructura', 'confirmacion', 'produccion'] },
        resumen: 'Pedrito arma el orden del equipo: Ideas, Diseño, Estructura, tu confirmación y Producción. Arranca Ideas.',
        siguientes: [{ tipo: 'ideas', entrada: { ronda: 1 } }],
        pedidoEtapa: 'ideas',
      };
    }

    if (!e.paso_id) throw new Error('A Pedrito le falta el paso a revisar.');
    const paso = await leerPaso(e.paso_id);
    const salida = objeto(paso.salida);
    const entradaPaso = objeto(paso.entrada);

    if (e.revisar === 'ideas') {
      const ids = lista(salida.conceptos);
      const conceptos = revisar(await db().from('fab_conceptos').select('*').in('id', ids).order('indice'), 'leer conceptos');
      if (conceptos.length === 0) throw new Error('Ideas no dejó conceptos para revisar.');
      const ultima = ronda >= MAX_RONDAS.ideas;
      const d = await juez.ideas(ctx, { conceptos, ultima, ronda });
      if (!d.aprobar && ultima) {
        // Nunca aprueba lo que no cumple «por ser la última»: se lo devuelve a Tomi.
        return fallo(
          paso.id,
          'ideas',
          'Pedrito no aprobó las ideas',
          `Después de ${ronda} rondas las ideas siguen sin cumplir: ${d.motivo}${d.correccion?.texto ? ` (${d.correccion.texto})` : ''} Con «Reintentar» Ideas propone otra tanda; si no, cancelá el pedido.`,
          { decision: 'devolver_a_tomi', motivo: d.motivo },
        );
      }
      if (!d.aprobar) {
        const correccion = d.correccion ?? sinCorreccion(d.motivo);
        return {
          salida: { decision: 'corregir', motivo: d.motivo, correccion },
          resumen: `Pedrito le devuelve el trabajo a Ideas: ${correccion.texto}${correccion.regla ? ` Regla nueva: «${correccion.regla}».` : ''}`,
          siguientes: [{ tipo: 'ideas', entrada: { ronda: ronda + 1, correccion } }],
          pedidoEtapa: 'ideas',
        };
      }
      const elegido = conceptos[d.elegido - 1] ?? conceptos[0];
      await db().from('fab_conceptos').update({ elegido: false }).eq('pedido_id', ctx.pedido.id);
      await db().from('fab_conceptos').update({ elegido: true }).eq('id', elegido.id);
      await db().from('fab_pedidos').update({ concepto_id: elegido.id, ronda: 0 }).eq('id', ctx.pedido.id);
      const contexto: ContextoDiseno = { concepto_id: elegido.id, indicaciones: d.indicaciones, comentario_tomi: null };
      return {
        salida: { decision: 'aprobar', concepto_id: elegido.id, motivo: d.motivo, indicaciones: d.indicaciones },
        resumen: `Pedrito aprobó «${elegido.titulo}» y se la pasa a Diseño. ${d.motivo}`,
        siguientes: [{ tipo: 'diseno', entrada: { ...contexto, ronda: 1 } }],
        pedidoEtapa: 'diseno',
      };
    }

    if (e.revisar === 'diseno') {
      const contexto = contextoDe(entradaPaso);
      const versionId = String(salida.version_id ?? '');
      const vistaPath = String(salida.vista_path ?? '');
      if (!versionId || !vistaPath) throw new Error('Diseño no dejó la versión a revisar.');
      const concepto = revisar(await db().from('fab_conceptos').select('*').eq('id', contexto.concepto_id).single(), 'leer concepto');
      const ultima = ronda >= MAX_RONDAS.diseno;
      const ficha = await correccionesDelPedido(ctx.pedido.id);
      const comentarioTomi = ficha.length ? ficha.map((c) => `${c.orden}. ${c.texto}`).join('\n') : contexto.comentario_tomi;
      const d = await juez.diseno(ctx, { vista: await bajarArchivo(vistaPath), concepto, indicaciones: contexto.indicaciones, comentarioTomi, ultima, ronda });
      if (!d.aprobar && ultima) {
        // Última ronda y no cumple: no se aprueba igual, se le devuelve a Tomi con los motivos.
        return previaConfirmacion(ctx, versionId, `No cumple tras ${ronda} rondas: ${d.motivo}`, [d.motivo, ...d.observaciones, ...(d.correccion?.texto ? [d.correccion.texto] : [])], true);
      }
      if (!d.aprobar) {
        const correccion = d.correccion ?? sinCorreccion(d.motivo);
        return {
          salida: { decision: 'corregir', motivo: d.motivo, correccion },
          resumen: `Pedrito le devuelve la imagen a Diseño (ronda ${ronda + 1}): ${correccion.texto}${correccion.regla ? ` Regla nueva: «${correccion.regla}».` : ''}`,
          siguientes: [{ tipo: 'diseno', entrada: { ...contexto, ronda: ronda + 1, correccion } }],
          pedidoEtapa: 'diseno',
        };
      }
      const observaciones = d.observaciones;
      return {
        salida: { decision: 'aprobar', version_id: versionId, motivo: d.motivo, observaciones },
        resumen: `Pedrito aprobó la imagen de la ronda ${ronda} y se la pasa a Estructura. ${d.motivo}`,
        siguientes: [{ tipo: 'estructura', entrada: { version_id: versionId, ronda, contexto: contexto as unknown as Json, observaciones } }],
        pedidoEtapa: 'estructura',
      };
    }

    if (e.revisar === 'estructura') {
      const r = salida as unknown as ResultadoEstructura & { version_id: string };
      const contexto = contextoDe(entradaPaso.contexto);
      const observaciones = lista(entradaPaso.observaciones);
      if (r.fallas_plantilla?.length) {
        return fallo(paso.id, 'estructura', 'La plantilla no cumple las medidas', r.fallas_plantilla.join(' '), { decision: 'frenar', fallas: r.fallas_plantilla });
      }
      const fallas = r.fallas_imagen ?? [];
      if (fallas.length && ronda < MAX_RONDAS.diseno) {
        const correccion: Correccion = {
          texto: `Estructura marcó: ${fallas.join(' ')}`,
          regla: reglaDeUnaLinea(r.regla_sugerida || `Respetá la plantilla: ${fallas[0]}`),
        };
        return {
          salida: { decision: 'corregir', correccion },
          resumen: `Pedrito le devuelve la imagen a Diseño por la estructura (ronda ${ronda + 1}). Regla nueva: «${correccion.regla}».`,
          siguientes: [{ tipo: 'diseno', entrada: { ...contexto, ronda: ronda + 1, correccion } }],
          pedidoEtapa: 'diseno',
        };
      }
      const pendientes = [...observaciones, ...fallas];
      // Si Estructura sigue marcando fallas en la última ronda, no se aprueba: decide Tomi.
      return previaConfirmacion(
        ctx,
        r.version_id,
        fallas.length ? 'No cumple la estructura después de las rondas permitidas.' : 'Cumple la plantilla: logo, NFC, QR con su texto y pie.',
        pendientes,
        fallas.length > 0,
      );
    }

    if (e.revisar === 'produccion') {
      const verificacion = salida.verificacion_qr as VerificacionQr | undefined;
      const enlace = salida.enlace as PruebaEnlace | undefined;
      const problemas = [verificacion?.ok ? null : (verificacion?.detalle ?? 'No se verificó el QR.'), enlace?.ok ? null : (enlace?.nota ?? 'No se probó el link.')].filter(
        (x): x is string => !!x,
      );
      if (problemas.length) {
        return fallo(paso.id, 'produccion', 'Producción: revisá el QR o el link', `${problemas.join(' ')} Los archivos ya están generados; con «Reintentar» Producción vuelve a verificar.`, {
          decision: 'frenar',
          problemas,
        });
      }
      return {
        salida: { decision: 'aprobar' },
        resumen: `Pedrito dio el visto bueno final: PDF listo, QR verificado y link probado. ${enlace?.nota ?? ''}`.trim(),
        pedidoEstado: 'listo',
        pedidoEtapa: 'listo',
      };
    }

    throw new Error(`Pedrito no sabe revisar «${e.revisar}».`);
  };
}

// ───────────────────────── Juez con IA ─────────────────────────

const EsquemaCorreccion = {
  correccion: z.string(),
  regla: z.string(),
  regla_solo_para_este_rubro: z.boolean(),
  motivo: z.string(),
};
const EsquemaIdeasPedrito = z.object({ decision: z.enum(['aprobar', 'corregir']), elegido: z.number(), indicaciones_para_diseno: z.string(), ...EsquemaCorreccion });
const EsquemaDisenoPedrito = z.object({ decision: z.enum(['aprobar', 'corregir']), observaciones: z.array(z.string()), ...EsquemaCorreccion });

async function reglasActuales(agente: AgenteEquipo | 'pedrito') {
  const { data } = await db().from('fab_reglas_agente').select('texto').eq('agente', agente).eq('activo', true).eq('prueba', false);
  return (data ?? []).map((r) => `- ${r.texto}`).join('\n') || '(todavía ninguna)';
}

async function sistemaPedrito(ctx: ContextoPaso, agente: AgenteEquipo, ultima: boolean) {
  return `${SISTEMA_FABRICA}

Sos Pedrito, el jefe del equipo de la fábrica. Tu equipo: Ideas (conceptos según el rubro), Diseño (la imagen con una IA de imágenes), Estructura (que se cumpla la plantilla) y Producción (PDF, QR y link). Ahora revisás el trabajo de ${agente === 'ideas' ? 'Ideas' : 'Diseño'} y das el visto bueno o lo devolvés.

Sos exigente pero práctico: devolvés solo si hay un problema real que se puede arreglar en otra ronda, no por gustos menores.
${ultima ? 'ESTA ES LA ÚLTIMA RONDA AUTOMÁTICA. Aprobá SOLO si cumple de verdad. Si no cumple, NO lo apruebes por ser la última: devolvé "corregir" con el motivo y se lo pasamos a Tomi para que decida.' : ''}

Si corregís:
- "correccion": qué cambiar en esta entrega, concreto y accionable.
- "regla": UNA regla general de una sola línea (máximo 200 caracteres) para que el agente no repita el error en ningún pedido. Escribila como instrucción («Que el objeto central…»). No repitas una regla que ya tiene.
- "regla_solo_para_este_rubro": true si la regla solo tiene sentido para el rubro ${ctx.comercio.rubro}.
Si aprobás, dejá "correccion" y "regla" vacías.

Reglas que ${agente === 'ideas' ? 'Ideas' : 'Diseño'} ya aprendió:
${await reglasActuales(agente)}

Tus propias reglas como jefe (las mandaste vos por el parte de la fábrica; cumplilas al revisar):
${await reglasActuales('pedrito')}

${await textoPreferencias(ctx.comercio.rubro)}`;
}

/** Si Pedrito devuelve el trabajo sin escribir la corrección, se usa su motivo (devolver nunca se vuelve aprobar). */
function correccionDe(d: { decision: string; correccion: string; regla: string; regla_solo_para_este_rubro: boolean; motivo: string }): Correccion | null {
  if (d.decision !== 'corregir') return null;
  const texto = d.correccion.trim() || d.motivo.trim();
  if (!texto) return null;
  return { texto, regla: reglaDeUnaLinea(d.regla), solo_rubro: d.regla_solo_para_este_rubro };
}

export const juezConIA: Juez = {
  async ideas(ctx, { conceptos, ultima, ronda }) {
    const logo = await logoDelComercio(ctx.comercio);
    const r = await llamarClaude({
      ctx: ctx.ia,
      etiqueta: 'visto bueno de Pedrito a las ideas',
      system: await sistemaPedrito(ctx, 'ideas', ultima),
      contenido: [
        texto(`${fichaComercio(ctx.comercio, ctx.pedido)}\n\n${textoObjetivo(ctx.pedido.objetivo)}`),
        texto('Logo del comercio:'),
        imagen(logo.vista, 'image/png'),
        texto(
          `Conceptos de Ideas (ronda ${ronda}):\n${conceptos
            .map((c, i) => `${i + 1}. ${c.titulo}: ${c.idea}\n   ${JSON.stringify(c.datos)}`)
            .join('\n')}\n\nSi aprobás, en "elegido" poné el número del mejor concepto y en "indicaciones_para_diseno" la dirección de arte para Diseño (en inglés, dos o tres oraciones).`,
        ),
      ],
      esfuerzo: ctx.esfuerzo('medium'),
      maxTokens: 4_000,
      formato: betaZodOutputFormat(EsquemaIdeasPedrito),
    });
    if (!r.datos) throw new Error('Pedrito no devolvió su decisión sobre las ideas.');
    const correccion = correccionDe(r.datos);
    return {
      aprobar: r.datos.decision === 'aprobar',
      elegido: Math.min(Math.max(Math.round(r.datos.elegido) || 1, 1), conceptos.length),
      indicaciones: r.datos.indicaciones_para_diseno,
      correccion,
      motivo: r.datos.motivo,
    };
  },
  async diseno(ctx, { vista, concepto, indicaciones, comentarioTomi, ultima, ronda }) {
    const r = await llamarClaude({
      ctx: ctx.ia,
      etiqueta: 'visto bueno de Pedrito a la imagen',
      system: await sistemaPedrito(ctx, 'diseno', ultima),
      contenido: [
        texto(`${fichaComercio(ctx.comercio, ctx.pedido)}\n\nConcepto aprobado: ${concepto.titulo}. ${concepto.idea}\nDirección de arte que le diste a Diseño: ${indicaciones || '(ninguna)'}${comentarioTomi ? `\nCambio que pidió Tomi: ${comentarioTomi}` : ''}`),
        texto(`Placa de la ronda ${ronda}, ya con la plantilla encima (el QR es de muestra). Mirá la imagen de fondo: que respete el concepto, que el objeto del centro se lea como protagonista, que sea prolija y que no tenga textos, letras, logos ni deformaciones.`),
        imagen(vista, 'image/png'),
      ],
      esfuerzo: ctx.esfuerzo('medium'),
      maxTokens: 4_000,
      formato: betaZodOutputFormat(EsquemaDisenoPedrito),
    });
    if (!r.datos) throw new Error('Pedrito no devolvió su decisión sobre la imagen.');
    const correccion = correccionDe(r.datos);
    return { aprobar: r.datos.decision === 'aprobar', correccion, motivo: r.datos.motivo, observaciones: r.datos.observaciones };
  },
};

export const pedrito = crearPedrito(juezConIA);
