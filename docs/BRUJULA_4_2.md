# Brújula 4.2 — guía breve

Esta actualización conserva la interfaz de Brújula 4.1 y añade funciones beta. No modifica automáticamente ningún horario existente.

## Planificar con IA o ChatGPT

Pulsa + Planificar. Elige Planificar con IA para abrir el asistente con lo que escribiste.
Elige ChatGPT (beta) para generar una solicitud privada en Supabase. Pulsa Copiar mensaje y abrir ChatGPT: solo se copia un mensaje corto con el ID único de esa solicitud, no tu horario. Pégalo en ChatGPT con Supabase autorizado. Regresa a la aplicación y pulsa Buscar propuesta. No consultes otras cuentas. No se consume la API de OpenAI ni existe una llamada automática a ChatGPT desde la web.
La cuenta de ChatGPT no se conecta mediante una contraseña dentro de Brújula. Suscripción y API son servicios distintos.

## Materiales

En Estudio → Tema → Materiales PDF se pueden subir PDFs de hasta 10 MB a un bucket privado. El sistema intenta extraer texto en el navegador y guarda un extracto; no hace OCR de escaneos. El PDF no se comparte con ChatGPT hasta que se solicite explícitamente el análisis. El botón ChatGPT envía solo un extracto, no el PDF íntegro.

## Hoy, Vida y Audio

Hoy muestra próximas actividades y miniagenda semanal. En Vida, cada hábito tiene Horario, con un borrador de rutina editable. Si coincide con una rutina personal creada, el cumplimiento queda enlazado.
En el Asistente está Probar audio para comprobar lectura y permisos. Reconocimiento de voz depende de SpeechRecognition, HTTPS, micrófono, permisos y servicios del navegador.

## Seguridad, límites y pruebas

Los archivos PDF se guardan en brujula-materiales, no público, bajo carpetas autenticadas por usuario. Las solicitudes de ChatGPT están limitadas por RLS y expiran.
El proyecto mantiene los mismos datos, cursos y preferencias. Se conservan clases, exámenes y reglas de descanso.
Las pruebas base unitarias (27) pasaron en un entorno local; los archivos modificados pasan análisis de sintaxis y consistencia de imports. No equivalen a pruebas reales de Web Speech, Supabase Auth o PDF.js en móviles.
Prueba primero con un PDF pequeño, el micrófono y una solicitud de ChatGPT antes de confiarles tareas importantes.