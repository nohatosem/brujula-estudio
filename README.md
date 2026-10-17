# Brújula 4.0

Organizador académico y personal para estudiantes universitarios. Es una PWA estática (GitHub Pages) con cuentas y sincronización en Supabase y un asistente Gemini que solo propone cambios, nunca los aplica por su cuenta.

Al abrirla, la pantalla **Hoy** responde tres preguntas: qué hacer ahora, qué quedó pendiente y qué es prioritario.

![Vista previa de Brújula 4.0](docs/vista-previa.png)

## Qué hace

- **Hoy.** «Tu rumbo»: la actividad actual o la siguiente, con un botón para empezar. Debajo: «¿Cómo te fue?» (lo que ya pasó y espera tu decisión; nunca se marca «no hecho» solo porque pasó la hora), prioridades explicadas, el recorrido del día con sus huecos libres, los próximos exámenes y los hábitos.
- **Semana.** Agenda por día en el celular (deslizas entre días) y cuadrícula de 7 días en la computadora, donde puedes arrastrar para mover (se valida en vivo) o tocar un hueco para crear algo. **Planificar semana** reparte tus prioridades en los días con menos carga y te muestra la propuesta antes de aplicarla.
- **Estudio.** Cursos con dificultad, importancia y créditos. Temas con dominio real (0–100 %), niveles, prerrequisitos y repaso espaciado. Exámenes y entregas con cuenta regresiva, porcentaje de preparación y plan de estudio automático. Lista de repasos que tocan hoy.
- **Sesión guiada.** Cinco pasos (preparar, entender, practicar, evaluar, cerrar), temporizador Pomodoro, sonido ambiental generado en el dispositivo y lectura en voz alta. Al cerrar eliges *Lo domino*, *Repasar* o *No lo entendí*: eso actualiza el tema, anota la dificultad y propone el repaso.
- **Tres modos cuando algo no se cumple.** *Preguntar* (por defecto) te propone y tú decides. *Mixto* mueve solas las tareas personales y pregunta por el estudio. *Automático* mueve lo flexible y crea repasos. Mixto y Automático piden consentimiento informado. Clases, exámenes, temas dominados, sueño, almuerzo y descansos están siempre protegidos, y todo se puede deshacer.
- **Alta rápida en español.** «Examen de Física el 3 de noviembre a las 10», «repasar vectores mañana 4pm 45 min». Un examen crea también su evaluación.
- **Asistente.** Responde al instante, sin gastar consultas, lo que se resuelve con tus datos (qué hago, cruces, exámenes, repasos, «no pude estudiar física»). Con tu permiso usa Gemini para explicar temas, analizar tu semana y proponer cambios. Cada propuesta se valida en tu dispositivo y solo se aplica lo que apruebas.
- **Progreso y Vida.** Horas planificadas frente a realizadas, dominio por curso, dificultades abiertas e historial con deshacer. Hábitos con rachas y un diario de 3 minutos que nunca se envía a la IA.
- **PWA.** Se instala en Android (y en iPhone desde Safari), abre sin conexión con tu última copia y avisa antes de cada actividad. Los **avisos con la app cerrada** (beta) requieren desplegar un servidor opcional: [docs/AVISOS_PUSH.md](docs/AVISOS_PUSH.md).

## Diseño (por qué se ve así)

- **Idea: el día como recorrido de orientación.** En los mapas de orientación la ruta se sobreimprime en magenta: salida ▲, controles numerados ○ y meta ◎. Brújula usa esa gramática para el «recorrido de hoy». El magenta (`#A3157A`) marca **solo tu ruta**: lo que toca ahora, la acción principal y las prioridades. Así la atención va a un único lugar.
- **Colores del mapa.** Papel claro (`#F5F6F1`) en lugar de blanco puro, verde bosque para lo logrado, marrón de curvas de nivel para rachas y alertas suaves, azul de agua para la información. Tiene modo oscuro con contraste revisado.
- **Tipografías.** *Bricolage Grotesque* para títulos y números (con carácter, se lee bien en tamaños grandes). *Atkinson Hyperlegible Next* para el texto, diseñada para la máxima legibilidad (también para baja visión). Ambas tienen licencia OFL y van incluidas en `assets/fonts`, sin depender de Google Fonts.
- **Celular primero.** Barra inferior con el botón **+** al centro (crear es lo más frecuente), hojas que suben desde abajo, objetivos táctiles de 44 px y sin desplazamiento horizontal (hay una prueba automática para eso). En la computadora: menú lateral y Hoy en dos columnas.
- **Menos texto.** Cada pantalla muestra primero la decisión y deja los detalles un toque más allá. Los iconos son de Lucide (licencia ISC).

