# Integrar Brújula 4.0 sin perder datos

Tiempo estimado: 20–30 minutos. Tus datos no se mueven de sitio: siguen en la tabla `brujula_user_state` de Supabase y en el navegador, con el mismo formato base (`version: 2`). La versión 4 solo **añade** campos (temas, evaluaciones, dificultades, hábitos, deshacer) y guarda una copia local antes de migrar. Brújula 3.9 puede seguir leyendo esos datos, así que la reversión también es segura (hay una prueba automática que lo comprueba).

La app (GitHub Pages) y la función de Gemini (Supabase) se actualizan **por separado** y en cualquier orden: la 4.0 funciona con la función antigua (usa su modo compatible) y la función nueva sigue aceptando las llamadas de la 3.9.

---

## 1. Copias de seguridad (antes de tocar nada)

1. **Copia de tu plan.** En el dispositivo donde tengas lo más reciente, abre Brújula 3.9 → **Nube y datos** → **↓ Descargar copia JSON**. Guarda el archivo en Drive o en tu computadora. No lo subas al repositorio (es público).
2. **Copia de la tabla (opcional, recomendada).** En Supabase → **SQL Editor**, ejecuta:

   ```sql
   create table public.brujula_user_state_respaldo_3_9 as select * from public.brujula_user_state;
   -- Imprescindible: que la copia NO quede expuesta por la API pública.
   alter table public.brujula_user_state_respaldo_3_9 enable row level security;
   revoke all on table public.brujula_user_state_respaldo_3_9 from anon, authenticated;
   ```

   Cuando todo funcione unas semanas, puedes borrarla con `drop table public.brujula_user_state_respaldo_3_9;`.
3. **Copia del código.** Tu repositorio ya guarda la 3.9 en su historial. Si quieres, descarga además el ZIP actual desde GitHub (**Code → Download ZIP**).

## 2. Subir la app a GitHub

### Opción A: desde la web de GitHub (con una solicitud de cambios, para poder revertir con un clic)

1. Descomprime `brujula-4.0.zip`. Verás una carpeta `brujula` con `index.html`, `css/`, `js/`, etc.
2. En GitHub, abre tu repositorio `brujula-estudio` → **Add file → Upload files**.
3. Arrastra **el contenido** de la carpeta `brujula` (no la carpeta en sí): todos los archivos y subcarpetas. Los archivos con el mismo nombre se reemplazan (`index.html`, `sw.js`, `manifest.webmanifest`, `actualizar.html`, `brujula-actualizada.html`, `icon.svg`, `README.md`, `supabase/functions/brujula-ai/index.ts`) y el resto se añade.
4. Abajo, mensaje: `Brújula 4.0`. Elige **Create a new branch for this commit and start a pull request**, nombra la rama `brujula-4` y pulsa **Propose changes** → **Create pull request**. Todavía no se publica nada.
5. **Borra en esa rama los archivos de la 3.9 que ya no se usan** (recomendable: el repositorio es público y confunden): `brujula-flotante.css`, `brujula-flotante.js`, `brujula-ia.css`, `brujula-ia.js`, `brujula-mejoras.css`, `brujula-mejoras.js`, `brujula-modos.css`, `brujula-modos.js` y `brujula-voz.js`. Cambia a la rama `brujula-4` (selector de ramas, arriba a la izquierda), abre cada archivo → menú **⋯** → **Delete file** → **Commit changes** en esa misma rama. La 4.0 no los carga, así que dejarlos tampoco rompe nada.
6. En la pestaña **Pull requests**, abre la de `brujula-4` → **Merge pull request** → **Confirm merge**. Ahora sí se publica.

> Si tu sistema oculta los archivos que empiezan por punto, `.gitignore` puede no subirse al arrastrar. No es grave: solo evita subir archivos temporales de las pruebas.

### Opción B: con git

```bash
git clone https://github.com/<tu-usuario>/brujula-estudio.git
cd brujula-estudio
git rm -q brujula-flotante.css brujula-flotante.js brujula-ia.css brujula-ia.js \
  brujula-mejoras.css brujula-mejoras.js brujula-modos.css brujula-modos.js brujula-voz.js
cp -R /ruta/a/brujula/. .          # el contenido del ZIP, incluido .gitignore
git add -A && git commit -m "Brújula 4.0" && git push
```

## 3. Comprobar la publicación

1. En GitHub → pestaña **Actions**, espera a que **pages build and deployment** termine en verde (1–3 minutos). La configuración de Pages no cambia (rama `main`, carpeta `/ (root)`).
2. Abre tu sitio (por ejemplo `https://nohatosem.github.io/brujula-estudio/`). La 4.0 reemplaza sola la caché de la 3.9. Si todavía ves la versión anterior, abre `…/brujula-estudio/actualizar.html`: comprueba que la versión nueva esté publicada, limpia solo los archivos de la app y te devuelve a Brújula. **No borra tus datos.**

## 4. Primer inicio de sesión con la 4.0

Hazlo primero en el dispositivo que tenga tus datos más recientes.

