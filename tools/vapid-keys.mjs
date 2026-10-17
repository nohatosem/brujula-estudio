#!/usr/bin/env node
// Brújula 4 · genera las claves VAPID y el secreto del cron para los avisos push.
// Uso:  node tools/vapid-keys.mjs tu-correo@ejemplo.com
// Solo IMPRIME en pantalla: no escribe archivos. Nunca pegues la clave privada ni el
// secreto del cron en el repositorio (es público): van a Supabase → Edge Functions → Secrets.
import { webcrypto as crypto } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const email = (process.argv[2] || '').trim();
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Indica un correo de contacto (lo ven los servicios de push si hay problemas):\n  node tools/vapid-keys.mjs tu-correo@ejemplo.com');
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
const cron = b64u(crypto.getRandomValues(new Uint8Array(32)));

console.log(`
Claves generadas. Guárdalas en Supabase (NO en GitHub):

  supabase secrets set VAPID_PUBLIC_KEY=${publicKey}
  supabase secrets set VAPID_PRIVATE_KEY=${d}
  supabase secrets set VAPID_SUBJECT=mailto:${email}
  supabase secrets set BRUJULA_CRON_SECRET=${cron}

O en el panel: Edge Functions → Secrets → Add new secret (mismos nombres y valores).
El valor de BRUJULA_CRON_SECRET también va en supabase/sql/push-programar.sql (paso 1),
pegado directamente en el SQL Editor, sin guardarlo en el repositorio.

Si cambias VAPID_* más adelante, cada dispositivo debe volver a activar los avisos.
`);
