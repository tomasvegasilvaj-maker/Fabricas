import { reglasSvg } from '../placa/especificacion';
import type { InfoLogo } from '../placa/logo';
import { SISTEMA_FABRICA, textoPreferencias } from './comun';
import type { Concepto } from './conceptos';

/** Instrucciones del ilustrador que escribe el SVG (bocetos y elaboración). */
export async function sistemaIlustrador(rubro: string) {
  return `${SISTEMA_FABRICA}

Sos ilustrador y diseñador gráfico. Dibujás la placa escribiendo el SVG a mano, como ilustración plana o semiplana prolija (formas limpias, alguna sombra suave), lista para imprenta.

${reglasSvg()}

## Criterios de calidad
- El protagonista es el arte del círculo NFC: grande, claro y del rubro, construido sobre el nfc-zone. Tiene que leerse a un metro.
- Jerarquía: 1) arte del NFC con su frase, 2) titular, 3) logo, 4) QR con su frase. Aire entre bloques.
- Ondas de pago sin contacto (tres arcos concéntricos) integradas al dibujo, cerca o dentro del círculo, para que se entienda que ahí se apoya el celular.
- Máximo 5 colores más blanco y negro. Contraste alto en todos los textos.
- Ningún texto encima de zonas recargadas. Nada encima del QR ni pegado a él. Ningún texto pisando a otro ni al dibujo.
- Textos largos en dos líneas (dos <text>), nunca una línea que se salga de la zona segura: calculá el ancho (cada letra ocupa más o menos 0,6 × el tamaño de la fuente; en mayúsculas espaciadas, un poco más).
- Dibujá con paths y formas simples; lo que chorrea, el vapor o lo que rodea al círculo, con curvas suaves (Q, C) y formas cerradas con relleno.

${await textoPreferencias(rubro)}

Respondé solo con el SVG completo, empezando por <svg y terminando en </svg>, sin explicaciones ni bloques de código.`;
}

export function textoConcepto(c: Concepto) {
  return [
    `Título: ${c.titulo} (camino: ${c.patron})`,
    `Idea: ${c.idea}`,
    `Círculo NFC: ${c.circulo_nfc}`,
    `Composición: ${c.composicion}`,
    `Fondo: ${c.fondo}`,
    `Paleta: ${c.paleta.map((p) => `${p.hex} (${p.uso})`).join(', ')}`,
    `Tipografías: titular "${c.tipografia_titular}", textos "${c.tipografia_textos}"`,
    `Textos: titular «${c.textos.titular}» · bajada «${c.textos.bajada}» · junto al NFC «${c.textos.nfc}» · junto al QR «${c.textos.qr}»${c.textos.extra ? ` · extra «${c.textos.extra}»` : ''}`,
    `Logo: ${c.logo}`,
  ].join('\n');
}

/** Tamaño de ejemplo del logo-slot con la proporción real del logo. */
export function medidaLogoSugerida(info: InfoLogo) {
  let ancho = 44;
  let alto = ancho / info.proporcion;
  if (alto > 28) {
    alto = 28;
    ancho = alto * info.proporcion;
  }
  return `width="${ancho.toFixed(1)}" height="${alto.toFixed(1)}"`;
}
