// Brújula 4 · Edge Function «brujula-push» — OPCIONAL / EXPERIMENTAL.
// Avisos con la app cerrada usando Web Push estándar: VAPID (RFC 8292) y cifrado
// aes128gcm (RFC 8291). Sin servicios de pago ni librerías externas de cifrado.
//
// Nada de esto funciona hasta desplegarlo (docs/AVISOS_PUSH.md):
//   1. supabase/sql/push-instalar.sql
//   2. secretos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT y BRUJULA_CRON_SECRET
//   3. supabase functions deploy brujula-push --no-verify-jwt   (la función verifica sola)
//   4. supabase/sql/push-programar.sql (cron cada minuto)
//
// Acciones (POST JSON {action, ...}):
//   config      → si el servidor está listo, la clave pública VAPID y el último envío.
//   subscribe   → guarda la suscripción de ESTE navegador para la persona autenticada.
//   unsubscribe → la borra (si no quedan dispositivos, vacía su cola).
//   sync        → reemplaza la cola de avisos pendientes de la persona (máx. 60, 8 días).
//   test        → envía un aviso de prueba a sus dispositivos.
//   dispatch    → SOLO el cron (cabecera x-brujula-cron): envía los avisos que tocan.
//
// Privacidad: la función nunca lee brujula_user_state. El navegador calcula los avisos
// (hora, título, curso) y solo eso se guarda. El contenido viaja cifrado de extremo a
// extremo: el servicio de push (Google, Mozilla, Apple, Microsoft) no puede leerlo.
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string): string => (globalThis as any).Deno?.env?.get?.(k) ?? "";
const DEFAULT_ORIGINS = ["https://nohatosem.github.io"];
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
const MAX_BODY = 24000;
const MAX_ITEMS = 60;
const MAX_DEVICES = 8;
const HORIZON_MS = 8 * 86400000;
const TAG_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const URL_RE = /^\.\/index\.html#\/[A-Za-z0-9_\-\/%.]{0,200}$/;

// ——— utilidades ———
const te = new TextEncoder();
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
const ONE = new Uint8Array([1]);
// WebCrypto/fetch con TypeScript reciente exigen ArrayBuffer «puro»; esto vale para todas las versiones.
const bs = (u: Uint8Array) => u as unknown as BufferSource;

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(text: string): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) throw new Error("base64url inválido");
  const s = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", bs(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, bs(data)));
}
function safeEqual(a: string, b: string): boolean {
  const x = te.encode(a), y = te.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// ——— Cifrado del mensaje (RFC 8291, un solo registro aes128gcm, rs = 4096) ———
export async function encryptPayload(
  plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array,
  fixed?: { salt: Uint8Array; privateKey: CryptoKey; publicKey: Uint8Array },
): Promise<Uint8Array> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("p256dh inválida");
  if (authSecret.length !== 16) throw new Error("auth inválida");
  if (plaintext.length > 3800) throw new Error("mensaje demasiado grande");
  let privateKey: CryptoKey, asPublic: Uint8Array;
  if (fixed) { privateKey = fixed.privateKey; asPublic = fixed.publicKey; }
  else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    privateKey = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("raw", bs(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, privateKey, 256));
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(te.encode("WebPush: info\0"), uaPublic, asPublic, ONE));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), ONE))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), ONE))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", bs(cek), { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce), tagLength: 128 }, key, bs(concat(plaintext, new Uint8Array([2])))));
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([65]), asPublic, sealed);
}