## Estructura

```
index.html, manifest.webmanifest, sw.js      App, instalación y caché sin conexión
css/brujula.css                              Sistema de diseño (claro/oscuro)
js/app.js                                    Arranque, navegación y renderizado
js/core/        modelo de datos, migración 3.9 → 4.0, almacenamiento y deshacer
js/engine/      reglas, validador de horario, prioridades, repaso espaciado, alta rápida
js/cloud/       Supabase: sesión, sincronización segura y conflictos
js/views/       Hoy, Semana, Estudio, Curso, Sesión, Progreso, Vida, Ajustes, Acceso
js/ui/          componentes (hojas, avisos, formularios, propuestas)
js/features/    modos, avisos, push (beta), audio, tema, instalación
js/assistant/   respuestas locales, Gemini y voz
supabase/functions/brujula-ai/     Edge Function de Gemini (se despliega aparte)
supabase/functions/brujula-push/   Edge Function de avisos push (opcional, beta)
supabase/sql/                      SQL opcional de avisos push (instalar, programar, revertir, verificar)
tests/                             pruebas unitarias, de punta a punta y de las funciones
tools/                             lista de precaché del service worker y claves VAPID
```

No hay paso de compilación: los archivos se publican tal cual en GitHub Pages.

## Integrar en el repositorio sin perder datos

Sigue **[docs/INTEGRACION.md](docs/INTEGRACION.md)**: copia de seguridad, subida a GitHub, despliegue de la función de Gemini y reversión. Resumen: tus datos siguen en la misma tabla `brujula_user_state` con el mismo formato base (`version: 2`); la versión 4 solo **añade** campos y guarda una copia local antes de migrar.

## Probar en tu computadora

```bash
python3 -m http.server 8080        # abre http://localhost:8080
npm test                           # 27 pruebas unitarias (Node 20+)
npm i -D playwright && npx playwright install chromium
npm run test:e2e                   # 28 pruebas de punta a punta con Supabase simulado
npm run test:edge                  # 38 pruebas de las funciones (requiere Bun; o test:edge:deno)
npm run test:sql                   # 5 pruebas del SQL de avisos (requiere PostgreSQL local)
```

Detalle de lo probado y de lo que falta probar en real: [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Privacidad y seguridad

- El repositorio es público. Solo contiene la clave **publicable** de Supabase (`sb_publishable_…`), que es pública por diseño. La clave de Gemini, la `service_role` y los secretos VAPID viven en **Supabase → Edge Functions → Secrets**; nunca en el código.
- Cada cuenta ve solo sus datos (RLS por `auth.uid()`). La copia local también se separa por cuenta. Al cerrar sesión puedes borrar la copia del dispositivo.
- Gemini solo recibe tu horario si activas «Permitir enviar mi horario». Nunca recibe notas, diario ni contraseñas. En el nivel gratuito, Google puede usar lo que envías para mejorar sus productos.
- Sin servicios de pago: GitHub Pages, Supabase Free y el nivel gratuito de Gemini.

## Límites conocidos

- La sincronización usa el último guardado completo por cuenta. Si dos dispositivos editan sin conexión a la vez, Brújula no mezcla: te deja elegir qué copia conservar y guarda la otra.
- Los avisos con la app totalmente cerrada solo funcionan después de desplegar el servidor opcional de push, y no se han probado con servicios de push reales (ver docs).
- Dictado y conversación por voz dependen del navegador (Chrome, sobre todo). Las notas de voz se guardan solo en el dispositivo.

Tipografías: Bricolage Grotesque y Atkinson Hyperlegible Next (licencia OFL). Iconos: Lucide (licencia ISC).
