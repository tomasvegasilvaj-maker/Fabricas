# Fábrica de Placas

App web (Next.js en Vercel + Supabase) que arma placas NFC + QR únicas para comercios con agentes de IA.

Cargás el comercio y su logo. La fábrica investiga el negocio, busca inspiración del rubro, propone tres ideas donde el círculo NFC es el protagonista (una pizza, un frasco de esmalte que chorrea, una taza con vapor), dibuja un boceto de cada una, termina la elegida, la revisa con criterios de calidad y deja los archivos listos para imprimir. Vos solo elegís la idea, aprobás la final, imprimís, pegás el QR y grabás el NFC.

## Cómo funciona

| # | Etapa | Quién | Qué hace |
|---|-------|-------|----------|
| 1 | Recepción | App | Valida los datos, prepara el logo (sin redibujarlo) y saca sus colores |
| 2 | Investigación | IA + web | Google Maps, Instagram, web: estilo, tono, reseñas, objetos del rubro |
| 3 | Inspiración | IA + web | Busca referencias del rubro y baja imágenes de muestra |
| 4 | Ideas | IA | Tres conceptos distintos con el NFC como protagonista |
| 5 | Bocetos | IA | Un SVG por idea, los tres en paralelo |
| 6 | **Elegís** | Vos | Previa: elegís una idea (con comentario opcional) o pedís otras tres |
| 7 | Elaboración | IA | Termina la placa elegida |
| 8 | Revisión | IA | Control de calidad con puntajes; hasta 3 rondas de corrección |
| 9 | **Aprobás** | Vos | Previa: aprobás y confirmás el link de destino, o pedís cambios |
| 10 | Activación | Base | Asigna el próximo QR libre del lote y lo apunta al destino |
| 11 | Imprenta | App | PDF con sangrado, A4 con marcas de corte y guía, JPG 10 × 15 y SVG |

