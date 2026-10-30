import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { familiaDisponible } from './fuentes';
import { IDS, PLACA } from './especificacion';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type Rect = { x: number; y: number; ancho: number; alto: number };
export type Circulo = { cx: number; cy: number; r: number };

export type ChequeoSvg = {
  errores: string[];
  avisos: string[];
  slots: { logo?: Rect; qr?: Rect; nfc?: Circulo };
  bytes: number;
  fuentes: string[];
};

// Lo mínimo que el DOM de xmldom expone y usamos acá.
type Nodo = {
  nodeType: number;
  nodeName: string;
  tagName?: string;
  parentNode: Nodo | null;
  childNodes: { length: number; item(i: number): Nodo | null; [i: number]: Nodo };
  attributes?: { length: number; item(i: number): { name: string; value: string } | null };
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  hasAttribute(n: string): boolean;
  removeChild(n: Nodo): Nodo;
  appendChild(n: Nodo): Nodo;
  insertBefore(n: Nodo, ref: Nodo | null): Nodo;
  replaceChild(n: Nodo, viejo: Nodo): Nodo;
  textContent: string | null;
  ownerDocument: { createElementNS(ns: string, nombre: string): Nodo };
};

const PERMITIDOS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter', 'use', 'symbol',
  'title', 'desc', 'style', 'feGaussianBlur', 'feOffset', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode',
  'feDropShadow', 'feColorMatrix', 'feBlend', 'feMorphology', 'feTurbulence', 'feDisplacementMap',
  'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feSpecularLighting', 'feDiffuseLighting',
  'fePointLight', 'feDistantLight', 'feSpotLight', 'feTile', 'feConvolveMatrix', 'marker',
]);

/** Saca el <svg>…</svg> de la respuesta del modelo (con o sin bloque de código). */
export function extraerSvg(texto: string): string | null {
  const inicio = texto.indexOf('<svg');
  const fin = texto.lastIndexOf('</svg>');
  if (inicio === -1 || fin === -1 || fin < inicio) return null;
  return texto.slice(inicio, fin + '</svg>'.length);
}

