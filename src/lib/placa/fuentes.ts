import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

/** Familias disponibles para el render. Los agentes solo pueden usar estas. */
export const FUENTES: { familia: string; pesos: string; uso: string }[] = [
  { familia: 'Montserrat', pesos: '400, 600, 800, 900', uso: 'sans geométrica; títulos en mayúsculas espaciadas, la de la casa' },
  { familia: 'DM Serif Display', pesos: '400 y 400 itálica', uso: 'serif con contraste; frases cálidas en itálica' },
  { familia: 'Cormorant Garamond', pesos: '500, 700, 500 itálica, 600 itálica', uso: 'serif elegante y fina; estética, bienestar' },
  { familia: 'Playfair Display', pesos: '700, 900, 400 itálica, 700 itálica', uso: 'serif editorial de alto contraste' },
  { familia: 'Poppins', pesos: '400, 600, 800', uso: 'sans redonda y amable' },
  { familia: 'Inter', pesos: '400, 700', uso: 'sans neutra para textos chicos' },
  { familia: 'Space Grotesk', pesos: '500, 700', uso: 'sans moderna con carácter' },
  { familia: 'Rubik', pesos: '500, 800', uso: 'sans de puntas redondeadas, juvenil' },
  { familia: 'Josefin Sans', pesos: '400, 700', uso: 'sans geométrica vintage, elegante en mayúsculas' },
  { familia: 'Oswald', pesos: '500, 700', uso: 'condensada, carteles' },
  { familia: 'Lora', pesos: '500 y 500 itálica', uso: 'serif de lectura, cálida' },
  { familia: 'Bebas Neue', pesos: '400', uso: 'condensada en mayúsculas, impacto' },
  { familia: 'Anton', pesos: '400', uso: 'condensada muy gruesa, cartel' },
  { familia: 'Archivo Black', pesos: '400', uso: 'grotesca negrísima' },
  { familia: 'Abril Fatface', pesos: '400', uso: 'display didona, títulos con lujo' },
  { familia: 'Righteous', pesos: '400', uso: 'display retro redondeada' },
  { familia: 'Fredoka', pesos: '500, 700', uso: 'redonda y blanda, infantil o golosa' },
  { familia: 'Pacifico', pesos: '400', uso: 'script de surf, retro y alegre' },
  { familia: 'Lobster', pesos: '400', uso: 'script gruesa vintage' },
  { familia: 'Dancing Script', pesos: '700', uso: 'manuscrita fluida' },
  { familia: 'Great Vibes', pesos: '400', uso: 'caligráfica fina (solo tamaños grandes)' },
  { familia: 'Caveat', pesos: '700', uso: 'escrita a mano con marcador' },
];

const NOMBRES = new Map(FUENTES.map((f) => [f.familia.toLowerCase(), f.familia]));

const GENERICAS: Record<string, string> = {
  'sans-serif': 'Montserrat',
  sans: 'Montserrat',
  serif: 'DM Serif Display',
  cursive: 'Dancing Script',
  script: 'Dancing Script',
  monospace: 'Space Grotesk',
  fantasy: 'Righteous',
  'system-ui': 'Inter',
  arial: 'Inter',
  helvetica: 'Inter',
  'times new roman': 'Lora',
  georgia: 'Lora',
};

export const FUENTE_POR_DEFECTO = 'Montserrat';

/** Convierte un font-family cualquiera en una familia que el render tiene. */
export function familiaDisponible(valor: string): string {
  const candidatas = valor
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
    .filter(Boolean);
  for (const c of candidatas) {
    const exacta = NOMBRES.get(c);
    if (exacta) return exacta;
  }
  for (const c of candidatas) {
    if (GENERICAS[c]) return GENERICAS[c];
  }
  return FUENTE_POR_DEFECTO;
}

export function textoFuentesParaPrompt() {
  return FUENTES.map((f) => `- "${f.familia}" (${f.pesos}): ${f.uso}`).join('\n');
}

/** Archivos .ttf para resvg. Con `familias` carga solo esas (más la de por defecto), que es bastante más rápido. */
export function archivosDeFuentes(familias?: Iterable<string>): string[] {
  const dir = path.join(process.cwd(), 'fuentes');
  if (!existsSync(dir)) return [];
  const prefijos = familias ? new Set([...familias, FUENTE_POR_DEFECTO].map((f) => f.replace(/ /g, ''))) : null;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ttf') && (!prefijos || prefijos.has(f.slice(0, f.lastIndexOf('-')))))
    .map((f) => path.join(dir, f));
}

/** Familias que aparecen en un SVG (en atributos o en estilos), ya convertidas a las disponibles. */
export function familiasEnSvg(svg: string): Set<string> {
  const familias = new Set<string>();
  for (const m of svg.matchAll(/font-family\s*(?:=\s*"([^"]*)"|=\s*'([^']*)'|:\s*([^;"}]+))/gi)) {
    familias.add(familiaDisponible(m[1] ?? m[2] ?? m[3] ?? ''));
  }
  return familias;
}
