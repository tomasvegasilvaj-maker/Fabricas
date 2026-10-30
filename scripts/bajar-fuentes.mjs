// Baja las tipografías (todas con licencia OFL) que usa el render de las placas.
// Uso: node scripts/bajar-fuentes.mjs  → guarda los .ttf en fuentes/
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FAMILIAS = [
  ['Montserrat', 'wght@400;600;800;900'],
  ['DM Serif Display', 'ital@0;1'],
  ['Cormorant Garamond', 'ital,wght@0,500;0,700;1,500;1,600'],
  ['Playfair Display', 'ital,wght@0,700;0,900;1,400;1,700'],
  ['Poppins', 'wght@400;600;800'],
  ['Inter', 'wght@400;700'],
  ['Space Grotesk', 'wght@500;700'],
  ['Rubik', 'wght@500;800'],
  ['Josefin Sans', 'wght@400;700'],
  ['Oswald', 'wght@500;700'],
  ['Lora', 'ital,wght@0,500;1,500'],
  ['Bebas Neue', null],
  ['Anton', null],
  ['Archivo Black', null],
  ['Abril Fatface', null],
  ['Righteous', null],
  ['Fredoka', 'wght@500;700'],
  ['Pacifico', null],
  ['Lobster', null],
  ['Dancing Script', 'wght@700'],
  ['Great Vibes', null],
  ['Caveat', 'wght@700'],
];

const destino = path.join(process.cwd(), 'fuentes');
await mkdir(destino, { recursive: true });

for (const [familia, variantes] of FAMILIAS) {
  const q = familia.replace(/ /g, '+') + (variantes ? `:${variantes}` : '');
  // Con este user-agent Google Fonts entrega TTF completos (resvg no lee woff2).
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${q}`, { headers: { 'User-Agent': 'Wget/1.20' } })).text();
  const bloques = css.split('@font-face').slice(1);
  for (const b of bloques) {
    const estilo = /font-style:\s*(\w+)/.exec(b)?.[1] ?? 'normal';
    const peso = /font-weight:\s*(\d+)/.exec(b)?.[1] ?? '400';
    const url = /url\(([^)]+\.ttf)\)/.exec(b)?.[1];
    if (!url) continue;
    const nombre = `${familia.replace(/ /g, '')}-${peso}${estilo === 'italic' ? 'i' : ''}.ttf`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(path.join(destino, nombre), buf);
    console.log(nombre, (buf.length / 1024).toFixed(0) + ' KB');
  }
}
