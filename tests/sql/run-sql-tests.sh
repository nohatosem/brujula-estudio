#!/usr/bin/env bash
# Prueba el SQL de avisos push contra un PostgreSQL local (no toca Supabase).
# Crea una base temporal con una simulación mínima de Supabase y la borra al terminar.
# Uso: PGHOST=… PGPORT=… PGUSER=postgres bash tests/sql/run-sql-tests.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; sql="$here/../../supabase/sql"
db="brujula_prueba_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null || { echo "No se pudo crear la base de prueba"; exit 1; }
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
P="psql -q -v ON_ERROR_STOP=1 -d $db"
pass=0; fail=0
step() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then echo "ok - $name"; pass=$((pass + 1)); else echo "FALLO - $name"; fail=$((fail + 1)); fi; }

$P -f "$here/supabase-stub.sql" >/dev/null 2>&1 || { echo "No se pudo preparar la simulación de Supabase"; exit 1; }
step "instalar dos veces (idempotente)" bash -c "$P -f '$sql/push-instalar.sql' && $P -f '$sql/push-instalar.sql'"
step "permisos, reserva única, vencidos, limpieza, restricciones y borrado en cascada" bash -c "$P -f '$here/push-checks.sql' | grep -q 'comprobaciones de avisos push: OK'"
step "diagnóstico de solo lectura" $P -f "$sql/push-verificar.sql"
step "revertir quita todo y deja brujula_user_state intacta" bash -c "$P -f '$sql/push-revertir.sql' && [ \"\$($P -tAc \"select count(*) from pg_class where relname like 'brujula_push_%' and relkind = 'r'\")\" = 0 ] && [ \"\$($P -tAc 'select count(*) from public.brujula_user_state')\" = 1 ]"
step "se puede reinstalar después de revertir" $P -f "$sql/push-instalar.sql"

echo "$pass/$((pass + fail)) pruebas SQL correctas"
[ "$fail" -eq 0 ]