// ——— Identificación del servidor (VAPID, RFC 8292) ———
type Vapid = { publicKey: string; privateKey: string; subject: string };
export function vapidKeys(): Vapid | null {
  const publicKey = env("VAPID_PUBLIC_KEY").trim(), privateKey = env("VAPID_PRIVATE_KEY").trim(), subject = env("VAPID_SUBJECT").trim();
  if (!publicKey || !privateKey || !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  try { if (b64uDecode(publicKey).length !== 65 || b64uDecode(privateKey).length !== 32) return null; } catch { return null; }
  return { publicKey, privateKey, subject };
}
export async function vapidHeader(endpoint: string, keys: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pub = b64uDecode(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (o: unknown) => b64uEncode(te.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: keys.subject })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bs(te.encode(unsigned))));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${keys.publicKey}`;
}

/** Solo servicios de push conocidos (evita que la función haga peticiones a sitios arbitrarios). */
export function pushEndpointOk(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const extra = env("BRUJULA_PUSH_HOSTS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = u.hostname.toLowerCase();
  return [...PUSH_HOSTS, ...extra].some((h) => host === h || host.endsWith("." + h));
}

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
async function sendPush(sub: Sub, payload: Record<string, string>, keys: Vapid, ttl: number, cache: Map<string, string>) {
  if (!pushEndpointOk(sub.endpoint)) return { ok: false, gone: true, status: 0 };
  try {
    const body = await encryptPayload(te.encode(JSON.stringify(payload)), b64uDecode(sub.p256dh), b64uDecode(sub.auth));
    const aud = new URL(sub.endpoint).origin;
    let authorization = cache.get(aud);
    if (!authorization) { authorization = await vapidHeader(sub.endpoint, keys); cache.set(aud, authorization); }
    const res = await fetch(sub.endpoint, {
      method: "POST", body: bs(body), signal: AbortSignal.timeout(10000),
      headers: { authorization, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(ttl), urgency: "high" },
    });
    try { await res.body?.cancel(); } catch { /* sin cuerpo */ }
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch (_) {
    return { ok: false, gone: false, status: 0 };
  }
}

// ——— Datos recibidos del navegador ———
export function cleanItems(raw: unknown, now = Date.now()) {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS * 2) return null;
  const out: any[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (out.length >= MAX_ITEMS) break;
    if (!it || typeof it !== "object") continue;
    const x = it as any;
    const tag = typeof x.tag === "string" ? x.tag : "";
    if (!TAG_RE.test(tag) || seen.has(tag)) continue;
    const fire = Date.parse(x.fire_at), exp = Date.parse(x.expire_at ?? x.fire_at);
    if (!Number.isFinite(fire) || !Number.isFinite(exp) || fire < now - 5 * 60000 || fire > now + HORIZON_MS) continue;
    const title = str(x.title, 120).trim();
    if (!title) continue;
    seen.add(tag);
    out.push({
      tag, title, body: str(x.body, 240),
      fire_at: new Date(fire).toISOString(),
      expire_at: new Date(Math.min(Math.max(exp, fire + 60000), fire + 86400000)).toISOString(),
      url: typeof x.url === "string" && URL_RE.test(x.url) ? x.url : "./index.html#/hoy",
    });
  }
  return out;
}

// ——— HTTP ———
function allowedOrigins(): Set<string> {
  const extra = env("BRUJULA_ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}
const corsHeaders = (origin: string): Record<string, string> => origin ? {
  "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
} : {};
const json = (value: unknown, status: number, origin = "") => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(origin) },
});

function admin() {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY") || env("BRUJULA_PUSH_SERVICE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin") || "";
  const allow = allowedOrigins().has(origin) ? origin : "";
  if (req.method === "OPTIONS") return allow ? new Response(null, { status: 204, headers: corsHeaders(allow) }) : new Response(null, { status: 403 });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, allow);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Solicitud demasiado grande." }, 413, allow);
  let body: any;
  try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "JSON inválido." }, 400, allow); }
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "dispatch") return dispatch(req);
  if (!allow) return json({ error: "Origen no permitido." }, 403);

  const keys = vapidKeys();
  const db = admin();
  if (action === "config" && (!keys || !db)) return json({ enabled: false, publicKey: null, lastRunAt: null }, 200, allow);
  if (!keys || !db) return json({ error: "Los avisos con la app cerrada no están configurados en el servidor.", code: "PUSH_NOT_CONFIGURED" }, 503, allow);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 40) return json({ error: "Inicia sesión para usar los avisos." }, 401, allow);
  const { data: who, error: authError } = await db.auth.getUser(token);
  const uid = who?.user?.id;
  if (authError || !uid) return json({ error: "Tu sesión caducó. Vuelve a entrar." }, 401, allow);

  const SUBS = "brujula_push_subscriptions", QUEUE = "brujula_push_queue";
  const deviceCount = async () => (await db.from(SUBS).select("id", { count: "exact", head: true }).eq("user_id", uid)).count ?? 0;

  if (action === "config") {
    const { data } = await db.from("brujula_push_health").select("last_run_at").eq("id", 1).maybeSingle();
    return json({ enabled: true, publicKey: keys.publicKey, lastRunAt: data?.last_run_at ?? null }, 200, allow);
  }

  if (action === "subscribe") {
    const sub = body.subscription;
    if (!pushEndpointOk(sub?.endpoint)) return json({ error: "Este servicio de notificaciones no está admitido." }, 400, allow);
    let p256dh: Uint8Array, auth: Uint8Array;
    try { p256dh = b64uDecode(sub.keys?.p256dh); auth = b64uDecode(sub.keys?.auth); } catch { return json({ error: "Suscripción no válida." }, 400, allow); }
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return json({ error: "Suscripción no válida." }, 400, allow);
    // Un navegador = una cuenta: si otra cuenta usó este navegador, deja de recibir aquí.
    await db.from(SUBS).delete().eq("endpoint", sub.endpoint);
    const ins = await db.from(SUBS).insert({ user_id: uid, endpoint: sub.endpoint, p256dh: b64uEncode(p256dh), auth: b64uEncode(auth), device: str(body.device, 60) || null });
    if (ins.error) return json({ error: "No se pudo guardar la suscripción." }, 500, allow);
    const { data: list } = await db.from(SUBS).select("id, created_at").eq("user_id", uid).order("created_at", { ascending: false });
    const extra = (list || []).slice(MAX_DEVICES).map((x: any) => x.id);
    if (extra.length) await db.from(SUBS).delete().in("id", extra);
    let test = null;
    if (body.test === true) {
      test = await sendPush({ id: "", user_id: uid, endpoint: sub.endpoint, p256dh: b64uEncode(p256dh), auth: b64uEncode(auth) },
        { title: "Avisos activados", body: "Así te avisaré aunque Brújula esté cerrada.", tag: "brujula-push-test", url: "./index.html#/ajustes/avisos" }, keys, 600, new Map());
    }
    return json({ ok: true, devices: Math.min((list || []).length, MAX_DEVICES), test: test ? { ok: test.ok, status: test.status } : null }, 200, allow);
  }

  if (action === "unsubscribe") {
    if (typeof body.endpoint !== "string" || body.endpoint.length > 1000) return json({ error: "Falta el dispositivo." }, 400, allow);
    await db.from(SUBS).delete().eq("user_id", uid).eq("endpoint", body.endpoint);
    const devices = await deviceCount();
    if (!devices) await db.from(QUEUE).delete().eq("user_id", uid).is("sent_at", null);
    return json({ ok: true, devices }, 200, allow);
  }

  if (action === "sync") {
    const items = cleanItems(body.items);
    if (!items) return json({ error: "Lista de avisos no válida." }, 400, allow);
    const devices = await deviceCount();
    if (!devices) {
      await db.from(QUEUE).delete().eq("user_id", uid).is("sent_at", null);
      return json({ ok: true, queued: 0, devices: 0 }, 200, allow);
    }
    const stateAt = typeof body.state_at === "string" && Number.isFinite(Date.parse(body.state_at)) ? new Date(body.state_at).toISOString() : null;
    const { data: meta } = await db.from("brujula_push_meta").select("state_at").eq("user_id", uid).maybeSingle();
    // Un dispositivo con una copia más antigua no pisa la cola de uno más reciente.
    if (stateAt && meta?.state_at && Date.parse(meta.state_at) > Date.parse(stateAt)) return json({ ok: true, stale: true, queued: null, devices }, 200, allow);
    const del = await db.from(QUEUE).delete().eq("user_id", uid).is("sent_at", null);
    if (del.error) return json({ error: "No se pudo actualizar la cola." }, 500, allow);
    if (items.length) {
      const up = await db.from(QUEUE).upsert(items.map((i) => ({ ...i, user_id: uid })), { onConflict: "user_id,tag", ignoreDuplicates: true });
      if (up.error) return json({ error: "No se pudo guardar la cola." }, 500, allow);
    }
    await db.from("brujula_push_meta").upsert({ user_id: uid, state_at: stateAt ?? meta?.state_at ?? null, synced_at: new Date().toISOString() }, { onConflict: "user_id" });
    return json({ ok: true, queued: items.length, devices }, 200, allow);
  }

  if (action === "test") {
    const { data: subs } = await db.from(SUBS).select("id, user_id, endpoint, p256dh, auth").eq("user_id", uid).limit(MAX_DEVICES);
    let sent = 0;
    const cache = new Map<string, string>();
    for (const s of (subs || []) as Sub[]) {
      const r = await sendPush(s, { title: "Prueba de Brújula", body: "Los avisos con la app cerrada llegan a este dispositivo.", tag: "brujula-push-test", url: "./index.html#/ajustes/avisos" }, keys, 600, cache);
      if (r.ok) sent++;
      else if (r.gone) await db.from(SUBS).delete().eq("id", s.id);
    }
    return json({ ok: true, devices: (subs || []).length, sent }, 200, allow);
  }

  return json({ error: "Acción desconocida." }, 400, allow);
}

/** Lo llama el cron cada minuto. Reserva lo que toca, envía y anota el resultado. */
async function dispatch(req: Request): Promise<Response> {
  const secret = env("BRUJULA_CRON_SECRET");
  if (secret.length < 24 || !safeEqual(secret, req.headers.get("x-brujula-cron") || "")) return json({ error: "No autorizado." }, 401);
  const keys = vapidKeys();
  const db = admin();
  if (!keys || !db) return json({ error: "Faltan secretos VAPID o la clave de servicio." }, 503);
  const { data: rows, error } = await db.rpc("brujula_push_claim", { p_limit: 100 });
  if (error) return json({ error: "No se pudo leer la cola: " + error.message }, 500);
  const items = (rows || []) as any[];
  const users = [...new Set(items.map((r) => r.user_id))];
  const byUser = new Map<string, Sub[]>();
  if (users.length) {
    const { data: subs } = await db.from("brujula_push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", users);
    for (const s of (subs || []) as Sub[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]);
  }
  const cache = new Map<string, string>();
  const gone = new Set<string>(), okSubs = new Set<string>(), sentIds: string[] = [], failedIds: string[] = [];
  const now = Date.now();
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const r = items[index++];
      const ttl = Math.max(60, Math.min(3600, Math.round((Date.parse(r.expire_at) - now) / 1000)));
      let delivered = false;
      for (const s of byUser.get(r.user_id) || []) {
        if (gone.has(s.id)) continue;
        const res = await sendPush(s, { title: r.title, body: r.body, tag: r.tag, url: r.url }, keys!, ttl, cache);
        if (res.ok) { delivered = true; okSubs.add(s.id); } else if (res.gone) gone.add(s.id);
      }
      (delivered ? sentIds : failedIds).push(r.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
  if (sentIds.length) await db.from("brujula_push_queue").update({ status: "sent" }).in("id", sentIds);
  if (failedIds.length) await db.from("brujula_push_queue").update({ status: "failed" }).in("id", failedIds);
  if (gone.size) await db.from("brujula_push_subscriptions").delete().in("id", [...gone]);
  if (okSubs.size) await db.from("brujula_push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).in("id", [...okSubs]);
  await db.from("brujula_push_health").upsert({ id: 1, last_run_at: new Date().toISOString(), last_claimed: items.length, last_sent: sentIds.length, last_failed: failedIds.length }, { onConflict: "id" });
  return json({ ok: true, claimed: items.length, sent: sentIds.length, failed: failedIds.length, removed: gone.size }, 200);
}

if (!(globalThis as any).__BRUJULA_TEST__) (globalThis as any).Deno.serve(handler);
