# Cambios

## 4.2.5 · 17 de octubre de 2026

- **Rutina editable en conjunto:** conserva la plantilla y su fecha final, actualiza las repeticiones futuras sin empezar y mantiene IDs, notas y actividades realizadas. Los cambios pueden deshacerse junto con la configuración.
- **Sin duplicados personales:** el generador reconoce ejercicio, limpieza y otras actividades equivalentes que ya estaban guardadas, aunque no procedan del generador.
- **Semana coordinada:** selector Todo / Académico / Rutina. Las comprobaciones de disponibilidad siguen considerando el horario completo.
- Lectura personal opcional en la plantilla; las preferencias de despertar siguen siendo individuales.
- Precaché actualizado y pruebas de edición/sincronización con más de 1.100 actividades, incluidas comprobaciones de selección de voz española.

## 4.2.4 · 17 de octubre de 2026

- **Hoy más claro:** «Tu rumbo ahora» a la izquierda y una sola lista de pendientes a la derecha. Se retiran de Hoy las tarjetas duplicadas, prioridades y hábitos; los hábitos siguen en Vida.
- **Mi semana a todo el ancho:** títulos completos, horarios, círculos para marcar actividades con Deshacer y notas editables. Las notas también aparecen en los detalles y el formulario de edición.
- **Descarga semanal:** CSV editable con los siete días visibles, sus actividades y notas. Disponible en Hoy y Semana.
- **Botones más claros:** «Añadir actividad» abre el formulario individual; «Planificar semana» organiza varias sesiones.
- Actualización de versión y precaché de la PWA. Se conservan el modelo, los horarios, las cuentas y la configuración de descanso.

## 4.0.0 · 17 de octubre de 2026

Rediseño completo y nueva base de código modular (sin paso de compilación). Tus datos, cuentas, Supabase y Gemini se conservan; ver [docs/INTEGRACION.md](docs/INTEGRACION.md).

### Nuevo
- **Pantalla Hoy** que decide por ti el orden: lo que toca ahora, lo que espera tu decisión, prioridades explicadas, el recorrido del día con sus huecos, exámenes próximos y hábitos.
- **Sistema académico:** temas con dominio (0–100 %), niveles y prerrequisitos; repaso espaciado; registro de dificultades; evaluaciones con cuenta regresiva, peso, preparación y nota; plan de estudio para cada examen; **Planificar semana**.
- **Prioridades dinámicas** que combinan examen cercano, tema débil, repaso vencido, requisitos pendientes, importancia del curso y lo no realizado, con razones legibles.
- **Alta rápida en español** («examen de Física el 3 de noviembre a las 10»): un examen crea también su evaluación.
- **Sesión guiada** a pantalla completa en cinco pasos, con Pomodoro configurable y cierre que actualiza el tema.
- **Deshacer** de verdad: una pila de los últimos cambios, también los automáticos y los de Gemini.
- **Asistente** que primero responde con tus datos sin gastar cuota y, con permiso, usa Gemini para analizar la semana (`analyze`) o atender un pedido (`plan`). Siempre propone, valida en el dispositivo y aplica solo lo que apruebas.
- **Progreso** (horas, cumplimiento, dominio por curso, dificultades, historial) y **Vida** (hábitos editables con rachas, diario de 3 minutos).
- **PWA instalable** con iconos adaptables, accesos directos, caché versionada, actualización sin perder datos y apertura sin conexión.
- **Avisos con la app cerrada (beta, opcional):** función `brujula-push`, SQL con reversión y guía en [docs/AVISOS_PUSH.md](docs/AVISOS_PUSH.md).
- **Sincronización más segura:** escritura condicional (no pisa lo que otro dispositivo guardó), carga automática de la nube cuando aquí no hay cambios, detección de cambios entre pestañas y copias automáticas antes de reemplazar algo.
- Pruebas automáticas: unitarias, de punta a punta, de las funciones y del SQL (ver [docs/PRUEBAS.md](docs/PRUEBAS.md)).

### Cambiado
- Interfaz nueva («recorrido de orientación»), tipografías propias incluidas (Bricolage Grotesque y Atkinson Hyperlegible Next), modo oscuro y navegación pensada para el celular.
- Los tres modos se mantienen (Preguntar por defecto). Activar Mixto o Automático pide consentimiento informado. Si ya los usabas, la 4.0 te lo explica al entrar y puedes mantenerlo o volver a Preguntar.
- La función `brujula-ai` acepta hasta 32 KB, recibe un contexto compacto de los próximos días en lugar de las primeras 40 actividades guardadas, admite `GEMINI_MODEL` y un modelo de respaldo, y sigue aceptando las llamadas de la 3.8/3.9.
- `brujula-actualizada.html` ahora redirige a `index.html` (los marcadores antiguos siguen funcionando).

### Corregido (fallos encontrados en la 3.9)
- **Los avisos no aparecían en Android:** se usaba `new Notification()`, que Chrome para Android no permite (el error quedaba oculto). Ahora se muestran con el service worker.
- **Gemini veía actividades viejas:** se le enviaban las primeras 40 actividades guardadas, no las próximas.
- **Horarios grandes fallaban:** la función rechazaba cualquier solicitud de más de 15 000 caracteres.
- **El repaso ignoraba tu rutina:** buscaba hueco siempre entre las 18:00 y las 22:00, aunque durmieras antes o almorzaras a otra hora.
- **Mensaje equivocado al vaciar el plan:** decía «Plan de ejemplo restaurado» después de borrarlo.
- **La semana en el celular obligaba a desplazarse de lado** (735 px de ancho). Ahora es una agenda por día que se desliza.

### Seguridad y privacidad
- Ninguna clave privada en el código. Gemini y los avisos push leen sus claves solo de Supabase Secrets.
- Gemini nunca recibe notas, diario ni contraseñas, y tu horario solo si lo permites.
- Los avisos push guardan solo hora, título y curso de los próximos 7 días, en tablas cerradas al navegador.

### Eliminado
- `brujula-flotante.*`, `brujula-ia.*`, `brujula-mejoras.*`, `brujula-modos.*` y `brujula-voz.js`: sus funciones están integradas en la nueva base (`js/`). Puedes borrarlos del repositorio.
