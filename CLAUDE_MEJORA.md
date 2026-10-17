# Instrucciones para Claude — Mejorar Brújula 3.9

Estoy desarrollando **Brújula**, un organizador académico y personal para estudiantes universitarios, con frontend público en GitHub Pages, inicio de sesión con Supabase y un asistente gratuito de Gemini mediante Supabase Edge Functions.

**Tu trabajo es mejorar el proyecto existente, no reconstruirlo ni limitarte a dar consejos.** Inspecciona los archivos y entrégame el código funcional modificado (archivos completos o un ZIP y resumen de cambios). No realices cambios directamente en el sitio publicado, la base de datos de producción o las credenciales.

## Archivos clave

- `index.html`: aplicación principal, calendarios, bloques, cursos, avance, estados, persistencia local y nube.
- `brujula-mejoras.js`: preferencias de descanso, reprogramación local, avisos con la página abierta.
- `brujula-modos.js`: tres modos de planificación: Mixto, Preguntar, Automático.
- `brujula-flotante.js`: globo del asistente de Gemini y propuestas confirmables.
- `brujula-ia.js`, `brujula-voz.js`: chat y conversación por voz.
- `brujula-*.css`: estilos.
- `sw.js`, `manifest.webmanifest`, `actualizar.html`: PWA y caché.
- `supabase/functions/brujula-ai/index.ts`: copia de la Edge Function instalada; lee `GEMINI_API_KEY` desde **Supabase Secrets**, no del código. Esta función se ejecuta en Supabase, no en GitHub Pages.

## Prioridad 1: interfaz simple, intuitiva y rápida

- Mostrar calendario, pendientes y asistente sin párrafos largos; textos breves, botones claros y buen uso en teléfono.
- Mantener selector pequeño de tres modos: **Mixto**, **Preguntar**, **Automático**.
- Reducir duplicación de flujos del asistente y eliminar elementos innecesarios sin perder características existentes.
- Mantener accesibilidad, teclado, diálogos, estados de carga y mensajes claros.
- No introducir dependencias pesadas innecesarias.

## Prioridad 2: planificador de verdad

- Cada curso debe tener dificultad, dominio real por temas, importancia, créditos, evaluaciones, plazos y dependencias.
- Prioridad académica + prioridad diaria dinámica: exámenes, entregas, temas débiles, tiempo libre y descanso.
- Al marcar **No hice**, buscar un hueco válido en función del modo. Al marcar **No entendí/Repasar**, crear propuesta de repaso espaciado.
- No inferir un incumplimiento solo porque haya pasado la hora. No cambiar clases fijas, exámenes, temas dominados o descansos.
- Validar cruces, límites de sueño, comida, descansos, fechas y sesiones duplicadas. Conservar **Deshacer** e historial de decisiones.
- Por defecto usar **Preguntar**. Mixto y Automático requieren consentimiento informado explícito. Un modo nunca debe causar cambios inesperados.
- Gemini interpreta solicitudes y propone; **las escrituras que vengan de la IA exigen revisión y aprobación explícita**. La automatización local previamente autorizada puede mover solo tareas flexibles según el modo.
- Estudiar qué cosas requieren lógica determinista y qué cosas benefician de Gemini. No depender de prompts para validaciones críticas.

## Prioridad 3: avisos y móvil

- Mejorar avisos en la página abierta y diseñar notificaciones push reales cuando la página esté cerrada. No afirmar que funcionan antes de desplegar infraestructura adicional.
- PWA fiable e instalable en Android, con responsive móvil. No borrar los horarios guardados al actualizar.
- Aislar los datos por cuenta. Respetar RLS y autenticación al consultar Supabase.

## Seguridad y coste

- **No pegues ni generes claves privadas** de Gemini, Supabase service role, JWT de usuarios, contraseñas, cookies ni tokens.
- Nunca muevas `GEMINI_API_KEY` al frontend. No crear APIs de pago. Mantener cuotas y control de acceso.
- Evita enviar datos privados de horarios a Gemini si el usuario no habilita la opción.
- No modificar `brujula_user_state` directamente sin consentimiento. Proponer migraciones de esquema separadas con pasos de despliegue y reversión.
- El repositorio es público: todo archivo nuevo será visible a terceros.

## Qué entregarme

1. Código de los archivos modificados, listo para reemplazar los existentes, o ZIP completo.
2. Breve lista de mejoras y fallos detectados con su corrección.
3. Pruebas de no regresión para modos, sincronización, bloqueo de clases, repaso y restauración.
4. Instrucciones precisas para desplegar GitHub Pages y la función Supabase, por separado.
5. Señalar claramente lo implementado frente a lo que aún requiere configuración o pruebas reales.

**No inventes que algo está probado. Prioriza no romper el horario existente.**
