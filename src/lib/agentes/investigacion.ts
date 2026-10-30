import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import sharp from 'sharp';
import { z } from 'zod';
import { env } from '../env';
import { extraerJson, llamarClaude } from '../ia/claude';
import { linkResenaDesdePlaceId } from '../motor/destino';
import type { Agente } from '../motor/tipos';
import { db, registrarArchivo, revisar, subirArchivo } from '../supabase';
import type { Json } from '../tipos-db';
import { fichaComercio, SISTEMA_FABRICA } from './comun';
import { bajarFotoLugar, buscarLugar, type LugarGoogle } from './google';

export const EsquemaInvestigacion = z.object({
  encontrado: z.boolean(),
  resumen: z.string(),
  estilo_visual: z.string().nullable(),
  colores_marca: z.array(z.string()),
  tono: z.string().nullable(),
  publico: z.string().nullable(),
  destacados: z.array(z.string()),
  diferenciales: z.array(z.string()),
  frases_clientes: z.array(z.string()),
  objetos_del_rubro: z.array(z.string()),
  contacto: z.object({
    direccion: z.string().nullable(),
    instagram: z.string().nullable(),
    whatsapp: z.string().nullable(),
    web: z.string().nullable(),
    google_maps_url: z.string().nullable(),
    place_id: z.string().nullable(),
    link_resenas: z.string().nullable(),
  }),
  google: z.object({ puntaje: z.number().nullable(), cantidad_resenas: z.number().nullable() }),
  fuentes: z.array(z.object({ titulo: z.string(), url: z.string() })),
});
export type Investigacion = z.infer<typeof EsquemaInvestigacion>;

const EJEMPLO_JSON = `{
  "encontrado": true,
  "resumen": "2 o 3 frases: qué es, dónde está, qué lo hace querible",
  "estilo_visual": "cómo se ve su marca y su local (colores, tipografías, fotos, ambiente)",
  "colores_marca": ["#1F3A5F", "#F2C14E"],
  "tono": "cómo escribe en redes (formal, canchero, cálido...)",
  "publico": "quiénes son sus clientes",
  "destacados": ["productos o servicios estrella"],
  "diferenciales": ["lo que lo hace distinto"],
  "frases_clientes": ["frases textuales de reseñas"],
  "objetos_del_rubro": ["objetos que podrían convertirse en el círculo NFC"],
  "contacto": { "direccion": null, "instagram": null, "whatsapp": null, "web": null, "google_maps_url": null, "place_id": null, "link_resenas": null },
  "google": { "puntaje": 4.8, "cantidad_resenas": 120 },
  "fuentes": [{ "titulo": "Instagram", "url": "https://..." }]
}`;

const SISTEMA = `${SISTEMA_FABRICA}

Sos el investigador. Antes de diseñar necesitamos conocer el comercio de verdad: cómo se ve, qué lo hace distinto y cómo le hablan sus clientes. Buscá en la web: la ficha de Google Maps (puntaje, reseñas, lo que más destacan), Instagram y otras redes (estética, colores, tono, productos estrella, usuario), web propia, notas o directorios.

Reglas:
- No inventes nada. Si un dato no aparece, va null o lista vacía. Si encontrás un comercio con el mismo nombre en otra ciudad, descartalo.
- Sé eficiente: pocas búsquedas bien elegidas. Si una página no carga (Instagram suele pedir login), seguí con otra fuente.
- En "objetos_del_rubro" pensá como diseñador: objetos concretos y redondos o que puedan rodear un círculo (una taza vista desde arriba, una pizza, un frasco de esmalte, una tijera abierta, una pelota).
- "frases_clientes" son citas textuales cortas de reseñas reales, si las hay.
- "link_resenas" solo si encontrás un link directo para dejar reseña (g.page/r/.../review o search.google.com/local/writereview?placeid=...).

Terminá tu respuesta con un único bloque \`\`\`json con exactamente estas claves:
${EJEMPLO_JSON}`;

function textoLugar(l: LugarGoogle) {
  return JSON.stringify(
    {
      nombre: l.nombre,
      direccion: l.direccion,
      puntaje: l.puntaje,
      cantidad_resenas: l.cantidadResenas,
      maps: l.mapsUrl,
      web: l.web,
      telefono: l.telefono,
      tipo: l.tipo,
      resumen: l.resumen,
      resenas: l.resenas,
      place_id: l.placeId,
    },
    null,
    1,
  );
}

