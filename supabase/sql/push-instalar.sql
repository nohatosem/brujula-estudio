-- Brújula 4 · Avisos con la app cerrada (Web Push) — OPCIONAL / EXPERIMENTAL.
-- Ejecutar UNA vez en Supabase → SQL Editor. Es idempotente (se puede repetir).
-- NO toca brujula_user_state ni ninguna tabla existente. Reversión: push-revertir.sql.
--
-- Diseño de privacidad:
--  * La función «brujula-push» NUNCA lee tu horario completo. El navegador calcula los
--    próximos avisos (máx. 60, 8 días: hora, título y curso) y los guarda en la cola.
--  * Las tablas quedan cerradas para anon/authenticated (RLS activado y sin políticas):
--    solo la Edge Function, con la clave service_role que Supabase le inyecta, puede
--    leerlas o escribirlas, y siempre filtrando por el usuario de la sesión verificada.
--  * Los avisos enviados se borran a los 3 días.

create table if not exists public.brujula_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 120),
  auth text not null check (char_length(auth) <= 40),
  device text check (char_length(device) <= 60),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures integer not null default 0
);
create index if not exists brujula_push_subscriptions_user on public.brujula_push_subscriptions (user_id);

create table if not exists public.brujula_push_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null check (char_length(tag) <= 100),
  fire_at timestamptz not null,
  expire_at timestamptz not null,
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 240),
  url text not null default './index.html#/hoy' check (char_length(url) <= 220),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'expired')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, tag)
);
create index if not exists brujula_push_queue_due on public.brujula_push_queue (fire_at) where sent_at is null;

create table if not exists public.brujula_push_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.brujula_push_health (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_claimed integer not null default 0,
  last_sent integer not null default 0,
  last_failed integer not null default 0
);

alter table public.brujula_push_subscriptions enable row level security;
alter table public.brujula_push_queue enable row level security;
alter table public.brujula_push_meta enable row level security;
alter table public.brujula_push_health enable row level security;
revoke all on table public.brujula_push_subscriptions, public.brujula_push_queue, public.brujula_push_meta, public.brujula_push_health from anon, authenticated;

-- Reserva los avisos que tocan (con bloqueo para que dos ejecuciones no envíen lo mismo),
-- marca como vencidos los que ya no sirven y limpia lo enviado hace más de 3 días.
create or replace function public.brujula_push_claim(p_limit integer default 100)
returns setof public.brujula_push_queue
language plpgsql
set search_path = public
as $$
begin
  update public.brujula_push_queue set status = 'expired', sent_at = now()
    where sent_at is null and expire_at <= now();
  delete from public.brujula_push_queue where sent_at < now() - interval '3 days';
  return query
    update public.brujula_push_queue q set status = 'sending', sent_at = now()
    where q.id in (
      select id from public.brujula_push_queue
      where sent_at is null and fire_at <= now() + interval '45 seconds' and expire_at > now()
      order by fire_at
      limit greatest(1, least(coalesce(p_limit, 100), 300))
      for update skip locked)
    returning q.*;
end;
$$;
revoke all on function public.brujula_push_claim(integer) from public, anon, authenticated;
grant execute on function public.brujula_push_claim(integer) to service_role;
