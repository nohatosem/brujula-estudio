-- Brújula: diagnóstico de acceso a datos de usuarios, solo lectura.
-- Ejecutar en Supabase SQL Editor. No introduce ni modifica registros.
select c.relname as tabla, c.relrowsecurity as rls_activado, c.relforcerowsecurity as rls_forzado
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='brujula_user_state';

select policyname, permissive, roles, cmd, qual as condicion_lectura, with_check as condicion_escritura
from pg_policies
where schemaname='public' and tablename='brujula_user_state'
order by cmd, policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='brujula_user_state'
and grantee in ('anon','authenticated')
order by grantee, privilege_type;

-- Esperado: RLS activado; politicas por auth.uid()=user_id;
-- anon sin permisos sobre la tabla y authenticated con permisos bajo RLS.
-- La comprobacion real A/B requiere DOS cuentas reales y sesion autenticada.
