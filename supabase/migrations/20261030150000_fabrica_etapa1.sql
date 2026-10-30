-- Fábrica de placas · Etapa 1
-- Todo vive en public con prefijo fab_. Solo el backend de la app (service_role) lo usa:
-- RLS activo sin políticas y sin permisos para anon/authenticated.

-- ───────────────────────── Tablas ─────────────────────────

create table public.fab_comercios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  rubro text not null check (length(btrim(rubro)) between 1 and 80),
  ciudad text,
  direccion text,
  instagram text,
  google_maps_url text,
  whatsapp text,
  web text,
  link_resenas text,
  logo_path text,
  logo_info jsonb,
  investigacion jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fab_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero integer generated always as identity unique,
  comercio_id uuid not null references public.fab_comercios(id) on delete cascade,
  fabrica text not null default 'placas',
  objetivo text not null check (objetivo in ('resenas','turnos','whatsapp','links','carta','instagram','otro')),
  destino_url text check (destino_url is null or destino_url ~* '^https?://[^[:space:]]+$'),
  ideas text,
  estado text not null default 'en_marcha'
    check (estado in ('en_marcha','en_espera','pausado','listo','fallido','cancelado')),
  etapa text not null default 'intake',
  ronda integer not null default 0,
  gasto_usd numeric(10,4) not null default 0,
  tope_usd numeric(10,2) not null default 2.50,
  concepto_id uuid,
  version_final_id uuid,
  qr_codigo text,
  simulado boolean not null default false,
  auto_aprobar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminado_at timestamptz
);
create index fab_pedidos_estado_idx on public.fab_pedidos (estado, created_at desc);
create index fab_pedidos_comercio_idx on public.fab_pedidos (comercio_id);

-- Cola de trabajo: cada paso lo corre un agente (o código) y deja su salida.
create table public.fab_pasos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  tipo text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','corriendo','hecho','fallido','cancelado')),
  entrada jsonb not null default '{}'::jsonb,
  salida jsonb,
  error text,
  intento integer not null default 0,
  max_intentos integer not null default 3,
  costo_usd numeric(10,4) not null default 0,
  disponible_desde timestamptz not null default now(),
  tomado_at timestamptz,
  terminado_at timestamptz,
  created_at timestamptz not null default now()
);
create index fab_pasos_cola_idx on public.fab_pasos (estado, disponible_desde)
  where estado in ('pendiente','corriendo');
create index fab_pasos_pedido_idx on public.fab_pasos (pedido_id, created_at);

-- Previas: lo que espera tu OK (elegir concepto, aprobar diseño, tope de gasto, datos que faltan, fallos).
create table public.fab_previas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  tipo text not null check (tipo in ('elegir_concepto','aprobar_final','tope_gasto','falta_dato','fallo')),
  titulo text not null,
  detalle text,
  datos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente','resuelta','descartada')),
  respuesta jsonb,
  created_at timestamptz not null default now(),
  resuelta_at timestamptz
);
create unique index fab_previas_una_pendiente on public.fab_previas (pedido_id, tipo) where estado = 'pendiente';
create index fab_previas_estado_idx on public.fab_previas (estado, created_at);

create table public.fab_conceptos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  tanda integer not null default 1,
  indice integer not null,
  titulo text not null,
  patron text not null,
  idea text not null,
  datos jsonb not null default '{}'::jsonb,
  elegido boolean not null default false,
  created_at timestamptz not null default now(),
  unique (pedido_id, tanda, indice)
);

create table public.fab_versiones (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  concepto_id uuid references public.fab_conceptos(id) on delete set null,
  numero integer not null,
  origen text not null check (origen in ('boceto','elaboracion')),
  svg text not null,
  preview_path text,
  notas text,
  chequeo jsonb,
  revision jsonb,
  created_at timestamptz not null default now()
);
create index fab_versiones_pedido_idx on public.fab_versiones (pedido_id, created_at);

