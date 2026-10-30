# Tipografías del render

Todas vienen de Google Fonts y tienen licencia **SIL Open Font License 1.1** (https://openfontlicense.org).
El texto de la licencia y el copyright de cada familia están dentro de cada `.ttf` (metadatos `name`).

Se usan solo para dibujar las placas en el servidor (resvg). Para sumar o cambiar familias:
editar `scripts/bajar-fuentes.mjs`, correr `npm run fuentes` y actualizar `src/lib/placa/fuentes.ts`.
