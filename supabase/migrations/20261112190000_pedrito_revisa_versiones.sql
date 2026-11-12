-- Fábrica de placas · Pedrito revisa cada versión antes de la imagen siguiente
--
-- 1) fab_correcciones_pedido: la ficha de correcciones de Tomi por pedido, en orden. Se acumulan (nunca se pisan).
-- 2) fab_partes_version: un parte por cada imagen nueva (prompt completo, trabajador, costo, n.º de pedido y de
--    imagen, correcciones usadas) y la respuesta de Pedrito. La app no genera la imagen siguiente sin esa respuesta.
-- 3) Rol pedrito_lector: usuario de Postgres de SOLO LECTURA sobre las tablas de partes, correcciones y reglas.
--    No tiene contraseña hasta que Tomi le ponga una (alter role ... password) desde el SQL Editor de Supabase.
-- 4) Sin reintentos en loop: un paso colgado pasa directo a Tomi; las esperas a Pedrito no gastan intentos.
-- 5) El prompt base no pide dibujar un círculo: el aro y las ondas del NFC los dibuja solo la plantilla.

create table if not exists public.fab_correcciones_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  orden integer not null,
  texto text not null check (length(btrim(texto)) between 2 and 2000),
  -- Sobre qué versión la pidió Tomi y desde qué versión pidió partir («partí de la versión X»).
  version_id uuid references public.fab_versiones(id) on delete set null,
  base_version_id uuid references public.fab_versiones(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pedido_id, orden)
);

create table if not exists public.fab_partes_version (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  version_id uuid not null unique references public.fab_versiones(id) on delete cascade,
  pedido_numero integer not null,
  version_numero integer not null,
  trabajador text not null,
  prompt text not null,
  costo_usd numeric(10,4) not null default 0,
  gasto_pedido_usd numeric(10,4) not null default 0,
  correcciones_usadas uuid[] not null default '{}',
  base_version_id uuid references public.fab_versiones(id) on delete set null,
  imagen_path text,
  vista_path text,
  enviado_at timestamptz,
  envio_error text,
  -- pendiente → ok | alerta (la manda Pedrito por /api/parte/revision) | sin_respuesta (pasó el plazo) | no_enviado.
  respuesta text not null default 'pendiente' check (respuesta in ('pendiente', 'ok', 'alerta', 'sin_respuesta', 'no_enviado')),
  alertas jsonb not null default '[]',
  respondido_at timestamptz,
  -- Tomi vio la alerta (o la falta de respuesta) y decidió seguir.
  resuelta boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists fab_partes_version_pedido_idx on public.fab_partes_version (pedido_id, created_at desc);

alter table public.fab_correcciones_pedido enable row level security;
alter table public.fab_partes_version enable row level security;
revoke all on table public.fab_correcciones_pedido, public.fab_partes_version from anon, authenticated;
grant select, insert, update, delete on table public.fab_correcciones_pedido, public.fab_partes_version to service_role;

-- ───────────────────────── Solo lectura para Pedrito ─────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pedrito_lector') then
    create role pedrito_lector login noinherit nocreatedb nocreaterole noreplication nobypassrls connection limit 3;
  end if;
end $$;
alter role pedrito_lector set statement_timeout = '15s';
alter role pedrito_lector set default_transaction_read_only = on;

grant usage on schema public to pedrito_lector;
grant select on table public.fab_partes_version, public.fab_parte_ultimo, public.fab_correcciones_pedido, public.fab_reglas_agente to pedrito_lector;

drop policy if exists pedrito_lee on public.fab_partes_version;
create policy pedrito_lee on public.fab_partes_version for select to pedrito_lector using (true);
drop policy if exists pedrito_lee on public.fab_parte_ultimo;
create policy pedrito_lee on public.fab_parte_ultimo for select to pedrito_lector using (true);
drop policy if exists pedrito_lee on public.fab_correcciones_pedido;
create policy pedrito_lee on public.fab_correcciones_pedido for select to pedrito_lector using (true);
drop policy if exists pedrito_lee on public.fab_reglas_agente;
create policy pedrito_lee on public.fab_reglas_agente for select to pedrito_lector using (true);

-- ───────────────────────── Esperas y pasos colgados ─────────────────────────

-- Devuelve el paso a la cola dentro de unos segundos sin gastar un intento (esperar a Pedrito no es fallar).
create or replace function public.fab_esperar_paso(p_paso uuid, p_intento integer, p_segundos integer, p_nota text)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update public.fab_pasos
       set estado = 'pendiente', intento = greatest(intento - 1, 0), tomado_at = null, error = left(p_nota, 1000),
           disponible_desde = now() + make_interval(secs => greatest(p_segundos, 1))
     where id = p_paso and estado = 'corriendo' and intento = p_intento
     returning 1
  )
  select exists (select 1 from u);
$$;
revoke all on function public.fab_esperar_paso(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.fab_esperar_paso(uuid, integer, integer, text) to service_role;

-- Un paso que se colgó (el trabajador no respondió) ya no se reintenta solo: el pedido espera a Tomi.
create or replace function public.fab_tomar_paso(p_atasco_seg integer default 330)
returns setof public.fab_pasos language plpgsql security definer set search_path = '' as $$
declare v_id uuid; r record;
begin
  for r in
    select s.id, s.tipo from public.fab_pasos s
     where s.estado = 'corriendo' and s.tomado_at < now() - make_interval(secs => p_atasco_seg)
     for update skip locked
  loop
    perform public.fab_fallo_generico(r.id, 'El trabajador «' || r.tipo || '» no respondió en ' || round(p_atasco_seg / 60.0) || ' minutos. El pedido quedó en pausa: revisalo y reintentá.');
  end loop;

  select s.id into v_id
    from public.fab_pasos s
    join public.fab_pedidos p on p.id = s.pedido_id
   where s.estado = 'pendiente' and s.disponible_desde <= now() and p.estado = 'en_marcha'
   order by s.disponible_desde, s.created_at
   for update of s skip locked
   limit 1;
  if v_id is null then return; end if;

  return query
    with tomado as (
      update public.fab_pasos
         set estado = 'corriendo', intento = intento + 1, tomado_at = now()
       where id = v_id
       returning *
    )
    select * from tomado;
end $$;

-- ───────────────────────── Prompt base sin círculo dibujado ─────────────────────────

update public.fab_prompts_rubro
   set prompt = replace(prompt, 'filling a circle about one fifth of the image width', 'about one fifth of the image width, with no circle, ring or frame drawn around it'),
       notas = coalesce(notas, '') || ' (2026-11-12: el aro y las ondas del NFC los dibuja solo la plantilla.)'
 where prompt like '%filling a circle about one fifth of the image width%';
