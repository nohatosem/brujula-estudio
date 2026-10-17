# Pruebas de Brújula 4.0

Resultado de la última ejecución (17 de octubre de 2026): **98 de 98 pruebas correctas** en cinco grupos. Abajo se detalla qué cubre cada grupo, qué fue simulado y qué **no** se ha podido probar en real.

| Grupo | Pruebas | Herramienta | Qué es real y qué es simulado |
| --- | --- | --- | --- |
| Unitarias | 27 | `node --test` (Node 22) | Código real del motor, el modelo y los avisos |
| De punta a punta | 28 | Playwright 1.56 + Chromium | La app real en un navegador real, con **supabase-js real**; Supabase (Auth, base de datos, funciones) simulado en memoria |
| Función `brujula-ai` | 17 | Bun 1.4 y Deno 2.5 | El código real de la función; Supabase y la API de Gemini simulados |
| Función `brujula-push` | 21 | Bun 1.4 y Deno 2.5 | Cifrado y firma reales (WebCrypto), comparados con el RFC 8291 y con la implementación de referencia; Supabase y el servicio de push simulados |
| SQL de avisos push | 5 | PostgreSQL 16.15 | El SQL real sobre una simulación mínima de Supabase (roles `anon`, `authenticated`, `service_role` y `auth.users`) |

Condiciones de las pruebas de punta a punta: reloj fijo en el sábado 17 de octubre de 2026 a las 10:30 (America/Lima), celular de 390 × 844 px (y 320 px en la prueba de desplazamiento horizontal) y computadora de 1366 × 860 px, idioma es-PE.

## Qué se verificó

**Cuentas y datos**
- Contraseña incorrecta con mensaje claro; registro con confirmación por correo.
- Aislamiento: dos cuentas en el mismo navegador no ven ni guardan datos de la otra.
- Migración 3.9 → 4.0 con datos reales de la 3.9: actividades, diario, hábitos y preferencias intactos campo por campo; temas y evaluaciones creados; `version: 2` conservado; nada se escribe en la nube hasta que editas. Es idempotente, y un estado 4.0 sigue siendo válido para la 3.9 (reversión segura).
- Si en la 3.9 usabas Mixto o Automático, la 4.0 lo explica y te deja mantenerlo o volver a Preguntar.
- Dispositivo nuevo: carga la nube sin conflicto. Cambio en otro dispositivo: se aplica solo si aquí no hay cambios pendientes.
- Conflicto real: elegir una copia guarda la otra. Escritura condicional: si otro dispositivo escribió antes, no se sobrescribe en silencio.
- Sin conexión: guarda en el dispositivo y sincroniza al volver internet. La PWA abre sin conexión con tus datos.

**Planificador**
- Nunca marca «no hecho» por la hora: lo pasado espera tu decisión.
- Los tres modos: Preguntar (propone y Deshacer revierte), Mixto (pide consentimiento, mueve la tarea personal y pregunta por el estudio) y Automático (mueve el estudio flexible, crea el repaso espaciado y no toca las clases).
- Validador: sueño (también si duermes después de medianoche), almuerzo, pasado, cruces, separación entre actividades y máximo diario. Lo que propone Gemini se valida en modo estricto (no borra, no toca protegidos, máximo de cambios).
- Plan de examen y plan semanal: sesiones sin cruces, respetando el descanso, con temas débiles y repasos primero, aplicables solo con aprobación y deshacibles.
- Repaso espaciado, prioridades con razones legibles (los requisitos pendientes suben) y alta rápida en español.

**Asistente**
- Respuestas locales sin gastar cuota.
- Gemini: consentimiento, análisis y propuesta validada; las propuestas peligrosas se rechazan y el diario no se envía. Si la función no está desplegada o falta la clave, el mensaje es claro y la app sigue funcionando.
- Función `brujula-ai`: orígenes, sesión, consentimiento, tamaño máximo, cuota antes de llamar a Gemini, clave solo en la cabecera, modelo configurable con respaldo ante un 404, 429 de Google, filtrado de la respuesta y compatibilidad con la 3.8/3.9.
- Propuesta JSON de ChatGPT: se verifica y se aplica solo lo aprobado.

**Avisos**
- Locales: llegan por el service worker 10 minutos antes, con el texto y el enlace correctos, sin repetirse. «A la hora» (0 minutos) se respeta.
- Con la app cerrada (beta), con el servidor simulado: activación, cola mínima (sin notas ni diario, 7 días como máximo, solo seis campos), aviso entregado por el service worker mediante un push real del protocolo de Chromium (DevTools), enlaces externos neutralizados, sin duplicar con el aviso local y vuelta a los avisos locales si el envío programado deja de responder. Sin servidor, lo explica y no rompe nada.
- Función `brujula-push`: reproduce exactamente el vector de prueba del RFC 8291 (Apéndice A); la implementación de referencia (`encrypted-content-encoding`, del autor del RFC) descifra sus mensajes; firma VAPID ES256 verificada con WebCrypto y con OpenSSL; solo envía a servicios de push conocidos; valida la cola; un navegador pertenece a una sola cuenta; una copia más antigua no pisa la cola; el envío programado exige su secreto, no repite avisos y borra los dispositivos dados de baja (410).
- SQL: instalación repetible; `anon` y `authenticated` no pueden leer, escribir ni reservar; una sola reserva por aviso; vencidos y antiguos se limpian; restricciones de tamaño; borrar una cuenta borra sus avisos; revertir lo quita todo sin tocar `brujula_user_state`.

**Interfaz**
- Ninguna pantalla se desplaza en horizontal en celulares de 320 a 390 px.
- Todos los controles visibles tienen nombre accesible, en todas las pantallas; idioma es-PE; foco visible al navegar con teclado (comprobado en Hoy).
- Revisión visual de todas las pantallas (celular y computadora, claro y oscuro) con capturas, corrigiendo lo que se veía mal.

## Qué NO se ha probado en real

Estas partes dependen de servicios o dispositivos que no están disponibles en el entorno de desarrollo. El código está escrito y probado contra simulaciones, pero **hay que comprobarlas tú**:

- **Supabase real:** inicio de sesión, sincronización y RLS con tu proyecto (sigue el paso 6 de [INTEGRACION.md](INTEGRACION.md) con dos cuentas reales).
- **Gemini real:** respuestas reales del modelo y sus cuotas. La función se probó con respuestas simuladas.
- **GitHub Pages real:** publicación y actualización de la caché desde la 3.9 en tus dispositivos.
- **Android e iPhone reales:** instalación de la PWA, notificaciones del sistema, micrófono, dictado y lectura en voz alta.
- **Avisos con la app cerrada:** entrega por los servicios reales de Google, Apple o Mozilla, y el cron de tu proyecto. El cifrado coincide con el estándar, pero no se ha enviado ningún push real.
- **Audio ambiental y notas de voz:** dependen de permisos y hardware del dispositivo.

## Cómo ejecutar las pruebas

```bash
npm test                                   # unitarias (Node 20+)
npm i -D playwright && npx playwright install chromium
npm run test:e2e                           # de punta a punta (descarga supabase-js del CDN si no hay copia local)
npm run test:edge                          # funciones con Bun (o: npm run test:edge:deno)
PGHOST=localhost PGUSER=postgres npm run test:sql   # SQL de avisos con un PostgreSQL local
```

`node tests/e2e/run.mjs avisos` ejecuta solo las pruebas cuyo nombre contiene «avisos».
