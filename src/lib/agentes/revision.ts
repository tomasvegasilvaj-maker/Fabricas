import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { imagen, llamarClaude, texto } from '../ia/claude';
import { destinoSugerido } from '../motor/destino';
import type { Agente, ContextoPaso, ResultadoPaso } from '../motor/tipos';
import type { ChequeoSvg } from '../placa/svg';
import { bajarArchivo, db } from '../supabase';
import type { ComercioRow, Json, PedidoRow, VersionRow } from '../tipos-db';
import { entrada, fichaComercio, leerVersion, SISTEMA_FABRICA, textoObjetivo, textoPreferencias } from './comun';
import type { Concepto } from './conceptos';
import { textoConcepto } from './diseno';
import type { Correccion } from './elaboracion';
import { textoChequeo } from './versiones';

export const MAX_RONDAS = 3;

export const EsquemaRevision = z.object({
  puntajes: z.object({
    nfc_protagonista: z.number(),
    se_entiende_nfc: z.number(),
    legibilidad: z.number(),
    marca: z.number(),
    composicion: z.number(),
    originalidad: z.number(),
    imprenta: z.number(),
  }),
  problemas: z.array(z.object({ gravedad: z.enum(['alta', 'media', 'baja']), descripcion: z.string(), como_arreglar: z.string() })),
  pedido_cumplido: z.boolean().nullable(),
  veredicto: z.enum(['aprobada', 'corregir']),
  resumen: z.string(),
});
export type Revision = z.infer<typeof EsquemaRevision>;

async function sistema(rubro: string) {
  return `${SISTEMA_FABRICA}

Sos el revisor de calidad. Mirás la placa como la va a ver un cliente en el mostrador y como la va a imprimir una imprenta. Sos exigente pero justo: aprobás si está lista para imprimir y entregar, aunque se pueda pulir algún detalle menor.

Puntajes de 1 a 5:
- nfc_protagonista: el arte del círculo NFC es el centro de la placa, es del rubro y es original; no es un círculo genérico con un ícono.
- se_entiende_nfc: se entiende dónde apoyar el celular (ondas de pago sin contacto + frase).
- legibilidad: textos legibles a un metro, buen contraste, nada superpuesto ni cortado, ortografía y tildes correctas, español rioplatense.
- marca: el logo se ve bien, con aire, sin recortes raros; la paleta acompaña al logo.
- composicion: jerarquía clara, aire, equilibrio, nada amontonado.
- originalidad: no parece una plantilla; tiene una idea propia del comercio.
- imprenta: nada importante a menos de 4 mm del borde, el cuadrado del QR limpio y despejado, colores que se imprimen bien.

El QR que ves es de muestra: en la placa real va un sticker con otro código en ese mismo cuadrado blanco. El logo ya está pegado: si se ve mal es por el lugar o el fondo que le dejaron, no por el logo en sí.

Cada problema con gravedad (alta: hay que arreglarlo sí o sí; media: conviene; baja: detalle) y una instrucción concreta para el ilustrador ("subí el titular 4 mm", "cambiá el texto blanco por #3B2314").
Si Tomi pidió un cambio, decí en "pedido_cumplido" si se aplicó (null si no pidió nada).
Veredicto «aprobada» solo si no hay problemas de gravedad alta, ningún puntaje es menor a 3 y el pedido de Tomi (si hubo) se cumplió.

Romper cualquiera de estas reglas es un problema de gravedad alta:
${await textoPreferencias(rubro)}`;
}

async function proximoQr(pedidoId: string, destino: string | null) {
  const { data } = await db().rpc('fab_asignar_qr', { p_pedido: pedidoId, p_url: destino ?? 'https://example.com', p_etiqueta: 'consulta', p_simular: true });
  return data?.[0] ?? null;
}

function previaAprobacion(comercio: ComercioRow, pedido: PedidoRow, datos: Record<string, Json>) {
  return {
    tipo: 'aprobar_final' as const,
    titulo: `Aprobá la placa de ${comercio.nombre}`,
    detalle: 'Si te gusta, confirmá el link y se activa el QR del lote y se arman los archivos para imprimir.',
    datos,
  };
}