async function guardarFotos(lugar: LugarGoogle, comercioId: string, pedidoId: string, clave: string) {
  let guardadas = 0;
  for (const [i, nombre] of lugar.fotos.slice(0, 3).entries()) {
    try {
      const foto = await bajarFotoLugar(nombre, clave);
      if (!foto) continue;
      const jpg = await sharp(foto).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      const path = `comercios/${comercioId}/fotos/google-${i + 1}.jpg`;
      await subirArchivo(path, jpg, 'image/jpeg');
      await registrarArchivo({ comercioId, pedidoId, tipo: 'foto_local', nombre: `Foto de Google ${i + 1}`, path, mime: 'image/jpeg', bytes: jpg.length });
      guardadas++;
    } catch (e) {
      console.error('Foto de Google:', e);
    }
  }
  return guardadas;
}

/** Investigación: Google Places (si hay clave) + búsqueda web con Claude. */
export const investigacion: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  let lugar: LugarGoogle | null = null;
  const clave = env.googlePlacesKey;
  if (clave) {
    try {
      lugar = await buscarLugar(`${comercio.nombre} ${comercio.rubro} ${comercio.direccion ?? ''} ${comercio.ciudad ?? 'Córdoba, Argentina'}`, clave);
    } catch (e) {
      await ctx.registrar(`Google Places no respondió: ${e instanceof Error ? e.message : e}`, { nivel: 'aviso' });
    }
  }

  const contenido = [
    `Investigá este comercio:\n${fichaComercio(comercio, pedido)}`,
    lugar ? `Datos confirmados por la API de Google Places (son confiables):\n${textoLugar(lugar)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'investigación',
    system: SISTEMA,
    contenido,
    herramientas: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 6,
        user_location: { type: 'approximate', city: comercio.ciudad ?? 'Córdoba', region: 'Córdoba', country: 'AR', timezone: 'America/Argentina/Cordoba' },
      },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, max_content_tokens: 8000 },
    ],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 12_000,
  });

  let datos = extraerJson(r.texto, EsquemaInvestigacion);
  if (!datos) {
    const ordenado = await llamarClaude({
      ctx: ctx.ia,
      etiqueta: 'ordenar la investigación',
      system: 'Pasá esta investigación al formato pedido. No agregues nada que no esté en el texto; lo que falte va null o lista vacía.',
      contenido: r.texto.slice(-30_000),
      esfuerzo: 'low',
      maxTokens: 6000,
      formato: betaZodOutputFormat(EsquemaInvestigacion),
    });
    datos = ordenado.datos;
  }
  if (!datos) throw new Error('No se pudo leer el resultado de la investigación.');

  // Lo que vino de Google Places manda sobre lo que encontró la búsqueda.
  if (lugar) {
    datos.contacto.place_id = lugar.placeId;
    datos.contacto.google_maps_url = lugar.mapsUrl ?? datos.contacto.google_maps_url;
    datos.contacto.direccion = lugar.direccion ?? datos.contacto.direccion;
    datos.google = { puntaje: lugar.puntaje, cantidad_resenas: lugar.cantidadResenas };
  }

  const fotos = lugar && clave ? await guardarFotos(lugar, comercio.id, pedido.id, clave) : 0;

  // Completa solo los datos del comercio que estaban vacíos.
  const c = datos.contacto;
  const completar: Record<string, string> = {};
  const siVacio = (campo: 'direccion' | 'instagram' | 'whatsapp' | 'web' | 'google_maps_url' | 'link_resenas', valor: string | null) => {
    if (valor && !comercio[campo]) completar[campo] = valor.slice(0, 1000);
  };
  siVacio('direccion', c.direccion);
  siVacio('instagram', c.instagram);
  siVacio('whatsapp', c.whatsapp);
  siVacio('web', c.web && /^https?:\/\//.test(c.web) ? c.web : null);
  siVacio('google_maps_url', c.google_maps_url && /^https?:\/\//.test(c.google_maps_url) ? c.google_maps_url : null);
  siVacio('link_resenas', (c.link_resenas && /^https?:\/\//.test(c.link_resenas) ? c.link_resenas : null) ?? linkResenaDesdePlaceId(c.place_id));

  revisar(
    await db()
      .from('fab_comercios')
      .update({ ...completar, investigacion: { ...datos, fecha: new Date().toISOString(), con_google_places: !!lugar } as unknown as Json })
      .eq('id', comercio.id)
      .select('id'),
    'guardar investigación',
  );

  return {
    salida: { investigacion: datos as unknown as Json, completados: Object.keys(completar), fotos, costo: r.costo },
    resumen: `${datos.encontrado ? 'Investigación lista' : 'Casi no hay datos públicos del comercio'}: ${datos.resumen.slice(0, 220)}${
      Object.keys(completar).length ? ` Se completaron: ${Object.keys(completar).join(', ')}.` : ''
    }${fotos ? ` ${fotos} fotos del local.` : ''}`,
    siguientes: [{ tipo: 'inspiracion' }],
    pedidoEtapa: 'inspiracion',
  };
};