create table public.fab_inspiracion (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.fab_pedidos(id) on delete cascade,
  titulo text not null,
  url_pagina text,
  url_imagen text,
  imagen_path text,
  patron text,
  nota text,
  created_at timestamptz not null default now()
);
create index fab_inspiracion_pedido_idx on public.fab_inspiracion (pedido_id);

create table public.fab_archivos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.fab_pedidos(id) on delete cascade,
  comercio_id uuid references public.fab_comercios(id) on delete cascade,
  tipo text not null,
  nombre text,
  path text not null unique,
  mime text not null,
  bytes integer,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index fab_archivos_pedido_idx on public.fab_archivos (pedido_id);

create table public.fab_eventos (
  id bigint generated always as identity primary key,
  pedido_id uuid references public.fab_pedidos(id) on delete cascade,
  paso_id uuid references public.fab_pasos(id) on delete set null,
  nivel text not null default 'info' check (nivel in ('info','aviso','error')),
  mensaje text not null,
  datos jsonb,
  created_at timestamptz not null default now()
);
create index fab_eventos_pedido_idx on public.fab_eventos (pedido_id, created_at desc);

-- Lote de QR autoadhesivos ya impresos. Solo el código y su número en la hoja:
-- las claves de activación viven únicamente en qr.codes (cifradas).
create table public.fab_qr_lote (
  codigo text primary key references qr.codes(code),
  lote text not null,
  n integer not null,
  estado text not null default 'libre' check (estado in ('libre','asignado','reservado')),
  pedido_id uuid references public.fab_pedidos(id) on delete set null,
  comercio text,
  asignado_at timestamptz,
  unique (lote, n)
);

