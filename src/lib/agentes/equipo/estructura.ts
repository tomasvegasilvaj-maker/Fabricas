import sharp from 'sharp';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { imagen, llamarClaude, texto } from '../../ia/claude';
import { CIUDAD_PIE, TEXTO_QR_PLANTILLA } from '../../motor/flujo';
import type { Agente, ContextoPaso } from '../../motor/tipos';
import { chequearPlantilla, textoPie } from '../../placa/plantilla';
import { bajarArchivo } from '../../supabase';
import type { Json } from '../../tipos-db';
import { entrada, leerVersion, logoDelComercio, SISTEMA_FABRICA } from '../comun';
import { leerCorreccion, reglasDelAgente, textoCorreccion, textoReglas } from './comun';

const EsquemaMirada = z.object({
  logo_arriba_al_medio: z.boolean(),
  nfc_o_icono_al_centro: z.boolean(),
  qr_abajo_con_texto: z.boolean(),
  pie_con_rubro_y_ciudad: z.boolean(),
  ilustracion_sin_textos_ni_logos: z.boolean(),
  fallas: z.array(z.string()),
  regla_sugerida: z.string().nullable(),
});
export type Mirada = z.infer<typeof EsquemaMirada>;

export type ResultadoEstructura = {
  ok: boolean;
  /** Fallas de la plantilla en sí (código): no las puede arreglar Diseño. */
  fallas_plantilla: string[];
  /** Fallas de la imagen (las arregla Diseño en otra ronda). */
  fallas_imagen: string[];
  regla_sugerida: string | null;
  mirada: Mirada | null;
};

function sistema(reglas: string[]) {
  return `${SISTEMA_FABRICA}

Sos el agente Estructura del equipo de Pedrito. Verificás que la placa cumpla la PLANTILLA OBLIGATORIA, sin opinar de gustos:
1. Logo del comercio arriba al medio, entero y legible.
2. El círculo NFC (anillo punteado) al centro, con un objeto o ícono adentro que se lea como el protagonista y la píldora «ACERCÁ TU CELULAR ACÁ» debajo.
3. Abajo, la tarjeta blanca con el QR y el texto exacto «${TEXTO_QR_PLANTILLA}», legible.
4. Pie con el rubro y la ciudad «${CIUDAD_PIE}».
5. La ilustración de fondo NO tiene textos, letras, números, logos, QR ni marcos propios (la IA de imágenes a veces los inventa).

Te paso la placa armada y la imagen de fondo sola. Cada falla en una oración concreta que Diseño pueda corregir en la imagen («el objeto central quedó corrido a la izquierda», «aparecen letras en la parte de arriba»). Si hay fallas, en "regla_sugerida" proponé UNA regla general de una línea para que Diseño no lo repita; si no hay fallas, null.

${textoReglas(reglas)}`.trim();
}

export type Mirador = (ctx: ContextoPaso, op: { reglas: string[]; vista: Buffer; imagen: Buffer; imagenMime: string; pie: string; correccion: string }) => Promise<Mirada | null>;

/** Estructura: chequeo geométrico de la plantilla y, con `mirar`, una revisión visual de la placa armada. */
export function crearEstructura(mirar: Mirador): Agente {
  return async (ctx) => {
    const { comercio } = ctx;
    const e = entrada<{ version_id: string; ronda: number; correccion: unknown }>(ctx.paso.entrada);
    if (!e.version_id) throw new Error('A Estructura le falta la versión a verificar.');
    const ronda = Number(e.ronda ?? 1);
    const correccion = leerCorreccion(e.correccion);
    const reglas = await reglasDelAgente(ctx, 'estructura', correccion);

    const version = await leerVersion(e.version_id);
    const chequeoVersion = (version.chequeo ?? {}) as { imagen_path?: string; imagen_mime?: string };
    if (!version.preview_path || !chequeoVersion.imagen_path) throw new Error('La versión no tiene la imagen de Diseño o su vista con la plantilla.');
    const { info } = await logoDelComercio(comercio);
    const plantilla = chequearPlantilla(comercio.rubro, info);

    const [vista, imagenFondo] = await Promise.all([bajarArchivo(version.preview_path), bajarArchivo(chequeoVersion.imagen_path)]);
    const pie = textoPie(comercio.rubro);
    const mirada = await mirar(ctx, { reglas, vista, imagen: imagenFondo, imagenMime: chequeoVersion.imagen_mime ?? 'image/png', pie, correccion: textoCorreccion(correccion) });

    const fallasImagen = mirada
      ? [
          ...(mirada.logo_arriba_al_medio ? [] : ['El logo no se ve bien arriba al medio (la imagen lo tapa o le quita contraste).']),
          ...(mirada.nfc_o_icono_al_centro ? [] : ['No hay un objeto o ícono claro al centro del círculo NFC.']),
          ...(mirada.qr_abajo_con_texto ? [] : [`La tarjeta del QR o el texto «${TEXTO_QR_PLANTILLA}» no se leen bien.`]),
          ...(mirada.pie_con_rubro_y_ciudad ? [] : [`El pie no se lee como «${pie}».`]),
          ...(mirada.ilustracion_sin_textos_ni_logos ? [] : ['La ilustración trae textos, letras, logos o marcos propios.']),
          ...mirada.fallas,
        ]
      : [];
    const resultado: ResultadoEstructura = {
      ok: plantilla.ok && fallasImagen.length === 0,
      fallas_plantilla: plantilla.fallas,
      fallas_imagen: [...new Set(fallasImagen)],
      regla_sugerida: mirada?.regla_sugerida ?? null,
      mirada,
    };
    return {
      salida: { ...resultado, version_id: version.id, ronda, textos: plantilla.textos } as unknown as Json,
      resumen: resultado.ok
        ? `Estructura: la versión ${version.numero} cumple la plantilla (logo, NFC, QR con su texto y pie «${pie}»).`
        : `Estructura marcó ${resultado.fallas_plantilla.length + resultado.fallas_imagen.length} falla(s) en la versión ${version.numero}: ${[...resultado.fallas_plantilla, ...resultado.fallas_imagen].join(' ')}`,
      siguientes: [{ tipo: 'pedrito', entrada: { revisar: 'estructura', paso_id: ctx.paso.id, ronda } }],
      pedidoEtapa: 'estructura',
    };
  };
}

/**
 * La imagen de Gemini en 2K puede pasar los 5 MB que acepta Claude por imagen (y Claude igual la achica a ~1568 px):
 * se manda como JPG de 1500 px de alto como mucho.
 */
export async function imagenParaClaude(datos: Buffer): Promise<Buffer> {
  return sharp(datos).rotate().resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#FFFFFF' }).jpeg({ quality: 85 }).toBuffer();
}

export const estructuraEquipo = crearEstructura(async (ctx, op) => {
  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'verificación de la plantilla',
    system: sistema(op.reglas),
    contenido: [
      texto('Placa armada con la plantilla (el QR es de muestra):'),
      imagen(op.vista, 'image/png'),
      texto('Imagen de fondo sola, como la generó Diseño:'),
      imagen(await imagenParaClaude(op.imagen), 'image/jpeg'),
      texto(`El pie tiene que decir: «${op.pie}».\n\n${op.correccion}`.trim()),
    ],
    esfuerzo: ctx.esfuerzo('low'),
    maxTokens: 4_000,
    formato: betaZodOutputFormat(EsquemaMirada),
  });
  if (!r.datos) throw new Error('Estructura no devolvió el resultado de la verificación.');
  return r.datos;
});