- **Motor:** cola de pasos en Supabase (`fab_pasos`). `POST /api/motor` toma pasos y corre como mucho uno de IA por invocación, porque Vercel corta a los 300 s. Lo despiertan la app después de cada acción, el propio motor (hasta 3 trabajadores en paralelo) y un latido de `pg_cron` cada minuto (`fab-motor` → `fab_tick()`). Los pasos que fallan se reintentan con espera creciente; si se agotan los intentos, aparece una Previa de fallo.
- **Previas:** todo lo que necesita tu decisión: elegir idea, aprobar, faltan datos (logo o link), fallos y tope de gasto.
- **Tope de gasto:** US$ 2,50 de IA por placa (`TOPE_USD_POR_PLACA`). Al llegar, la fábrica frena y te pregunta si sigue.
- **Preferencias:** reglas y gustos que se suman a todas las placas. Se cargan en Ajustes o marcando «Recordar» en una Previa.
- **QR:** no se generan. Se asignan del lote pre-impreso (`fab_qr_lote`, lote A4 #1 de 108 stickers de 16 mm) y se apuntan al destino en el QR dinámico de `qr-pasoapaso.vercel.app/q/CODIGO`. El NFC se graba con la misma URL. Los códigos de activación nunca pasan por la app.
- **Placa:** 100 × 150 mm + 3 mm de sangrado. La IA dibuja un SVG; la app lo limpia y valida (zona segura de 4 mm, QR de 20 mm, círculo NFC, distancias entre elementos), mete el logo real y lo dibuja con resvg y las tipografías de `fuentes/`.

## Equipo de Pedrito (línea nueva)

Cada pedido elige su línea (`fab_pedidos.linea`). La **clásica** es la tabla de arriba y sigue intacta. La del **equipo** la corren cuatro agentes con un jefe:

| Quién | Qué hace |
|-------|----------|
| **Pedrito** (jefe) | Decide el orden, le pasa a cada agente el resultado del anterior y da el visto bueno entre etapas. Si algo no está bien, devuelve el trabajo con una corrección y una regla de una línea. |
| **Ideas** | Tres conceptos según el rubro, con el objeto protagonista del círculo NFC. Pedrito elige uno (hasta 2 rondas). |
| **Diseño** | Una sola imagen por ronda con Gemini, usando el prompt que funcionó para el rubro (`fab_prompts_rubro`, «*» es la base). Encima va la plantilla, dibujada con código. Hasta 3 rondas. |
| **Estructura** | Verifica la plantilla obligatoria: logo arriba al medio, NFC o ícono al centro, QR abajo con «¿Sin NFC? Escaneá el código QR» y pie con rubro y «La Calera». Lo mide en código y lo mira con visión. |
| **Vos** | Previa: confirmás la placa y el link. |
| **Producción** | Toma la imagen confirmada, activa el QR del lote, verifica en Supabase que ese QR sea del pedido y apunte al link, arma el PDF A4 con dos placas 10 × 15 y prueba que el link abra. |

- **Reglas aprendidas:** cada corrección de Pedrito trae una regla de una línea. El agente corregido la guarda en `fab_reglas_agente` y relee todas sus reglas antes de cada trabajo. Se ven y se apagan en Ajustes. Las de pedidos de prueba quedan marcadas y no las leen los reales.
- **Necesita** una clave para las imágenes en Vercel: `AI_GATEWAY_API_KEY` (Vercel AI Gateway, se paga con créditos de Vercel y tiene prioridad) o `GEMINI_API_KEY` (Google directo, pide facturación en Google con tarjeta no prepaga). Opcional `GEMINI_IMAGE_MODEL`, por defecto `gemini-3-pro-image-preview` (en el Gateway se pide como `google/gemini-3-pro-image`). `/api/salud` muestra por dónde salen las imágenes.
- **Prueba sin IA:** con «Prueba sin IA» la línea del equipo corre con agentes simulados (Pedrito corrige una vez a Diseño para probar las reglas) y Producción hace todo salvo activar el QR.
- El formulario propone el equipo por defecto; el webhook usa la clásica salvo que mande `"linea": "equipo"`.

## Parte a Pedrito y correcciones de vuelta

Pedrito (bot de Grok Bot) es el único nexo con los otros bots. La app solo le habla a él.

**Salida: parte automático.** Cuando corre un paso del motor (placa nueva, cambio de estado, fallo de un agente), cuando cancelás o pausás un pedido, y en dos chequeos de respaldo (Supabase `fab-parte` cada 30 min y Vercel Cron una vez por día), la app arma el estado real (Supabase, solo pedidos reales) y lo compara con el último parte (`fab_parte_ultimo`). Si no cambió nada, no manda. Si cambió o hay un error nuevo, hace `POST` JSON a `PARTE_WEBHOOK_URL` con `Authorization: Bearer $PARTE_WEBHOOK_SECRET`: tres líneas de resumen, métricas contra el objetivo (20 placas, 10 negocios, 31/12/2026), estado de Gemini/A4, errores por agente y capturas (URLs firmadas por 7 días del bucket `fabrica`, carpeta `partes/`).

- Placa hecha = pedido real en estado `listo`. Negocio activo = comercio con algún pedido real que no esté cancelado ni fallido.
- Gemini/A4 no genera imágenes: consulta gratis si la clave (AI_GATEWAY_API_KEY o GEMINI_API_KEY) anda, arma un A4 de prueba con pdf-lib y mira fallos reales de las últimas 24 h.
- Las capturas son pantallas dibujadas con los datos reales (Vercel no trae navegador); la de generación de placa es la última vista real guardada.
- Ajustes → «Mandar parte de prueba» manda uno ya (marcado `"prueba": true`), sin gastar Gemini.

**Entrada: `POST /api/parte/correcciones`** con `Authorization: Bearer $PARTE_CORRECCIONES_SECRET`. Valida el JSON (solo reglas de texto de una línea, hasta 240 caracteres, agentes ideas/diseno/estructura/produccion/pedrito) y lo guarda todo o nada en `fab_reglas_agente` (`origen = 'pedrito'`, `motivo`, `reemplaza_a`; la regla reemplazada queda apagada). La línea del equipo relee esas reglas antes de cada trabajo; las de `pedrito` las lee el propio Pedrito al revisar.

## Puesta en marcha

1. **Supabase.** Las migraciones de `supabase/migrations` ya están aplicadas en el proyecto `paso-a-paso`. Crean las tablas `fab_*`, el bucket privado `fabrica`, las funciones del motor, el lote de QR y el cron `fab-motor`.
2. **Vercel.** Importar este repo y cargar las variables de entorno:

   | Variable | Para qué | |
   |----------|----------|---|
   | `SUPABASE_URL` | `https://izdfvzjkypcqxuspsxsm.supabase.co` | obligatoria |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta de Supabase (Settings → API keys). Solo servidor | obligatoria |
   | `ANTHROPIC_API_KEY` | Los agentes (platform.claude.com/settings/keys → Create key, atada al workspace Default) | obligatoria |
   | `ANTHROPIC_WORKSPACE_ID` | Solo si la clave de Anthropic no está atada a un workspace (`wrkspc_…`, en Settings → Workspaces) | opcional |
   | `APP_PASSWORD` | Tu clave para entrar | obligatoria |
   | `APP_URL` | URL de producción, sin barra final (si falta, usa la de Vercel) | opcional |
   | `GOOGLE_PLACES_API_KEY` | Place ID, fotos del local y link directo de reseñas | opcional |
   | `WEBHOOK_SECRET` | Habilita `POST /api/webhook/pedido` | opcional |
   | `TOPE_USD_POR_PLACA` | Tope de IA por placa (por defecto 2.5) | opcional |
   | `SESSION_SECRET` | Firma de la sesión. Si falta, se arma con la clave de Supabase y `APP_PASSWORD` | opcional |
   | `VISTA_PUBLICA` | `no` cierra el modo vista: sin contraseña no se ve nada (por defecto se puede mirar sin entrar) | opcional |

   No hay que inventar ninguna otra clave: la app se despierta a sí misma con una clave derivada de la de Supabase, y el latido del cron usa una que vive en Vault (paso 3).

3. **Latido del cron.** Una sola vez, en Supabase → SQL Editor:

   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'fab_motor_secret', 'Clave del latido de la fábrica');
   ```

   La clave se genera adentro de la base y nadie la tiene que ver ni copiar. La URL a la que llama el latido la anota la app de producción sola (`fab_config`) la primera vez que corre el motor. Sin el latido la fábrica igual anda, porque la app se despierta sola, pero el cron es lo que retoma los reintentos y los pasos colgados. Su estado se ve en Ajustes.
4. **Probar.** Abrir `/api/salud` (tiene que dar `"ok": true`), entrar con `APP_PASSWORD` y cargar un pedido con «Prueba sin IA»: corre toda la línea con agentes simulados, sin gastar IA y sin activar QR reales.

## Webhook de pedidos

Para cargar pedidos desde n8n, Make o un formulario:

```http
POST /api/webhook/pedido
Authorization: Bearer <WEBHOOK_SECRET>
Content-Type: application/json

