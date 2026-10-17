-- Brújula 4 · Quitar los avisos con la app cerrada (reversión completa de push-*.sql).
-- No afecta a brujula_user_state: tu horario y avances quedan intactos.
-- Después, en la app: Ajustes → Avisos → desactiva «Con la app cerrada» (o ignóralo:
-- sin la función, Brújula vuelve sola a los avisos locales).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'brujula-push') then
    perform cron.unschedule('brujula-push');
  end if;
exception when others then raise notice 'cron: %', sqlerrm;
end $$;
do $$ begin
  delete from vault.secrets where name = 'brujula_cron_secret';
exception when others then raise notice 'vault: %', sqlerrm;
end $$;
drop function if exists public.brujula_push_claim(integer);
drop table if exists public.brujula_push_queue;
drop table if exists public.brujula_push_subscriptions;
drop table if exists public.brujula_push_meta;
drop table if exists public.brujula_push_health;
-- Por último, si quieres: supabase functions delete brujula-push
