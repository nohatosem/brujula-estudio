# Avisos con la app cerrada (beta)

Sin esta configuración, Brújula avisa antes de cada actividad **mientras está abierta o recién minimizada**. Con ella, los avisos llegan aunque la cierres, usando Web Push estándar. Todo es opcional, gratuito y reversible.

> **Estado: experimental.** El cifrado, la firma VAPID, la función y el SQL tienen pruebas automáticas (ver [PRUEBAS.md](PRUEBAS.md)), pero **no se ha probado de punta a punta con servicios de push reales** (Google, Apple, Mozilla) ni en tu proyecto de Supabase. Actívalo primero en un dispositivo y comprueba el aviso de prueba antes de confiar en él.

## Cómo funciona

1. Al activarlo en **Ajustes → Avisos → También con la app cerrada**, el navegador crea una suscripción de push para ese dispositivo y Brújula la registra en la función `brujula-push`.
2. Cada vez que cambia tu plan, el dispositivo calcula los avisos de los próximos 7 días (máximo 60) y envía solo eso: hora, título y curso de cada actividad, más el enlace interno. **Nunca** se envían notas, diario, temas ni el horario completo, y la función nunca lee `brujula_user_state`.
3. Una tarea programada (`pg_cron`) llama a la función cada minuto. La función reserva los avisos que tocan, los cifra de extremo a extremo (RFC 8291) y los entrega al servicio de push del navegador, que no puede leer su contenido.
4. Si el envío programado deja de responder, la app lo detecta y vuelve a usar los avisos locales. Cuando el servidor funciona, el aviso local se omite para no duplicarlo.

**Coste:** cero. Una llamada por minuto son unas 43 000 invocaciones al mes, por debajo del límite gratuito de Edge Functions de Supabase (consulta los límites vigentes de tu plan). `pg_cron` y `pg_net` están incluidos.

**Compatibilidad:** Chrome, Edge y Samsung Internet en Android; Chrome, Edge y Firefox en computadora. En iPhone/iPad (iOS 16.4 o posterior), solo si Brújula está instalada en la pantalla de inicio y la abres desde ese ícono.

## Instalación (una vez)

### 1. Tablas y función SQL

Supabase → **SQL Editor** → pega y ejecuta `supabase/sql/push-instalar.sql`. Crea cuatro tablas nuevas cerradas al navegador (RLS activado, sin políticas, sin permisos para `anon`/`authenticated`) y la función `brujula_push_claim()`, ejecutable solo por `service_role`. No toca ninguna tabla existente y se puede ejecutar dos veces sin problema.

### 2. Claves VAPID y secreto del cron

En tu computadora, dentro de la carpeta del proyecto (requiere Node 20 o posterior):

```bash
node tools/vapid-keys.mjs tu-correo@ejemplo.com
```

El script solo **imprime** cuatro valores; no escribe ningún archivo. Guárdalos en Supabase → **Edge Functions → Secrets** (o con `supabase secrets set …`, como muestra el script):

| Secreto | Qué es |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Clave pública (la ve el navegador; no es secreta) |
| `VAPID_PRIVATE_KEY` | Clave privada: **nunca** en GitHub ni en el código |
| `VAPID_SUBJECT` | `mailto:` con tu correo de contacto |
| `BRUJULA_CRON_SECRET` | Contraseña larga que solo conocen el cron y la función |

La función usa además `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, que Supabase inyecta solo en las Edge Functions. Si tu proyecto no la ofrece con ese nombre, crea el secreto `BRUJULA_PUSH_SERVICE_KEY` con tu clave secreta (`sb_secret_…`).

### 3. Desplegar la función

```bash
supabase functions deploy brujula-push --no-verify-jwt
```

`--no-verify-jwt` es necesario porque el cron no tiene sesión de usuario. La función verifica por sí misma: cada acción del navegador exige una sesión válida de Supabase Auth (comprobada con `auth.getUser`) y un origen permitido; el envío exige `BRUJULA_CRON_SECRET`. Si usas otro dominio para la app, añádelo en `BRUJULA_ALLOWED_ORIGINS`, igual que en `brujula-ai`.

Desde el panel también puedes crear la función `brujula-push`, pegar `supabase/functions/brujula-push/index.ts`, desactivar **Verify JWT** y desplegar.

### 4. Programar el envío

1. Supabase → **Database → Extensions**: activa `pg_cron` y `pg_net`.
2. SQL Editor → abre `supabase/sql/push-programar.sql`, sustituye `PEGA_AQUI_TU_BRUJULA_CRON_SECRET` por el mismo valor del secreto y ejecútalo. El secreto queda en **Vault**, no en el texto de la tarea. No guardes ese archivo editado en el repositorio.

### 5. Activarlo en cada dispositivo

1. Abre Brújula → **Ajustes → Avisos**. La fila **También con la app cerrada** debe decir «Llegan aunque cierres Brújula…».
2. Actívala y acepta el permiso de notificaciones. Debe llegar el aviso «Avisos activados».
3. Pulsa **Enviar aviso de prueba**, cierra Brújula y espera unos segundos.
4. Repite en cada dispositivo donde quieras avisos. Al **cerrar sesión**, ese dispositivo se da de baja automáticamente (útil en equipos compartidos).

## Comprobar

- `supabase/sql/push-verificar.sql` (solo lectura): RLS activado, ninguna política ni permiso para el navegador, y `last_run_at` con menos de 2 minutos.
- En la app, si ves «el envío programado del servidor no responde», revisa el paso 4: `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.
- Respuestas de la función: `select status_code, content from net._http_response order by created desc limit 5;`. Un 401 significa que el secreto del cron no coincide.

## Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| «El servidor de avisos no está desplegado todavía» | Falta el paso 3 |
| «Falta configurar el servidor de avisos» | Faltan secretos VAPID o la clave de servicio (paso 2) |
| El interruptor no aparece en iPhone | Instala Brújula en la pantalla de inicio desde Safari y ábrela desde ahí |
| Llega el aviso de prueba pero no los de las actividades | El cron no corre (paso 4) o la anticipación es mayor que el tiempo que falta |
| No llega nada en Android | Ahorro de batería o notificaciones del sitio bloqueadas en los ajustes de Chrome |
| Cambié las claves VAPID | Desactiva y vuelve a activar los avisos en cada dispositivo |

## Quitarlo por completo

1. SQL Editor → `supabase/sql/push-revertir.sql` (quita la tarea programada, el secreto de Vault, las tablas y la función SQL).
2. `supabase functions delete brujula-push` y borra los secretos `VAPID_*` y `BRUJULA_CRON_SECRET`.
3. En la app no hace falta nada: sin servidor, Brújula vuelve sola a los avisos locales. Tu horario no se ve afectado.