1. Entra con tu cuenta de siempre. La 4.0 lee tu plan, crea **temas** a partir de tus sesiones de estudio y **evaluaciones** a partir de tus exámenes y simulacros. No cambia ningún dato de tus actividades: solo las enlaza con su tema o examen.
2. No se escribe nada en la nube hasta que hagas un cambio. Revisa **Hoy**, **Semana** y **Estudio → Temas**.
3. En **Ajustes → Tus datos → Copias automáticas** verás «Antes de actualizar a 4.0»: es la copia que guardó este dispositivo antes de migrar.
4. Revisa **Ajustes → Rutina y descansos** (sueño, almuerzo, separación y máximo de estudio diario): todo lo automático los respeta.
5. El modo de reprogramación se conserva. Si nunca elegiste uno, queda en **Preguntar**. Mixto y Automático piden tu consentimiento antes de activarse.

**Actualiza también tus otros dispositivos** abriendo Brújula una vez en cada uno (celular, laptop). Hasta entonces, evita editar desde un dispositivo que siga en 3.9: sus datos son compatibles, pero la 3.9 no comprueba si la nube tiene algo más nuevo y podría guardar encima su copia antigua. Si pasara, la 4.0 te avisa del conflicto y conserva ambas copias.

## 5. Actualizar la función de Gemini (Supabase)

La clave `GEMINI_API_KEY` que ya tienes en **Edge Functions → Secrets** se sigue usando; no hay que volver a crearla.

**Con la CLI de Supabase:**

```bash
supabase login
supabase link --project-ref qqnawpbcaxooytizhsfq
supabase functions deploy brujula-ai
```

**Desde el panel:** Supabase → **Edge Functions → brujula-ai → Code**, reemplaza todo el contenido por `supabase/functions/brujula-ai/index.ts` del ZIP y pulsa **Deploy**. No cambies la opción de verificación de JWT que ya tenía la función.

Secretos opcionales (en **Edge Functions → Secrets**):

| Secreto | Para qué | Si no lo pones |
| --- | --- | --- |
| `GEMINI_MODEL` | Elegir el modelo | `gemini-3.5-flash-lite` (el mismo de la 3.9) |
| `GEMINI_FALLBACK_MODEL` | Modelo de respaldo si el principal no existe (404) | `gemini-3.1-flash-lite` |
| `BRUJULA_ALLOWED_ORIGINS` | Otros orígenes permitidos, separados por comas (p. ej. `http://localhost:8080` para probar en tu computadora) | Solo `https://nohatosem.github.io` |

La cuota sigue en la función SQL `brujula_ai_take_turn()` de tu proyecto (15 consultas al día por cuenta). Esta versión no la modifica.

Para comprobarla: en Brújula → **Asistente** → «Analiza mi semana». Si la función no está actualizada, la app usa el modo compatible; si falta la clave, verás un mensaje claro y las respuestas locales siguen funcionando.

## 6. Verificar el aislamiento entre cuentas

1. Crea una cuenta de prueba (otro correo) y entra en otro navegador o en una ventana privada. Debe empezar vacía y no ver nada de tu cuenta.
2. En esa cuenta, **Ajustes → Avanzado → Comprobar acceso privado**: debe decir que no ve filas de otras cuentas.
3. En Supabase → SQL Editor, ejecuta `VERIFICAR_AISLAMIENTO.sql` (solo lectura): RLS activado y políticas por `auth.uid() = user_id`.
4. Cierra la sesión de prueba y, si quieres, borra esa cuenta en **Authentication → Users**.

## 7. Opcional: avisos con la app cerrada (beta)

Requiere SQL adicional, claves VAPID y una tarea programada, todo dentro del plan gratuito. Guía completa y reversión: [AVISOS_PUSH.md](AVISOS_PUSH.md). Sin esto, Brújula avisa mientras está abierta o recién minimizada.

---

## Si algo sale mal: volver a la 3.9

- **App:** si integraste con la solicitud de cambios (opción A), abre esa pull request ya fusionada → **Revert** → **Create pull request** → **Merge pull request**. Con git: `git revert -m 1 <commit de la fusión>` (o `git revert <commit>` si subiste directo) y `git push`. Al abrir la página, la 3.9 vuelve a tomar el control; si algún dispositivo sigue mostrando la 4.0, abre `actualizar.html`.
- **Datos:** la 3.9 lee el plan guardado por la 4.0 (conserva los campos nuevos sin usarlos). Si prefieres volver exactamente al estado anterior: **Nube y datos → ↑ Restaurar copia JSON** con la copia del paso 1, o restaura la tabla desde `brujula_user_state_respaldo_3_9`.
- **Función de Gemini:** vuelve a desplegar el `index.ts` anterior (está en el historial del repositorio). La 3.9 también funciona con la función nueva.
- **Avisos push:** `supabase/sql/push-revertir.sql` y `supabase functions delete brujula-push`.

## Qué no cambia

- Proyecto de Supabase, URL y clave publicable (`sb_publishable_…`).
- Tabla `brujula_user_state` (columnas `user_id`, `payload`, `updated_at`) y sus políticas RLS. La 4.0 no requiere migraciones de esa tabla.
- Claves de `localStorage` por cuenta (`brujula_user_v3_<id>`), notas de voz en IndexedDB, solicitudes de ChatGPT en `brujula_assistant_requests`.
