import { z } from 'zod';
import { extraerJson, llamarClaude } from '../ia/claude';
import type { Agente } from '../motor/tipos';
import { db, revisar, subirArchivo } from '../supabase';
import { fichaComercio, SISTEMA_FABRICA, textoInvestigacion } from './comun';
import { bajarImagen, imagenDePagina } from './web';

const EsquemaReferencias = z.object({
  referencias: z.array(
    z.object({
      titulo: z.string(),
      url_pagina: z.string(),
      url_imagen: z.string().nullable(),
      patron: z.enum(['objeto', 'chorreado', 'envoltura', 'otro']),
      nota: z.string(),
    }),
  ),
});

const MAX_IMAGENES = 8;

const SISTEMA = `${SISTEMA_FABRICA}

Sos el investigador visual. Buscás referencias reales (ilustraciones, packaging, carteles, posts de diseño, íconos, fotos de producto) que inspiren la placa de este comercio. No buscamos placas NFC genéricas: buscamos ideas para que el círculo NFC sea el protagonista.

Los caminos que nos interesan:
1. Objeto: el círculo se convierte en un objeto del rubro visto de frente o desde arriba (una pizza, una taza de café desde arriba, la tapa de un esmalte, una pelota, un plato, un disco, una rueda).
2. Chorreado o caída: algo cae o chorrea sobre el círculo desde arriba (esmalte, café, miel, pintura, chocolate, agua, arena).
3. Envoltura: algo rodea el círculo (vapor, hilo, hojas, humo, una cinta métrica, una enredadera, una toalla).
4. Otro recurso fuerte y propio del rubro, si es mejor.

Buscá en Pinterest, Behance, Dribbble, bancos de ilustraciones vectoriales, Instagram de estudios de diseño y Google Imágenes. Elegí entre 6 y 10 referencias variadas (al menos una por camino), que se puedan resolver como ilustración plana o semiplana en vector, con paleta compatible con el comercio. Preferí páginas con una imagen principal clara.

Para cada referencia: la URL de la página, la URL directa de la imagen si la viste (jpg, png o webp) o null, el camino y una nota de una línea con qué tomar (forma, gesto, composición, paleta), para inspirarse y nunca para copiar.

Terminá con un único bloque \`\`\`json: {"referencias":[{"titulo":"...","url_pagina":"https://...","url_imagen":"https://...","patron":"objeto","nota":"..."}]}`;

/** Inspiración: Claude busca referencias y el código baja las imágenes para mostrárselas a las ideas. */
export const inspiracion: Agente = async (ctx) => {
  const { comercio, pedido } = ctx;
  const r = await llamarClaude({
    ctx: ctx.ia,
    etiqueta: 'búsqueda de inspiración',
    system: SISTEMA,
    contenido: `${fichaComercio(comercio, pedido)}\n\nLo que sabemos del comercio:\n${textoInvestigacion(comercio.investigacion)}`,
    herramientas: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4, max_content_tokens: 6000 },
    ],
    esfuerzo: ctx.esfuerzo('medium'),
    maxTokens: 10_000,
  });
  const referencias = extraerJson(r.texto, EsquemaReferencias)?.referencias ?? [];

  // Se descartan las referencias de corridas anteriores de este pedido (por ejemplo, si se reintentó).
  await db().from('fab_inspiracion').delete().eq('pedido_id', pedido.id);

  let conImagen = 0;
  const filas = [];
  for (const [i, ref] of referencias.slice(0, 12).entries()) {
    let imagen: Buffer | null = null;
    let urlImagen = ref.url_imagen;
    if (conImagen < MAX_IMAGENES) {
      if (urlImagen) imagen = await bajarImagen(urlImagen);
      if (!imagen) {
        const og = await imagenDePagina(ref.url_pagina).catch(() => null);
        if (og) {
          imagen = await bajarImagen(og);
          if (imagen) urlImagen = og;
        }
      }
    }
    let imagenPath: string | null = null;
    if (imagen) {
      imagenPath = `pedidos/${pedido.id}/inspiracion/${i + 1}.jpg`;
      await subirArchivo(imagenPath, imagen, 'image/jpeg');
      conImagen++;
    }
    filas.push({
      pedido_id: pedido.id,
      titulo: ref.titulo.slice(0, 300),
      url_pagina: ref.url_pagina.slice(0, 2000),
      url_imagen: urlImagen?.slice(0, 2000) ?? null,
      imagen_path: imagenPath,
      patron: ref.patron,
      nota: ref.nota.slice(0, 1000),
    });
  }
  if (filas.length) revisar(await db().from('fab_inspiracion').insert(filas).select('id'), 'guardar inspiración');

  return {
    salida: { referencias: filas.length, con_imagen: conImagen, costo: r.costo },
    resumen: filas.length
      ? `${filas.length} referencias encontradas (${conImagen} con imagen): ${filas.map((f) => f.titulo).slice(0, 4).join(' · ')}.`
      : 'No se encontraron referencias usables; las ideas salen de la investigación y del rubro.',
    siguientes: [{ tipo: 'conceptos', entrada: {} }],
    pedidoEtapa: 'conceptos',
  };
};