-- Lo que la fábrica aprendió de tus gustos (semillas + lo que marcás en las Previas).
create table public.fab_preferencias (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  tipo text not null default 'regla' check (tipo in ('regla','gusto','evitar')),
  rubro text,
  origen text not null default 'semilla',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.fab_tocar() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger fab_comercios_tocar before update on public.fab_comercios
  for each row execute function public.fab_tocar();
create trigger fab_pedidos_tocar before update on public.fab_pedidos
  for each row execute function public.fab_tocar();

-- ───────────────────────── Funciones de la cola ─────────────────────────

-- Fallo definitivo genérico: frena el pedido y deja una Previa para decidir.
create or replace function public.fab_fallo_generico(p_paso uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pedido uuid; v_tipo text;
begin
  update public.fab_pasos
     set estado = 'fallido', error = left(p_error, 4000), terminado_at = now()
   where id = p_paso and estado in ('pendiente','corriendo')
   returning pedido_id, tipo into v_pedido, v_tipo;
  if v_pedido is null then return; end if;
  update public.fab_pedidos set estado = 'en_espera' where id = v_pedido and estado = 'en_marcha';
  insert into public.fab_previas (pedido_id, tipo, titulo, detalle, datos)
  values (v_pedido, 'fallo', 'Se trabó un paso: ' || v_tipo, left(p_error, 1000),
          jsonb_build_object('paso_id', p_paso, 'tipo', v_tipo))
  on conflict (pedido_id, tipo) where estado = 'pendiente' do nothing;
  insert into public.fab_eventos (pedido_id, paso_id, nivel, mensaje)
  values (v_pedido, p_paso, 'error', left(p_error, 2000));
end $$;

-- Toma el próximo paso listo para correr (de a uno, sin pisarse entre procesos).
-- Antes recupera los pasos que quedaron colgados porque se cortó la función que los corría.
create or replace function public.fab_tomar_paso(p_atasco_seg integer default 330)
returns setof public.fab_pasos language plpgsql security definer set search_path = '' as $$
declare v_id uuid; r record;
begin
  for r in
    select s.id, s.intento, s.max_intentos from public.fab_pasos s
     where s.estado = 'corriendo' and s.tomado_at < now() - make_interval(secs => p_atasco_seg)
     for update skip locked
  loop
    if r.intento < r.max_intentos then
      update public.fab_pasos
         set estado = 'pendiente', disponible_desde = now(), tomado_at = null,
             error = 'Se cortó por tiempo en el intento ' || r.intento
       where id = r.id;
    else
      perform public.fab_fallo_generico(r.id, 'Se cortó por tiempo ' || r.intento || ' veces seguidas.');
    end if;
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

-- Cierra un paso (hecho o fallido) y, en la misma transacción, encola lo que sigue,
-- deja la Previa si hace falta y actualiza el pedido. Devuelve false si el paso ya no era suyo.
-- p_esperar_tipos sirve para los pasos en paralelo (bocetos): lo que sigue solo se dispara
-- cuando no queda ningún otro paso de esos tipos pendiente o corriendo en el pedido.
create or replace function public.fab_cerrar_paso(
  p_paso uuid,
  p_intento integer,
  p_estado text,
  p_salida jsonb,
  p_error text,
  p_siguientes jsonb default '[]'::jsonb,
  p_previa jsonb default null,
  p_pedido_estado text default null,
  p_pedido_etapa text default null,
  p_esperar_tipos text[] default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_pedido uuid; s jsonb;
begin
  if p_estado not in ('hecho','fallido') then
    raise exception 'Estado de cierre inválido: %', p_estado;
  end if;
  update public.fab_pasos
     set estado = p_estado, salida = p_salida, error = left(p_error, 4000), terminado_at = now()
   where id = p_paso and estado = 'corriendo' and intento = p_intento
   returning pedido_id into v_pedido;
  if v_pedido is null then return false; end if;

  -- Un cierre a la vez por pedido: así dos bocetos que terminan juntos no se pierden la Previa.
  perform 1 from public.fab_pedidos where id = v_pedido for update;

  if p_esperar_tipos is not null and exists (
    select 1 from public.fab_pasos o
     where o.pedido_id = v_pedido and o.id <> p_paso
       and o.tipo = any (p_esperar_tipos) and o.estado in ('pendiente','corriendo')
  ) then
    return true;
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_siguientes, '[]'::jsonb)) loop
    insert into public.fab_pasos (pedido_id, tipo, entrada, max_intentos)
    values (v_pedido, s->>'tipo', coalesce(s->'entrada', '{}'::jsonb), coalesce((s->>'max_intentos')::int, 3));
  end loop;

  if p_previa is not null then
    insert into public.fab_previas (pedido_id, tipo, titulo, detalle, datos)
    values (v_pedido, p_previa->>'tipo', p_previa->>'titulo', p_previa->>'detalle',
            coalesce(p_previa->'datos', '{}'::jsonb))
    on conflict (pedido_id, tipo) where estado = 'pendiente' do nothing;
  end if;

  update public.fab_pedidos
     set estado = case when estado in ('pausado','cancelado') then estado
                       else coalesce(p_pedido_estado, estado) end,
         etapa = coalesce(p_pedido_etapa, etapa),
         terminado_at = case when p_pedido_estado = 'listo' then now() else terminado_at end
   where id = v_pedido;
  return true;
end $$;

-- Error que vale la pena reintentar (API caída, tiempo): vuelve a la cola más tarde.
create or replace function public.fab_reprogramar_paso(p_paso uuid, p_intento integer, p_error text, p_segundos integer)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update public.fab_pasos
       set estado = 'pendiente', error = left(p_error, 4000), tomado_at = null,
           disponible_desde = now() + make_interval(secs => greatest(p_segundos, 0))
     where id = p_paso and estado = 'corriendo' and intento = p_intento
     returning 1
  )
  select exists (select 1 from u);
$$;

