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

## Puesta en marcha

1. **Supabase.** Las migraciones de `supabase/migrations` ya están aplicadas en el proyecto `paso-a-paso`. Crean las tablas `fab_*`, el bucket privado `fabrica`, las funciones del motor, el lote de QR y el cron `fab-motor`.
2. **Vercel.** Importar este repo y cargar las variables de entorno:

   | Variable | Para qué | |
   |----------|----------|---|
   | `SUPABASE_URL` | `https://izdfvzjkypcqxuspsxsm.supabase.co` | obligatoria |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta de Supabase (Settings → API keys). Solo servidor | obligatoria |
   | `ANTHROPIC_API_KEY` | Los agentes (console.anthropic.com → API keys) | obligatoria |
   | `APP_PASSWORD` | Tu clave para entrar | obligatoria |
   | `SESSION_SECRET` | Firma de la sesión (texto largo al azar) | obligatoria |
   | `MOTOR_SECRET` | Clave con la que el cron despierta al motor (texto largo al azar) | obligatoria |
   | `APP_URL` | URL de producción, sin barra final | recomendada |
   | `GOOGLE_PLACES_API_KEY` | Place ID, fotos del local y link directo de reseñas | opcional |
   | `WEBHOOK_SECRET` | Habilita `POST /api/webhook/pedido` | opcional |
   | `TOPE_USD_POR_PLACA` | Tope de IA por placa (por defecto 2.5) | opcional |

3. **Latido del cron.** Guardar en Supabase Vault la URL de producción y el mismo `MOTOR_SECRET`:

   ```sql
   select vault.create_secret('https://TU-APP.vercel.app', 'fab_app_url');
   select vault.create_secret('EL_MISMO_MOTOR_SECRET', 'fab_motor_secret');
   ```

   Sin esto la fábrica igual anda (la app despierta al motor sola), pero el cron es lo que retoma pasos colgados.
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

- Un solo usuario: clave `APP_PASSWORD` y cookie firmada por 30 días. El proxy y cada página o acción verifican la sesión.
- La clave de servicio de Supabase solo se usa en el servidor; las tablas `fab_*` no tienen acceso público.
- Los archivos son privados y se sirven por `/api/archivos` solo con sesión.
- Los SVG que dibuja la IA se limpian con una lista blanca de elementos y atributos antes de guardarlos o mostrarlos.