function parsear(svg: string): { doc: { documentElement: Nodo } | null; error: string | null } {
  let error: string | null = null;
  try {
    const doc = new DOMParser({
      onError: (nivel, mensaje) => {
        if (nivel !== 'warning' && !error) error = mensaje;
      },
    }).parseFromString(svg, 'image/svg+xml') as unknown as { documentElement: Nodo };
    return { doc, error };
  } catch (e) {
    return { doc: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function serializar(doc: { documentElement: Nodo }) {
  return new XMLSerializer().serializeToString(doc.documentElement as never);
}

function hijos(n: Nodo): Nodo[] {
  const lista: Nodo[] = [];
  for (let i = 0; i < n.childNodes.length; i++) {
    const h = n.childNodes.item(i);
    if (h) lista.push(h);
  }
  return lista;
}

function elementos(n: Nodo): Nodo[] {
  return hijos(n).filter((h) => h.nodeType === 1);
}

function nombreLocal(n: Nodo) {
  return (n.tagName ?? n.nodeName).replace(/^svg:/, '');
}

function atributos(n: Nodo): { name: string; value: string }[] {
  const lista: { name: string; value: string }[] = [];
  if (!n.attributes) return lista;
  for (let i = 0; i < n.attributes.length; i++) {
    const a = n.attributes.item(i);
    if (a) lista.push({ name: a.name, value: a.value });
  }
  return lista;
}

function numero(v: string | null): number | null {
  if (v === null || v.trim() === '' || v.includes('%')) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** true si todas las url(...) del valor apuntan adentro del mismo SVG (url(#id)). */
function urlsInternas(valor: string) {
  for (const m of valor.matchAll(/url\(([^)]*)\)/gi)) {
    if (!m[1].trim().replace(/^['"]/, '').startsWith('#')) return false;
  }
  return true;
}

/** resvg no entiende url('#id') con comillas: las sacamos. */
function sinComillasEnUrl(valor: string) {
  return valor.replace(/url\(\s*['"]\s*(#[^'"\s]+)\s*['"]\s*\)/gi, 'url($1)');
}

function limpiarCss(css: string) {
  return sinComillasEnUrl(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(([^)]*)\)/gi, (todo, dentro: string) => (dentro.trim().replace(/^['"]/, '').startsWith('#') ? todo : 'none'))
    .replace(/font-family\s*:\s*([^;}"]+)/gi, (_, valor: string) => `font-family:${citarFamilia(familiaDisponible(valor))}`);
}

function citarFamilia(f: string) {
  return f.includes(' ') ? `'${f}'` : f;
}

/** Limpia el SVG (fuera lo peligroso o no soportado), lo normaliza y revisa las reglas de la placa. */
export function limpiarYValidar(svgCrudo: string): { svg: string; chequeo: ChequeoSvg } {
  const chequeo: ChequeoSvg = { errores: [], avisos: [], slots: {}, bytes: 0, fuentes: [] };
  const { doc, error } = parsear(svgCrudo);
  if (!doc || error) {
    chequeo.errores.push(`El SVG no se puede leer como XML: ${error ?? 'vacío'}`);
    return { svg: '', chequeo };
  }
  const raiz = doc.documentElement;
  if (!raiz || nombreLocal(raiz) !== 'svg') {
    chequeo.errores.push('La raíz no es un <svg>.');
    return { svg: '', chequeo };
  }

  const viewBoxOriginal = (raiz.getAttribute('viewBox') ?? '').trim().replace(/[\s,]+/g, ' ');
  if (viewBoxOriginal && viewBoxOriginal !== PLACA.viewBox) {
    chequeo.errores.push(`El viewBox tiene que ser "${PLACA.viewBox}" (vino "${viewBoxOriginal}"): todo se mide en mm.`);
  }
  raiz.setAttribute('xmlns', SVG_NS);
  raiz.setAttribute('viewBox', PLACA.viewBox);
  raiz.setAttribute('width', '106mm');
  raiz.setAttribute('height', '156mm');

  const fuentes = new Set<string>();
  const sacados = new Set<string>();

  const recorrer = (n: Nodo) => {
    for (const h of hijos(n)) {
      if (h.nodeType === 8) {
        n.removeChild(h);
        continue;
      }
      if (h.nodeType !== 1) continue;
      const nombre = nombreLocal(h);
      if (!PERMITIDOS.has(nombre)) {
        sacados.add(nombre);
        n.removeChild(h);
        continue;
      }
      if (nombre === 'style') {
        h.textContent = limpiarCss(h.textContent ?? '');
        continue;
      }
      for (const a of atributos(h)) {
        const attr = a.name.toLowerCase();
        if (attr.startsWith('on')) h.removeAttribute(a.name);
        else if ((attr === 'href' || attr === 'xlink:href') && !a.value.trim().startsWith('#')) h.removeAttribute(a.name);
        else if (attr === 'style') h.setAttribute(a.name, limpiarCss(a.value));
        else if (attr === 'font-family') {
          const f = familiaDisponible(a.value);
          fuentes.add(f);
          h.setAttribute(a.name, citarFamilia(f));
        } else if (!urlsInternas(a.value)) h.removeAttribute(a.name);
        else if (/url\(\s*['"]/i.test(a.value)) h.setAttribute(a.name, sinComillasEnUrl(a.value));
      }
      const estilo = h.getAttribute('style');
      const enEstilo = estilo ? /font-family:([^;]+)/i.exec(estilo) : null;
      if (enEstilo) fuentes.add(familiaDisponible(enEstilo[1]));
      recorrer(h);
    }
  };
  recorrer(raiz);
  if (sacados.size > 0) chequeo.avisos.push(`Se sacaron elementos no permitidos: ${[...sacados].join(', ')}.`);
  chequeo.fuentes = [...fuentes];

  // Slots obligatorios
  const porId = new Map<string, Nodo[]>();
  const indexar = (n: Nodo) => {
    for (const h of elementos(n)) {
      const id = h.getAttribute('id');
      if (id) porId.set(id, [...(porId.get(id) ?? []), h]);
      indexar(h);
    }
  };
  indexar(raiz);

  const slot = (id: string, tag: 'rect' | 'circle'): Nodo | null => {
    const encontrados = porId.get(id) ?? [];
    if (encontrados.length === 0) {
      chequeo.errores.push(`Falta el <${tag} id="${id}">.`);
      return null;
    }
    if (encontrados.length > 1) chequeo.errores.push(`Hay ${encontrados.length} elementos con id="${id}"; tiene que haber uno solo.`);
    const el = encontrados[0];
    if (nombreLocal(el) !== tag) {
      chequeo.errores.push(`El elemento id="${id}" tiene que ser un <${tag}>, no un <${nombreLocal(el)}>.`);
      return null;
    }
    for (let p: Nodo | null = el; p && p !== raiz; p = p.parentNode) {
      if (p.hasAttribute('transform')) {
        chequeo.errores.push(`El ${id} (o un grupo que lo contiene) tiene transform: tiene que ir sin transform, con coordenadas directas.`);
        break;
      }
    }
    return el;
  };

  const logoEl = slot(IDS.logo, 'rect');
  const qrEl = slot(IDS.qr, 'rect');
  const nfcEl = slot(IDS.nfc, 'circle');
  const m = PLACA.margenSeguro;

  if (logoEl) {
    const [x, y, ancho, alto] = ['x', 'y', 'width', 'height'].map((a) => numero(logoEl.getAttribute(a)));
    if (x === null || y === null || !ancho || !alto) chequeo.errores.push('El logo-slot necesita x, y, width y height numéricos (en mm).');
    else {
      chequeo.slots.logo = { x, y, ancho, alto };
      if (x < m - 0.01 || y < m - 0.01 || x + ancho > PLACA.ancho - m + 0.01 || y + alto > PLACA.alto - m + 0.01) {
        chequeo.errores.push(`El logo-slot se sale de la zona segura (${m} mm del corte).`);
      }
      if (ancho * alto < 300) chequeo.avisos.push(`El logo-slot es chico (${ancho.toFixed(1)} × ${alto.toFixed(1)} mm); el logo puede no leerse.`);
    }
  }

  if (qrEl) {
    const [x, y, ancho, alto] = ['x', 'y', 'width', 'height'].map((a) => numero(qrEl.getAttribute(a)));
    if (x === null || y === null || !ancho || !alto) chequeo.errores.push('El qr-slot necesita x, y, width y height numéricos (en mm).');
    else {
      // El tamaño lo fija el sticker: se corrige solo, centrado donde lo puso el diseño.
      const lado = PLACA.qrSlot;
      const cx = x + ancho / 2;
      const cy = y + alto / 2;
      if (Math.abs(ancho - lado) > 0.5 || Math.abs(alto - lado) > 0.5) {
        chequeo.avisos.push(`El qr-slot medía ${ancho.toFixed(1)} × ${alto.toFixed(1)} mm; se ajustó a ${lado} × ${lado} mm.`);
      }
      const qx = Math.round((cx - lado / 2) * 100) / 100;
      const qy = Math.round((cy - lado / 2) * 100) / 100;
      qrEl.setAttribute('x', String(qx));
      qrEl.setAttribute('y', String(qy));
      qrEl.setAttribute('width', String(lado));
      qrEl.setAttribute('height', String(lado));
      chequeo.slots.qr = { x: qx, y: qy, ancho: lado, alto: lado };
      if (qx < m - 0.01 || qy < m - 0.01 || qx + lado > PLACA.ancho - m + 0.01 || qy + lado > PLACA.alto - m + 0.01) {
        chequeo.errores.push(`El qr-slot se sale de la zona segura (${m} mm del corte).`);
      }
    }
  }

  if (nfcEl) {
    const [cx, cy, r] = ['cx', 'cy', 'r'].map((a) => numero(nfcEl.getAttribute(a)));
    if (cx === null || cy === null || !r) chequeo.errores.push('El nfc-zone necesita cx, cy y r numéricos (en mm).');
    else {
      chequeo.slots.nfc = { cx, cy, r };
      if (r < PLACA.nfcRadioMin - 0.01 || r > PLACA.nfcRadioMax + 0.01) {
        chequeo.errores.push(`El radio del nfc-zone es ${r} mm; tiene que estar entre ${PLACA.nfcRadioMin} y ${PLACA.nfcRadioMax}.`);
      }
      if (cx - r < m || cy - r < m || cx + r > PLACA.ancho - m || cy + r > PLACA.alto - m) {
        chequeo.errores.push(`El círculo NFC se sale de la zona segura (${m} mm del corte).`);
      }
    }
  }

  const { logo, qr, nfc } = chequeo.slots;
  if (qr && nfc && distanciaCirculoRect(nfc, qr) < 2) chequeo.errores.push('El QR toca o pisa el círculo NFC: separalos al menos 2 mm.');
  if (qr && logo && rectsSeTocan(qr, logo, 2)) chequeo.errores.push('El QR toca o pisa el logo: separalos al menos 2 mm.');
  if (logo && nfc && distanciaCirculoRect(nfc, logo) < 0) chequeo.avisos.push('El logo se superpone con el círculo NFC.');

  revisarTextos(raiz, chequeo);

  const svg = serializar(doc);
  chequeo.bytes = Buffer.byteLength(svg, 'utf8');
  if (chequeo.bytes > 120_000) chequeo.avisos.push(`El SVG pesa ${(chequeo.bytes / 1024).toFixed(0)} KB; conviene simplificar.`);
  return { svg, chequeo };
}

function distanciaCirculoRect(c: Circulo, r: Rect) {
  const px = Math.max(r.x, Math.min(c.cx, r.x + r.ancho));
  const py = Math.max(r.y, Math.min(c.cy, r.y + r.alto));
  return Math.hypot(c.cx - px, c.cy - py) - c.r;
}

function rectsSeTocan(a: Rect, b: Rect, margen: number) {
  return !(a.x + a.ancho + margen <= b.x || b.x + b.ancho + margen <= a.x || a.y + a.alto + margen <= b.y || b.y + b.alto + margen <= a.y);
}

function heredado(n: Nodo, attr: string, css: string): string | null {
  for (let p: Nodo | null = n; p && p.nodeType === 1; p = p.parentNode) {
    const directo = p.getAttribute(attr);
    if (directo) return directo;
    const estilo = p.getAttribute('style');
    const m = estilo ? new RegExp(`${css}\\s*:\\s*([^;]+)`, 'i').exec(estilo) : null;
    if (m) return m[1].trim();
  }
  return null;
}

function tieneTransform(n: Nodo) {
  for (let p: Nodo | null = n; p && p.nodeType === 1; p = p.parentNode) {
    if (p.hasAttribute('transform')) return true;
  }
  return false;
}

/** Revisión aproximada de textos: tamaño mínimo y que no se salgan de la zona segura. */
function revisarTextos(raiz: Nodo, chequeo: ChequeoSvg) {
  const chicos = new Set<string>();
  const afuera = new Set<string>();
  const visitar = (n: Nodo) => {
    for (const h of elementos(n)) {
      const nombre = nombreLocal(h);
      if (nombre === 'defs' || nombre === 'symbol' || nombre === 'clipPath' || nombre === 'mask') continue;
      if (nombre === 'text') {
        const contenido = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!contenido) continue;
        const tamaño = numero(heredado(h, 'font-size', 'font-size')) ?? 4;
        const muestra = contenido.length > 28 ? `${contenido.slice(0, 28)}…` : contenido;
        if (tamaño < PLACA.textoMinimo) chicos.add(`"${muestra}" (${tamaño})`);
        if (!tieneTransform(h) && !h.getAttribute('textLength')) {
          const x = numero(h.getAttribute('x')?.split(/[\s,]+/)[0] ?? null);
          const y = numero(h.getAttribute('y')?.split(/[\s,]+/)[0] ?? null);
          if (x !== null && y !== null) {
            const ancho = contenido.length * tamaño * 0.52;
            const anclaje = heredado(h, 'text-anchor', 'text-anchor') ?? 'start';
            const x0 = anclaje === 'middle' ? x - ancho / 2 : anclaje === 'end' ? x - ancho : x;
            const m = PLACA.margenSeguro - 0.5;
            if (x0 < m || x0 + ancho > PLACA.ancho - m || y - tamaño * 0.75 < m || y > PLACA.alto - m) afuera.add(`"${muestra}"`);
          }
        }
        continue;
      }
      visitar(h);
    }
  };
  visitar(raiz);
  if (chicos.size > 0) chequeo.avisos.push(`Textos más chicos que ${PLACA.textoMinimo} mm: ${[...chicos].slice(0, 6).join(', ')}.`);
  if (afuera.size > 0) chequeo.avisos.push(`Textos que pueden salirse de la zona segura (cálculo aproximado): ${[...afuera].slice(0, 6).join(', ')}.`);
}

export type ModoQr = 'muestra' | 'imprenta';

/**
 * Arma el SVG listo para dibujar: pega el logo original en su lugar y el cuadrado blanco del QR.
 * En modo "muestra" dibuja un QR de ejemplo para que la vista previa se vea como la placa real.
 */
export function armarSvgFinal(svgLimpio: string, opciones: { logoDataUri: string | null; modoQr: ModoQr; qrMuestraDataUri?: string | null }) {
  const { doc, error } = parsear(svgLimpio);
  if (!doc || error) throw new Error(`No se pudo armar la placa: ${error ?? 'SVG vacío'}`);
  const raiz = doc.documentElement;
  const crear = (nombre: string, attrs: Record<string, string | number>) => {
    const el = raiz.ownerDocument.createElementNS(SVG_NS, nombre);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  const buscar = (id: string): Nodo | null => {
    const visitar = (n: Nodo): Nodo | null => {
      for (const h of elementos(n)) {
        if (h.getAttribute('id') === id) return h;
        const r = visitar(h);
        if (r) return r;
      }
      return null;
    };
    return visitar(raiz);
  };

  const logo = buscar(IDS.logo);
  if (logo && opciones.logoDataUri && logo.parentNode) {
    const img = crear('image', {
      id: IDS.logo,
      x: logo.getAttribute('x') ?? 0,
      y: logo.getAttribute('y') ?? 0,
      width: logo.getAttribute('width') ?? 10,
      height: logo.getAttribute('height') ?? 10,
      preserveAspectRatio: 'xMidYMid meet',
      href: opciones.logoDataUri,
    });
    logo.parentNode.replaceChild(img, logo);
  }

  const qr = buscar(IDS.qr);
  if (qr && qr.parentNode) {
    const x = numero(qr.getAttribute('x')) ?? 0;
    const y = numero(qr.getAttribute('y')) ?? 0;
    const lado = PLACA.qrSlot;
    const g = crear('g', { id: IDS.qr });
    g.appendChild(crear('rect', { x, y, width: lado, height: lado, rx: 1.2, fill: '#FFFFFF' }));
    const s = PLACA.qrSticker;
    const sx = x + (lado - s) / 2;
    const sy = y + (lado - s) / 2;
    if (opciones.modoQr === 'muestra' && opciones.qrMuestraDataUri) {
      g.appendChild(crear('image', { x: sx, y: sy, width: s, height: s, href: opciones.qrMuestraDataUri }));
    } else {
      // Marcas de esquina (quedan tapadas por el sticker) para pegarlo derecho.
      const t = 1.6;
      const esquinas: [number, number, number, number][] = [
        [sx, sy, 1, 1],
        [sx + s, sy, -1, 1],
        [sx, sy + s, 1, -1],
        [sx + s, sy + s, -1, -1],
      ];
      for (const [ex, ey, dx, dy] of esquinas) {
        g.appendChild(
          crear('path', {
            d: `M${(ex + dx * t).toFixed(2)} ${ey.toFixed(2)}H${ex.toFixed(2)}V${(ey + dy * t).toFixed(2)}`,
            fill: 'none',
            stroke: '#C9C9C9',
            'stroke-width': 0.2,
          }),
        );
      }
    }
    qr.parentNode.replaceChild(g, qr);
  }
  return serializar(doc);
}