-- El pedido llegó a su tope de gasto en IA: devuelve el paso a la cola y te pregunta.
create or replace function public.fab_frenar_por_tope(p_paso uuid, p_intento integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_pedido uuid; v_gasto numeric; v_tope numeric;
begin
  update public.fab_pasos
     set estado = 'pendiente', intento = greatest(intento - 1, 0), tomado_at = null
   where id = p_paso and estado = 'corriendo' and intento = p_intento
   returning pedido_id into v_pedido;
  if v_pedido is null then return false; end if;
  update public.fab_pedidos set estado = 'en_espera'
   where id = v_pedido and estado = 'en_marcha'
   returning gasto_usd, tope_usd into v_gasto, v_tope;
  if v_gasto is null then
    select gasto_usd, tope_usd into v_gasto, v_tope from public.fab_pedidos where id = v_pedido;
  end if;
  insert into public.fab_previas (pedido_id, tipo, titulo, detalle, datos)
  values (v_pedido, 'tope_gasto', 'Llegó al tope de gasto en IA',
          format('Lleva gastados US$ %s de un tope de US$ %s.', round(v_gasto, 2), v_tope),
          jsonb_build_object('gasto', v_gasto, 'tope', v_tope))
  on conflict (pedido_id, tipo) where estado = 'pendiente' do nothing;
  return true;
end $$;

-- Resuelve una Previa una sola vez (un doble clic no duplica nada) y encola lo que sigue.
create or replace function public.fab_resolver_previa(
  p_previa uuid,
  p_respuesta jsonb,
  p_siguientes jsonb default '[]'::jsonb,
  p_pedido_estado text default null,
  p_pedido_etapa text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_pedido uuid; s jsonb;
begin
  update public.fab_previas
     set estado = 'resuelta', respuesta = p_respuesta, resuelta_at = now()
   where id = p_previa and estado = 'pendiente'
   returning pedido_id into v_pedido;
  if v_pedido is null then return false; end if;

  for s in select * from jsonb_array_elements(coalesce(p_siguientes, '[]'::jsonb)) loop
    insert into public.fab_pasos (pedido_id, tipo, entrada, max_intentos)
    values (v_pedido, s->>'tipo', coalesce(s->'entrada', '{}'::jsonb), coalesce((s->>'max_intentos')::int, 3));
  end loop;

  update public.fab_pedidos
     set estado = coalesce(p_pedido_estado, estado),
         etapa = coalesce(p_pedido_etapa, etapa),
         terminado_at = case when p_pedido_estado in ('listo','cancelado') then now() else terminado_at end
   where id = v_pedido;
  return true;
end $$;

create or replace function public.fab_sumar_costo(p_pedido uuid, p_paso uuid, p_usd numeric)
returns numeric language sql security definer set search_path = '' as $$
  update public.fab_pasos set costo_usd = costo_usd + p_usd where id = p_paso;
  update public.fab_pedidos set gasto_usd = gasto_usd + p_usd where id = p_pedido returning gasto_usd;
$$;

-- Asigna el próximo QR libre del lote (o el que ya tenía el pedido) y lo activa con el link.
-- En pedidos simulados nunca toca qr.codes.
create or replace function public.fab_asignar_qr(p_pedido uuid, p_url text, p_etiqueta text, p_simular boolean default false)
returns table (n integer, codigo text, lote text)
language plpgsql security definer set search_path = '' as $$
declare
  v public.fab_qr_lote%rowtype;
  v_url text := btrim(coalesce(p_url, ''));
  v_simular boolean := p_simular;
begin
  if length(v_url) > 2000 or v_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'Link inválido para el QR: %', left(v_url, 200);
  end if;
  if exists (select 1 from public.fab_pedidos p where p.id = p_pedido and p.simulado) then
    v_simular := true;
  end if;

  select l.* into v from public.fab_qr_lote l where l.pedido_id = p_pedido limit 1;
  if not found then
    select l.* into v
      from public.fab_qr_lote l
      join qr.codes c on c.code = l.codigo
     where l.estado = 'libre' and c.url is null
     order by l.lote, l.n
     limit 1
     for update of l skip locked;
    if not found then
      raise exception 'No quedan QR libres en el lote';
    end if;
  end if;

  if not v_simular then
    update public.fab_qr_lote l
       set estado = 'asignado', pedido_id = p_pedido, comercio = left(p_etiqueta, 120),
           asignado_at = coalesce(l.asignado_at, now())
     where l.codigo = v.codigo;
    update qr.codes c
       set url = v_url, label = left(p_etiqueta, 120), updated_at = now(),
           activated_at = coalesce(c.activated_at, now())
     where c.code = v.codigo;
    update public.fab_pedidos p set qr_codigo = v.codigo where p.id = p_pedido;
  end if;

  return query select v.n, v.codigo, v.lote;
end $$;

-- Latido del cron: si hay pasos esperando (o colgados), despierta al motor de la app.
create or replace function public.fab_tick()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secreto text; v_n integer;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'fab_app_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'fab_motor_secret';
  if v_url is null or v_secreto is null then return 0; end if;

  select count(*) into v_n
    from public.fab_pasos s
    join public.fab_pedidos p on p.id = s.pedido_id
   where p.estado = 'en_marcha'
     and ((s.estado = 'pendiente' and s.disponible_desde <= now())
       or (s.estado = 'corriendo' and s.tomado_at < now() - interval '330 seconds'));
  if v_n = 0 then return 0; end if;

  for i in 1..least(v_n, 3) loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/api/motor',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secreto, 'Content-Type', 'application/json'),
      timeout_milliseconds := 8000
    );
  end loop;
  return least(v_n, 3);
end $$;

-- ───────────────────────── Permisos ─────────────────────────

alter table public.fab_comercios enable row level security;
alter table public.fab_pedidos enable row level security;
alter table public.fab_pasos enable row level security;
alter table public.fab_previas enable row level security;
alter table public.fab_conceptos enable row level security;
alter table public.fab_versiones enable row level security;
alter table public.fab_inspiracion enable row level security;
alter table public.fab_archivos enable row level security;
alter table public.fab_eventos enable row level security;
alter table public.fab_qr_lote enable row level security;
alter table public.fab_preferencias enable row level security;

revoke all on table
  public.fab_comercios, public.fab_pedidos, public.fab_pasos, public.fab_previas, public.fab_conceptos,
  public.fab_versiones, public.fab_inspiracion, public.fab_archivos, public.fab_eventos,
  public.fab_qr_lote, public.fab_preferencias
from anon, authenticated;

grant select, insert, update, delete on table
  public.fab_comercios, public.fab_pedidos, public.fab_pasos, public.fab_previas, public.fab_conceptos,
  public.fab_versiones, public.fab_inspiracion, public.fab_archivos, public.fab_eventos,
  public.fab_qr_lote, public.fab_preferencias
to service_role;

revoke all on function
  public.fab_tocar(),
  public.fab_fallo_generico(uuid, text),
  public.fab_tomar_paso(integer),
  public.fab_cerrar_paso(uuid, integer, text, jsonb, text, jsonb, jsonb, text, text, text[]),
  public.fab_reprogramar_paso(uuid, integer, text, integer),
  public.fab_frenar_por_tope(uuid, integer),
  public.fab_resolver_previa(uuid, jsonb, jsonb, text, text),
  public.fab_sumar_costo(uuid, uuid, numeric),
  public.fab_asignar_qr(uuid, text, text, boolean),
  public.fab_tick()
from public, anon, authenticated;

grant execute on function
  public.fab_fallo_generico(uuid, text),
  public.fab_tomar_paso(integer),
  public.fab_cerrar_paso(uuid, integer, text, jsonb, text, jsonb, jsonb, text, text, text[]),
  public.fab_reprogramar_paso(uuid, integer, text, integer),
  public.fab_frenar_por_tope(uuid, integer),
  public.fab_resolver_previa(uuid, jsonb, jsonb, text, text),
  public.fab_sumar_costo(uuid, uuid, numeric),
  public.fab_asignar_qr(uuid, text, text, boolean)
to service_role;

-- Latido cada minuto (no hace nada hasta que estén cargados los secretos fab_app_url y fab_motor_secret en Vault).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('fab-motor', '* * * * *', 'select public.fab_tick()');
  end if;
end $$;

-- Bucket privado para logos, fotos, inspiración, vistas previas y entregables.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fabrica', 'fabrica', false, 52428800)
on conflict (id) do nothing;
