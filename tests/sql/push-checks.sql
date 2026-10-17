-- Comprobaciones del SQL de avisos push (se ejecutan después de push-instalar.sql).
\set ON_ERROR_STOP 1
create or replace function pg_temp.expect_denied(q text) returns void language plpgsql as $$
begin
  begin execute q; exception when insufficient_privilege then return; end;
  raise exception 'debía rechazarse: %', q;
end $$;

-- 1) El navegador (anon / authenticated) no puede leer, escribir ni reservar.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect_denied('select count(*) from public.brujula_push_queue');
select pg_temp.expect_denied('select count(*) from public.brujula_push_subscriptions');
select pg_temp.expect_denied($q$insert into public.brujula_push_queue (user_id, tag, fire_at, expire_at, title) values ('11111111-1111-1111-1111-111111111111', 'x', now(), now() + interval '5 min', 't')$q$);
select pg_temp.expect_denied('select public.brujula_push_claim(10)');
reset role;
set role anon;
select pg_temp.expect_denied('select count(*) from public.brujula_push_meta');
reset role;

-- 2) La función (service_role) reserva lo que toca, una sola vez.
set role service_role;
insert into public.brujula_push_queue (user_id, tag, fire_at, expire_at, title) values
  ('11111111-1111-1111-1111-111111111111', 'ahora',   now() - interval '20 seconds', now() + interval '10 min', 'Ahora'),
  ('11111111-1111-1111-1111-111111111111', 'en-30s',  now() + interval '30 seconds', now() + interval '10 min', 'En 30 s'),
  ('11111111-1111-1111-1111-111111111111', 'luego',   now() + interval '10 min',     now() + interval '20 min', 'Luego'),
  ('22222222-2222-2222-2222-222222222222', 'vencido', now() - interval '30 min',     now() - interval '1 min',  'Vencido'),
  ('22222222-2222-2222-2222-222222222222', 'viejo',   now() - interval '5 days',     now() - interval '5 days', 'Viejo');
update public.brujula_push_queue set sent_at = now() - interval '4 days', status = 'sent' where tag = 'viejo';
do $$ declare got text; begin
  select string_agg(tag, ',' order by tag) into got from public.brujula_push_claim(100);
  if got is distinct from 'ahora,en-30s' then raise exception 'reserva esperada ahora,en-30s; obtenido %', got; end if;
  if (select count(*) from public.brujula_push_claim(100)) <> 0 then raise exception 'la segunda llamada no debe repetir avisos'; end if;
  if (select status from public.brujula_push_queue where tag = 'vencido') <> 'expired' then raise exception 'el aviso vencido debe marcarse expired'; end if;
  if exists (select 1 from public.brujula_push_queue where tag = 'viejo') then raise exception 'lo enviado hace más de 3 días debe borrarse'; end if;
  if (select sent_at from public.brujula_push_queue where tag = 'luego') is not null then raise exception 'lo futuro no se reserva'; end if;
end $$;

-- 3) Reencolar algo ya enviado (ON CONFLICT DO NOTHING) no lo duplica ni lo reactiva.
insert into public.brujula_push_queue (user_id, tag, fire_at, expire_at, title)
  values ('11111111-1111-1111-1111-111111111111', 'ahora', now(), now() + interval '5 min', 'otra vez')
  on conflict (user_id, tag) do nothing;
do $$ begin
  if (select count(*) from public.brujula_push_queue where tag = 'ahora') <> 1 then raise exception 'duplicado'; end if;
  if (select title from public.brujula_push_queue where tag = 'ahora') <> 'Ahora' then raise exception 'no debía reemplazarse'; end if;
end $$;

-- 4) Restricciones de tamaño y valores.
do $$ begin
  begin
    insert into public.brujula_push_queue (user_id, tag, fire_at, expire_at, title) values ('11111111-1111-1111-1111-111111111111', 'largo', now(), now(), repeat('x', 121));
    raise exception 'título de 121 caracteres debía rechazarse';
  exception when check_violation then null; end;
  begin
    insert into public.brujula_push_subscriptions (user_id, endpoint, p256dh, auth) values ('11111111-1111-1111-1111-111111111111', 'https://fcm.googleapis.com/a', 'k', 'a'),
                                                                                     ('22222222-2222-2222-2222-222222222222', 'https://fcm.googleapis.com/a', 'k', 'a');
    raise exception 'un mismo navegador no puede quedar en dos cuentas';
  exception when unique_violation then null; end;
end $$;
reset role;

-- 5) Borrar una cuenta borra sus avisos y dispositivos (on delete cascade).
set role service_role;
insert into public.brujula_push_subscriptions (user_id, endpoint, p256dh, auth) values ('22222222-2222-2222-2222-222222222222', 'https://fcm.googleapis.com/b', 'k', 'a');
reset role;
delete from public.brujula_user_state where user_id = '22222222-2222-2222-2222-222222222222';
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if exists (select 1 from public.brujula_push_queue where user_id = '22222222-2222-2222-2222-222222222222') then raise exception 'cola huérfana'; end if;
  if exists (select 1 from public.brujula_push_subscriptions where user_id = '22222222-2222-2222-2222-222222222222') then raise exception 'dispositivo huérfano'; end if;
end $$;
select 'comprobaciones de avisos push: OK' as resultado;
