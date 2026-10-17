-- Brújula 4 · Diagnóstico de avisos push (solo lectura).
select c.relname as tabla, c.relrowsecurity as rls_activado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'brujula_push_%' order by 1;

-- Debe salir vacío: ninguna política abre estas tablas al navegador.
select tablename, policyname from pg_policies where schemaname = 'public' and tablename like 'brujula_push_%';

-- Debe salir vacío: anon/authenticated sin permisos directos.
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'brujula_push_%' and grantee in ('anon', 'authenticated');

-- Estado del envío programado (last_run_at debería tener menos de 2 minutos).
select last_run_at, last_claimed, last_sent, last_failed from public.brujula_push_health;

-- Cuántos dispositivos y avisos pendientes hay (sin mostrar contenido).
select (select count(*) from public.brujula_push_subscriptions) as dispositivos,
       (select count(*) from public.brujula_push_queue where sent_at is null) as pendientes;
