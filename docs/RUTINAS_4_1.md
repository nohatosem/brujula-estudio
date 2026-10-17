# Brújula 4.1 — Rutinas fijas y asistente directo (beta)

La interfaz de Brújula 4.0 permanece intacta. Esta actualización añade horarios que se repiten durante cuatro meses y el permiso opcional para ejecutar peticiones sin volver a confirmar cada vez.

## Activar

1. Abre **Ajustes → Asistente y privacidad**.
2. Activa **Asistente directo (beta)** y confirma el alcance una vez.
3. Para que **Gemini** analice o modifique el horario, activa por separado **Usar Gemini** y **Permitir enviar mi horario**. No se comparten diarios, notas ni contraseñas.
4. Abre **Asistente** y escribe la orden en español o utiliza el micrófono del navegador.

**Desactivado por defecto** en todas las cuentas; activar Mixto o Automático para actividades incumplidas no activa este permiso de IA.

## Ejemplos admitidos

- `Todos los lunes estudiar Física de 15:00 a 17:00 durante cuatro meses`
- `Cada martes clase de física de 9 a 11`
- `Limpieza todos los días de 18:00 a 18:30`
- `Lunes a viernes ejercicio de 6 a 7 de la tarde` (si tus horas de sueño permiten el horario)
- `Mueve física de lunes a miércoles` (actualiza las futuras sesiones de los lunes de esa serie)
- `Elimina física los lunes` (retira las futuras sesiones de los lunes de esa serie)
- `Elimina limpieza todos los días` (retira la serie completa cuando se reconoce un único grupo)
- `Reorganiza mis sesiones de estudio de esta semana` (Gemini; puede aplicar ajustes seguros directamente)
- `Planifica mi semana` (motor de prioridades local; con permiso directo guardará los huecos válidos)

Las frases ambiguas, sin día u hora, reciben una aclaración. La comprensión libre de solicitudes complejas depende de Gemini y de la cuota disponible; **las rutinas repetidas descritas arriba se interpretan localmente sin gasto de Gemini**.

## Protección y reversión

- El asistente no marca tareas como incumplidas solo porque llegó la hora.
- Un bloque de **rutina fija** aparece con **↻ Fijo**. Las clases, los exámenes, los temas dominados, las rutinas fijas y los descansos se excluyen de cambios automáticos genéricos.
- Una petición **explícita** de mover o quitar una serie identificada puede modificar sus sesiones **futuras**. Nunca cambia las completadas.
- Cada orden se valida contra sueño, almuerzo, descanso entre actividades, cruces y límite de estudio. Si hay choque, no guarda una serie parcialmente.
- La ejecución de cada orden recurrente es una única operación en el historial, con **Deshacer**; si creó un curso nuevo, también se elimina al deshacer (si no ha sido modificado posteriormente).
- El horario y los permisos se guardan por cuenta mediante las claves anteriores de Brújula y Supabase, con RLS existente. No se requiere migración SQL.
- La instalación offline se actualiza a `4.1.0` y precachea el nuevo módulo.

## Límites actuales

- Se crean **cuatro meses por defecto**, no una recurrencia indefinida. Después de esos cuatro meses se necesita pedir una nueva rutina.
- El procesamiento local reconoce varias estructuras habituales de español, pero no todas las frases posibles. Los cambios de series requieren identificar correctamente el nombre y el día.
- «Asistente directo» aplica automáticamente **propuestas de planificación de Gemini** que pasan todas las validaciones, tienen máximo cinco cambios y no contienen rechazos ni avisos. Las propuestas ambiguas o rechazadas siguen pasando por revisión.
- **ChatGPT propio por usuario todavía no está conectado a Brújula.** Una integración genuina requiere OAuth y un conector/MCP con permiso por cuenta, sin compartir secretos o credenciales administrativas. El plan de ChatGPT no equivale a una clave gratuita de la API.
- No se configura Web Push desde esta actualización. Los avisos con la aplicación cerrada siguen siendo un despliegue opcional aparte.

## Cómo probar

1. Guarda una copia JSON desde **Ajustes → Tus datos**.
2. Configura una rutina semanal de prueba a una hora libre y verifica la misma fecha durante cuatro semanas.
3. Verifica que las sesiones muestran «↻ Fijo».
4. Prueba mover el día de la rutina, abre Semana y pulsa **Deshacer**.
5. Cambia de dispositivo y comprueba el estado **Guardado** de Supabase.
6. Sin activar el permiso directo, comprueba que primero se presenta un botón **Guardar rutina**.
7. Después de activar el permiso, prueba una rutina sin cruces y comprueba que se guarde directamente.
