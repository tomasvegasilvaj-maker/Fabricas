-- Latido del motor sin copiar claves a mano:
-- * la URL de producción la anota la app sola en fab_config (no es secreta);
-- * la clave del cron vive solo en Vault como fab_motor_secret (se crea una vez con el SQL del README);
-- * la app lee esa clave con fab_secreto_motor() para aceptar los llamados del cron.

create table if not exists public.fab_config (
  clave text primary key,
  valor text not null,
  updated_at timestamptz not null default now()
);

alter table public.fab_config enable row level security;
revoke all on table public.fab_config from anon, authenticated;
grant select, insert, update, delete on table public.fab_config to service_role;

create or replace function public.fab_tick()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secreto text; v_n integer;
begin
  select c.valor into v_url from public.fab_config c where c.clave = 'app_url';
  if v_url is null then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'fab_app_url';
  end if;
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

create or replace function public.fab_secreto_motor()
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'fab_motor_secret' limit 1;
$$;

-- Para Ajustes: a qué URL llama el latido, si ya tiene clave y cuándo corrió por última vez.
create or replace function public.fab_estado_latido()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'url', coalesce(
      (select c.valor from public.fab_config c where c.clave = 'app_url'),
      (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'fab_app_url' limit 1)
    ),
    'clave', exists (select 1 from vault.secrets s where s.name = 'fab_motor_secret'),
    'ultima', (select max(d.end_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'fab-motor')
  );
$$;

revoke all on function public.fab_secreto_motor(), public.fab_estado_latido() from public, anon, authenticated;
grant execute on function public.fab_secreto_motor(), public.fab_estado_latido() to service_role;
