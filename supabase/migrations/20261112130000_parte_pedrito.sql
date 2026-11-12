-- Fábrica de placas · Parte automático a Pedrito y correcciones que vuelven de Pedrito
--
-- 1) fab_reglas_agente (la tabla que ya existe, sin tabla paralela):
--    * «pedrito» pasa a ser un agente válido (reglas para el jefe del equipo).
--    * origen: de dónde salió la regla ('linea' = la guardó un agente en un pedido; 'pedrito' = llegó por /api/parte/correcciones).
--    * motivo: de qué fallo o parte sale, en una frase.
--    * reemplaza_a: la regla vieja que esta reemplaza (la vieja queda apagada con activo = false).
-- 2) fab_parte_ultimo: el último parte enviado, para mandar solo cuando cambia algo o hay un error.
-- 3) Chequeo de respaldo cada 30 minutos desde Supabase (además del Vercel Cron diario).

alter table public.fab_reglas_agente drop constraint if exists fab_reglas_agente_agente_check;
alter table public.fab_reglas_agente
  add constraint fab_reglas_agente_agente_check check (agente in ('ideas', 'diseno', 'estructura', 'produccion', 'pedrito'));

alter table public.fab_reglas_agente
  add column if not exists origen text not null default 'linea' check (origen in ('linea', 'pedrito')),
  add column if not exists motivo text check (motivo is null or length(motivo) <= 300),
  add column if not exists reemplaza_a uuid references public.fab_reglas_agente(id) on delete set null;

-- Guarda las correcciones de Pedrito de una sola vez (todas o ninguna).
-- p_correcciones: [{agente, regla, reemplaza_a, motivo}]. Devuelve una fila por corrección.
create or replace function public.fab_guardar_correcciones(p_pedido uuid, p_correcciones jsonb)
returns table (id uuid, agente text, texto text, reemplaza_a uuid, ya_existia boolean)
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb;
  v_agente text;
  v_texto text;
  v_motivo text;
  v_reemplaza uuid;
  v_vieja public.fab_reglas_agente%rowtype;
  v_prueba boolean := false;
  v_id uuid;
  v_existia boolean;
begin
  if p_pedido is not null then
    select p.simulado into v_prueba from public.fab_pedidos p where p.id = p_pedido;
    if not found then raise exception 'pedido_id % no existe', p_pedido using errcode = 'P0002'; end if;
  end if;

  for c in select * from jsonb_array_elements(p_correcciones) loop
    v_agente := c->>'agente';
    v_texto := btrim(c->>'regla');
    v_motivo := nullif(btrim(coalesce(c->>'motivo', '')), '');
    v_reemplaza := nullif(c->>'reemplaza_a', '')::uuid;
    v_existia := false;

    if v_reemplaza is not null then
      select * into v_vieja from public.fab_reglas_agente r where r.id = v_reemplaza for update;
      if not found then raise exception 'reemplaza_a % no existe', v_reemplaza using errcode = 'P0002'; end if;
      if v_vieja.agente <> v_agente then
        raise exception 'la regla % es de %, no de %', v_reemplaza, v_vieja.agente, v_agente using errcode = '22023';
      end if;
      update public.fab_reglas_agente r set activo = false where r.id = v_reemplaza;
    end if;

    -- Si ya hay una regla prendida con el mismo texto para ese agente, no se duplica.
    select r.id into v_id from public.fab_reglas_agente r
     where r.agente = v_agente and r.prueba = v_prueba and r.activo and lower(btrim(r.texto)) = lower(v_texto)
     limit 1;
    if found then
      v_existia := true;
    else
      insert into public.fab_reglas_agente (agente, texto, pedido_id, prueba, origen, motivo, reemplaza_a)
      values (v_agente, v_texto, p_pedido, v_prueba, 'pedrito', v_motivo, v_reemplaza)
      returning fab_reglas_agente.id into v_id;
    end if;

    id := v_id; agente := v_agente; texto := v_texto; reemplaza_a := v_reemplaza; ya_existia := v_existia;
    return next;
  end loop;
end $$;

-- ───────────────────────── Último parte enviado ─────────────────────────

create table if not exists public.fab_parte_ultimo (
  id smallint primary key default 1 check (id = 1),
  -- Huella del estado (métricas, pedidos, errores, Gemini/A4): si no cambia, no se manda.
  firma text,
  parte jsonb,
  motivo text,
  enviado_at timestamptz,
  -- Último intento (aunque no se haya mandado): para ver en Ajustes si el webhook falla.
  intento_at timestamptz,
  error text,
  updated_at timestamptz not null default now()
);
insert into public.fab_parte_ultimo (id) values (1) on conflict do nothing;

-- Toma el envío: solo un trabajador gana cuando la huella cambió (deduplica envíos en paralelo).
-- Devuelve la huella anterior (para poder devolverla si el envío falla) o null si no hay que mandar nada.
create or replace function public.fab_parte_reclamar(p_firma text, p_forzar boolean default false)
returns table (reclamado boolean, firma_anterior text)
language plpgsql security definer set search_path = '' as $$
declare v_anterior text;
begin
  select u.firma into v_anterior from public.fab_parte_ultimo u where u.id = 1 for update;
  if not p_forzar and v_anterior is not distinct from p_firma then
    return query select false, v_anterior;
    return;
  end if;
  update public.fab_parte_ultimo u set firma = p_firma, intento_at = now(), updated_at = now() where u.id = 1;
  return query select true, v_anterior;
end $$;

alter table public.fab_parte_ultimo enable row level security;
revoke all on table public.fab_parte_ultimo from anon, authenticated;
grant select, insert, update, delete on table public.fab_parte_ultimo to service_role;

revoke all on function public.fab_guardar_correcciones(uuid, jsonb), public.fab_parte_reclamar(text, boolean) from public, anon, authenticated;
grant execute on function public.fab_guardar_correcciones(uuid, jsonb), public.fab_parte_reclamar(text, boolean) to service_role;

-- ───────────────────────── Chequeo de respaldo ─────────────────────────
-- Cada 30 minutos le pide a la app que revise el estado. La app manda el parte solo si cambió algo o hay un error.
-- Usa la misma URL y la misma clave de Vault que el latido del motor (no hay claves nuevas).

create or replace function public.fab_chequeo_parte()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secreto text;
begin
  select c.valor into v_url from public.fab_config c where c.clave = 'app_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'fab_motor_secret';
  if v_url is null or v_secreto is null then return false; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/parte/chequeo',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secreto, 'Content-Type', 'application/json'),
    timeout_milliseconds := 8000
  );
  return true;
end $$;

revoke all on function public.fab_chequeo_parte() from public, anon, authenticated;
grant execute on function public.fab_chequeo_parte() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('fab-parte', '*/30 * * * *', 'select public.fab_chequeo_parte()');
  end if;
end $$;
