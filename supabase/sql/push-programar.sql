-- Brújula 4 · Programar el envío de avisos (cada minuto) — OPCIONAL.
-- Requisitos: push-instalar.sql ejecutado, función «brujula-push» desplegada con sus
-- secretos, y las extensiones pg_cron y pg_net activas (Database → Extensions).
--
-- 1) Guarda en Vault el MISMO valor que pusiste en el secreto BRUJULA_CRON_SECRET de la
--    función. Sustituye el texto entre comillas antes de ejecutar y NO guardes este archivo
--    con tu secreto en el repositorio (es público).
select vault.create_secret('PEGA_AQUI_TU_BRUJULA_CRON_SECRET', 'brujula_cron_secret', 'Secreto del cron de avisos de Brújula');

-- 2) Programa la llamada. Cambia la URL solo si usas otro proyecto de Supabase.
select cron.schedule(
  'brujula-push',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://qqnawpbcaxooytizhsfq.supabase.co/functions/v1/brujula-push',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-brujula-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'brujula_cron_secret' limit 1)
    ),
    body := '{"action":"dispatch"}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Comprobar: select jobid, schedule, active from cron.job where jobname = 'brujula-push';
-- Últimas ejecuciones: select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'brujula-push') order by start_time desc limit 5;
-- Respuestas HTTP: select status_code, content, created from net._http_response order by created desc limit 5;