{
  "comercio": { "nombre": "Cortes con Historia", "rubro": "Barbería", "ciudad": "La Calera", "instagram": "@cortesconhistoria" },
  "objetivo": "resenas",
  "logo_url": "https://.../logo.png",
  "ideas": "que el NFC sea una tijera abierta"
}
```

- `objetivo`: `resenas`, `turnos`, `whatsapp`, `links`, `carta`, `instagram` u `otro`.
- El logo va por `logo_url` (link público) o `logo_base64` (con o sin prefijo `data:`). Vercel corta los pedidos de más de 4,5 MB, así que en base64 tiene que pesar menos de unos 3 MB. Sin logo, el pedido queda esperando en una Previa.
- Opcionales: `comercio_id` (para un comercio que ya existe), `destino_url`, `simulado`, `auto_aprobar`.
- Responde `201` con `{ id, numero, url }`.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar
npm run dev
npm test                      # pruebas del dibujo de placas y de los links de destino
npm run typecheck
```

Las tipografías ya están en `fuentes/` (licencia OFL, ver `fuentes/LEEME.md`); `npm run fuentes` las vuelve a bajar.

## Costos de IA

Modelo `claude-opus-5-5`. Con los esfuerzos configurados, una placa cuesta alrededor de US$ 2 (investigación con búsqueda web, inspiración, ideas, tres bocetos, elaboración y revisión). Cada paso guarda su costo y el pedido suma el total. Si el modelo principal rechaza un pedido o no está disponible, la API pasa a un modelo de respaldo (`fallbacks: 'default'`).

## Estructura

```
src/app/                 páginas (mapa, Previas, pedidos, ajustes, login) y rutas /api
src/componentes/         piezas de la interfaz
src/lib/agentes/         un agente por paso (y versiones simuladas para las pruebas)
src/lib/motor/           cola, flujo, Previas, pedidos y destino de los QR
src/lib/placa/           especificación, limpieza del SVG, render, logo y PDFs
src/lib/ia/              llamadas a Claude y precios
supabase/migrations/     esquema de la base
tests/                   pruebas con vitest
```

## Seguridad

- Un solo usuario: clave `APP_PASSWORD` y cookie firmada por 30 días. Sin sesión la app queda en **modo vista**: se ven las páginas y las imágenes (para mostrársela a otras IAs), pero cada acción del servidor pide la sesión antes de hacer nada, así que nadie puede cargar pedidos, aprobar ni gastar IA. `VISTA_PUBLICA=no` lo cierra.
- La clave de servicio de Supabase solo se usa en el servidor; las tablas `fab_*` no tienen acceso público.
- Los archivos son privados en Supabase y se sirven por `/api/archivos` (con sesión o en modo vista).
- Los SVG que dibuja la IA se limpian con una lista blanca de elementos y atributos antes de guardarlos o mostrarlos.
