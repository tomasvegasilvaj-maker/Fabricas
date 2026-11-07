-- Fábrica de placas · Equipo de Pedrito
-- Línea nueva de trabajo: Pedrito (jefe) orquesta a Ideas, Diseño, Estructura y Producción.
-- Todo es aditivo: la línea clásica (investigación → bocetos SVG → revisión) sigue igual y es la de
-- por defecto hasta que la nueva se pruebe con un pedido real de punta a punta.

-- Qué línea corre cada pedido.
alter table public.fab_pedidos
  add column if not exists linea text not null default 'clasica'
  check (linea in ('clasica', 'equipo'));

-- Las versiones de la línea nueva son imágenes (Gemini + plantilla), no SVG: origen «diseno» y svg vacío.
alter table public.fab_versiones drop constraint if exists fab_versiones_origen_check;
alter table public.fab_versiones
  add constraint fab_versiones_origen_check check (origen in ('boceto', 'elaboracion', 'diseno'));

-- Reglas de una línea que cada agente aprende de las correcciones de Pedrito y relee antes de cada trabajo.
create table if not exists public.fab_reglas_agente (
  id uuid primary key default gen_random_uuid(),
  agente text not null check (agente in ('ideas', 'diseno', 'estructura', 'produccion')),
  texto text not null check (length(btrim(texto)) between 3 and 240 and position(E'\n' in texto) = 0),
  rubro text,
  pedido_id uuid references public.fab_pedidos(id) on delete set null,
  -- Las que salen de pedidos de prueba solo las leen otros pedidos de prueba.
  prueba boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists fab_reglas_agente_unica
  on public.fab_reglas_agente (agente, prueba, lower(btrim(texto))) where activo;
create index if not exists fab_reglas_agente_agente_idx on public.fab_reglas_agente (agente, created_at);

-- El prompt de imagen que funcionó para cada rubro. El rubro «*» es la base para los que no tienen uno propio.
-- Marcadores que Diseño reemplaza: {rubro} {objeto_nfc} {escena} {paleta} {estilo}.
create table if not exists public.fab_prompts_rubro (
  id uuid primary key default gen_random_uuid(),
  rubro text not null,
  prompt text not null check (length(btrim(prompt)) > 20),
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fab_prompts_rubro_unico on public.fab_prompts_rubro (lower(btrim(rubro)));

drop trigger if exists fab_prompts_rubro_tocar on public.fab_prompts_rubro;
create trigger fab_prompts_rubro_tocar before update on public.fab_prompts_rubro
  for each row execute function public.fab_tocar();

insert into public.fab_prompts_rubro (rubro, prompt, notas) values
(
  '*',
  'Vertical 2:3 illustration for a countertop sign of a {rubro} shop. The hero is {objeto_nfc}, seen clearly and placed exactly in the center of the image, filling a circle about one fifth of the image width. {escena}. Style: {estilo}. Palette: {paleta}. Clean, warm and premium, soft studio lighting, crisp edges, printable colors with good contrast. No text, no letters, no numbers, no logos, no watermark.',
  'Base para rubros sin prompt propio. Armado a partir de lo que funcionó con la barbería.'
),
(
  'barbería',
  'Vertical 2:3 illustration for a barbershop countertop sign. The hero is {objeto_nfc}, placed exactly in the center of the image, filling a circle about one fifth of the image width. {escena}. 3D isometric toy-like render style, glossy materials, black and white striped awning details, barber pole accents. Palette: {paleta}. Plain calm background, only a very soft shadow under the hero. No text, no letters, no logos, no watermark.',
  'Del documento de Tarjetas NFC (sección 9, local aislado en 3D para Cortes con Historia), adaptado a la plantilla.'
)
on conflict do nothing;

-- Producción verifica qué QR del lote quedó con el pedido y a dónde apunta (qr.codes no está expuesto a la API).
create or replace function public.fab_verificar_qr(p_codigo text)
returns table (codigo text, n integer, lote text, estado text, pedido_id uuid, url text)
language sql stable security definer set search_path = '' as $$
  select l.codigo, l.n, l.lote, l.estado, l.pedido_id, c.url
    from public.fab_qr_lote l
    join qr.codes c on c.code = l.codigo
   where l.codigo = p_codigo;
$$;

-- ───────────────────────── Permisos ─────────────────────────

alter table public.fab_reglas_agente enable row level security;
alter table public.fab_prompts_rubro enable row level security;

revoke all on table public.fab_reglas_agente, public.fab_prompts_rubro from anon, authenticated;
grant select, insert, update, delete on table public.fab_reglas_agente, public.fab_prompts_rubro to service_role;

revoke all on function public.fab_verificar_qr(text) from public, anon, authenticated;
grant execute on function public.fab_verificar_qr(text) to service_role;