/** Revisión: control de calidad con criterios fijos. Pide correcciones (hasta 3 rondas) o te la pasa para aprobar. */
export const revision: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const e = entrada<{ version_id: string; comentario: string | null }>(ctx.paso.entrada);
  const version = await leerVersion(e.version_id!);
  const chequeo = version.chequeo as ChequeoSvg | null;
  const { data: concepto } = version.concepto_id
    ? await db().from('fab_conceptos').select('datos').eq('id', version.concepto_id).single()
    : { data: null };
  if (!version.preview_path) throw new Error('La versión no tiene vista previa.');
  const vista = await bajarArchivo(version.preview_path);

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'revisión',
    system: await sistema(comercio.rubro),
    contenido: [
      texto(`${fichaComercio(comercio, pedido)}\n${textoObjetivo(pedido.objetivo)}${concepto ? `\n\nIdea elegida:\n${textoConcepto(concepto.datos as unknown as Concepto)}` : ''}`),
      texto('Placa a revisar (106 × 156 mm con el sangrado de 3 mm de cada lado; el corte final es 100 × 150 mm):'),
      imagen(vista, 'image/png'),
      texto(`Chequeo automático del archivo:\n${textoChequeo(chequeo)}`),
      texto(e.comentario ? `Tomi había pedido: «${e.comentario}»` : 'Tomi no pidió cambios puntuales.'),
    ],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 8000,
    formato: betaZodOutputFormat(EsquemaRevision),
  });
  if (!r.datos) throw new Error('No se pudo leer la revisión.');
  return cerrarRevision(ctx, version, r.datos, r.costo, e.comentario ?? null);
};

/** Decide con la revisión: otra ronda de elaboración o la Previa para que apruebes. */
export async function cerrarRevision(ctx: ContextoPaso, version: VersionRow, rev: Revision, costo: number, comentario: string | null): Promise<ResultadoPaso> {
  const { comercio, pedido } = ctx;
  const chequeo = version.chequeo as ChequeoSvg | null;
  await db().from('fab_versiones').update({ revision: rev as unknown as Json }).eq('id', version.id);
  const ronda = pedido.ronda + 1;
  await db().from('fab_pedidos').update({ ronda }).eq('id', pedido.id);

  const minimo = Math.min(...Object.values(rev.puntajes));
  const graves = rev.problemas.filter((p) => p.gravedad === 'alta').length + (chequeo?.errores.length ?? 0);
  const corregir = rev.veredicto === 'corregir' || graves > 0 || minimo < 3 || rev.pedido_cumplido === false;

  if (corregir && ronda < MAX_RONDAS) {
    const correcciones: Correccion[] = rev.problemas.filter((p) => p.gravedad !== 'baja');
    return {
      salida: { revision: rev as unknown as Json, ronda, veredicto: 'corregir', costo },
      resumen: `Revisión ${ronda}: hay que corregir (${correcciones.length} puntos). ${rev.resumen}`,
      siguientes: [
        {
          tipo: 'elaboracion',
          entrada: { version_id: version.id, correcciones: correcciones as unknown as Json, comentario: rev.pedido_cumplido === false ? comentario : null },
        },
      ],
      pedidoEtapa: 'elaboracion',
    };
  }

  const placeId = (comercio.investigacion as { contacto?: { place_id?: string | null } } | null)?.contacto?.place_id ?? null;
  const sugerido = pedido.destino_url ? { url: pedido.destino_url, explicacion: 'Link que cargaste en el pedido.' } : destinoSugerido(pedido.objetivo, comercio, placeId);
  const qr = await proximoQr(pedido.id, sugerido.url);
  const pendientes = corregir ? rev.problemas.filter((p) => p.gravedad !== 'baja').map((p) => p.descripcion) : [];

  return {
    salida: { revision: rev as unknown as Json, ronda, veredicto: corregir ? 'pasa_con_pendientes' : 'aprobada', costo },
    resumen: corregir
      ? `Revisión ${ronda}: se llegó al máximo de rondas; te la paso igual con ${pendientes.length} pendientes.`
      : `Revisión ${ronda}: aprobada (mínimo ${minimo}/5). ${rev.resumen}`,
    previa: previaAprobacion(comercio, pedido, {
      version_id: version.id,
      destino_sugerido: sugerido.url,
      destino_explicacion: sugerido.explicacion,
      qr_siguiente: qr ? { n: qr.n, codigo: qr.codigo, lote: qr.lote } : null,
      resumen: rev.resumen,
      puntajes: rev.puntajes,
      pendientes,
    }),
    pedidoEstado: 'en_espera',
    pedidoEtapa: 'aprobacion',
  };
}
