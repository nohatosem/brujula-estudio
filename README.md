# Brújula 3.3 — Horario primero

Una aplicación web gratuita para cursos, horarios, sesiones guiadas y progreso.

## Mejoras 3.3
- Al entrar por el enlace público se muestra inicio de sesión / creación de cuenta. Los datos de otra cuenta no se muestran en el navegador antes de autenticarse.
- Después de entrar, la pantalla principal es un horario semanal de lunes a domingo. La columna lateral presenta pendientes y una guía sencilla.
- Los usuarios nuevos reciben ayuda para agregar actividades, crear cursos o preparar con su propia cuenta de ChatGPT un JSON de horario para revisar e importar.
- Las tareas personales atrasadas pueden marcarse como hechas. Para actividades flexibles se ofrece un nuevo hueco, evitando superposiciones, la comida del mediodía y la franja de descanso 21:00–07:00. Solo se reprograma con confirmación explícita del usuario.
- No se reprograman automáticamente clases, exámenes ni sesiones dominadas. Los límites de descanso son valores de prueba: cada persona debe definir luego su rutina.
- Se simplificó la navegación y se adaptó la semana al tamaño de pantalla.

**Advertencia sobre IA:** El acceso a ChatGPT Plus no autoriza compartir una cuenta con cinco personas ni alimenta automáticamente un chat dentro de esta web. Para consultas abiertas cada usuario debe usar su propia cuenta; una integración de chat integrada requeriría un backend y credenciales separadas y protegidas. Las solicitudes temporales de Supabase todavía no son una integración multiusuario segura para terceros.

**Límites de prueba:** El rediseño y la reprogramación se probaron en un navegador automatizado con datos de demostración. El alta/inicio de sesión real, sincronización y aislamiento deben verificarse con dos cuentas reales antes de compartir con invitados.

## Para cada persona
1. Abrir la web publicada en GitHub Pages.
2. Ir a **Nube y datos → Crear cuenta**, o **Entrar** si ya tiene cuenta.
3. Si hay una copia en la nube, elegir **Recuperar de nube**; no pulsar **Guardar en nube** sobre una copia vacía.
4. Crear los cursos en **Mis cursos** y las actividades en **Horario → Añadir bloque**.
5. Pulsar **Guardar en nube** si es la primera vez. Los siguientes cambios se sincronizan cuando está activada la conexión.

## Usar ChatGPT para proponer cambios de horario
1. Ir a **ChatGPT y horario**.
2. Pulsar **Copiar mi horario para ChatGPT** y pegarlo en una conversación privada.
3. Pedir, por ejemplo: «Adapta mi horario para repasar Física dos días antes del examen, sin mover mis clases ni reducir mi descanso».
4. Copiar el JSON de cambios generado por el asistente y pegarlo en **Propuesta JSON de cambios**.
5. Pulsar **Verificar cambios**. Revisar la vista previa, horarios superpuestos y actividades a eliminar.
6. Pulsar **Aplicar cambios verificados**. Requiere confirmación. Si hay sesión iniciada y sincronización habilitada, Brújula guardará los datos en Supabase.

Esto **no** es acceso directo de ChatGPT a la base de datos: no hay escritura automática sin una integración autenticada y permisos adecuados.

## Privacidad y seguridad
- GitHub Pages aloja solo el código público de la app; nunca publiques contraseñas ni archivos JSON con datos personales.
- La clave `sb_publishable_` es pública por diseño; las claves `sb_secret_` y `service_role` son privadas y no deben incorporarse al repositorio.
- Ejecuta el esquema `brujula_supabase.sql` en el proyecto Supabase para crear la tabla y activar las políticas RLS por `auth.uid()`.
- **Antes de invitar terceros**, rota todas las credenciales administrativas que hayan sido compartidas anteriormente y verifica el aislamiento de cuentas con dos usuarios de prueba.
- La aplicación almacena una copia local separada por identificador de cuenta; cierra sesión en dispositivos compartidos.
- Exporta copias JSON periódicas. `Guardar en nube` puede reemplazar un estado remoto si así lo confirmas; revisa los avisos.

## Publicación
Este repositorio se publica con GitHub Pages desde la rama `main` y carpeta `/ (root)`. No se necesita servidor para la aplicación, pero el inicio de sesión y sincronización requieren una cuenta Supabase gratuita configurada.

## Límites
- No hay integración de modelos de IA por API, ni cobros adicionales por IA.
- Cambiar código desde ChatGPT mediante GitHub **no** equivale a cambiar automáticamente los datos privados de usuarios.
- La app no confirma en tiempo real las tareas de una persona: depende del registro voluntario.
- Supabase Free y GitHub Pages tienen cuotas y condiciones de uso.


## Brújula 3.1 — Audio y privacidad (2026)
En **Horario → Abrir sesión → Audio de esta sesión**:
- **Escuchar explicación** lee el tema utilizando la síntesis de voz del navegador; no necesita ninguna API pagada.
- **Grabar nota** solicita permiso para usar el micrófono. Dura como máximo dos minutos, por cada bloque.
- **Mi audio**, **Guardar archivo** y **Eliminar audio** permiten escuchar, descargar o borrar la nota.
- Las notas de voz se guardan **solo en el dispositivo**, separadas por cuenta y bloque usando IndexedDB. **No** se sincronizan con Supabase ni forman parte de la copia JSON. En dispositivos compartidos no representan cifrado frente a otros usuarios del sistema operativo.
- Para escuchar o grabar en Chrome, usar el sitio HTTPS de GitHub Pages. El navegador puede exigir permiso de micrófono.

En **Nube y datos → Comprobar acceso privado** hay una prueba de solo lectura que busca filas de otras cuentas. Si devuelve filas ajenas, hay una filtración y hay que detener el uso compartido. Si no devuelve filas, **no demuestra por sí sola** que RLS esté correctamente configurado.

Para auditar políticas de Supabase, ejecutar el archivo **VERIFICAR_AISLAMIENTO.sql** (solo lectura) en SQL Editor. Probar después la aplicación con **dos cuentas diferentes**. El informe completo de aislamiento de producción sigue pendiente hasta esas pruebas.

### Sobre escribir desde ChatGPT directamente en Supabase
Actualizar código desde el plugin GitHub es distinto de modificar información privada. Para autorizar la escritura directa de planes en Supabase, conectar una integración dedicada a Supabase en ChatGPT, con acceso limitado al proyecto y permisos adecuados. No publicar nunca claves administrativas en el HTML, GitHub o conversaciones. Esta integración aún no está habilitada ni verificada y la escritura directa de ChatGPT en los horarios no está activa. La importación revisada de JSON continúa disponible.
