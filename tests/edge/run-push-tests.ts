// Pruebas de la Edge Function «brujula-push» con Bun (sin red ni Supabase real):
// - cifrado: vector del RFC 8291 (Apéndice A) e interoperabilidad con la implementación
//   de referencia (tests/edge/vendor/ece.cjs);
// - firma VAPID verificada con node:crypto;
// - acciones config/subscribe/sync/unsubscribe/test/dispatch con una base simulada.
// Uso: bun tests/edge/run-push-tests.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import nodeCrypto from "node:crypto";

const here = new URL(".", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const ece = require(join(here, "vendor/ece.cjs"));
const src = readFileSync(join(here, "../../supabase/functions/brujula-push/index.ts"), "utf8");
const tmp = join(here, ".tmp");
mkdirSync(tmp, { recursive: true });

// ——— Supabase simulado: tablas en memoria con las mismas restricciones que el SQL ———
writeFileSync(join(tmp, "mock-supabase-push.ts"), `
export const db: any = { tables: { brujula_push_subscriptions: [], brujula_push_queue: [], brujula_push_meta: [], brujula_push_health: [] }, users: {}, now: () => Date.now() };
let seq = 0;
const uniq: any = { brujula_push_subscriptions: [["endpoint"]], brujula_push_queue: [["user_id", "tag"]], brujula_push_meta: [["user_id"]], brujula_push_health: [["id"]] };
class Q {
  db: any; t: string; op = "select"; f: any[] = []; o: any = {}; rows: any[] = []; v: any; ord: any; lim: any; single = false; up: any = {};
  constructor(d: any, t: string) { this.db = d; this.t = t; }
  select(_c = "*", o: any = {}) { if (this.op === "select") this.o = o; return this; }
  insert(r: any) { this.op = "insert"; this.rows = [].concat(r); return this; }
  upsert(r: any, o: any = {}) { this.op = "upsert"; this.rows = [].concat(r); this.up = o; return this; }
  update(v: any) { this.op = "update"; this.v = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.f.push((r: any) => r[c] === v); return this; }
  is(c: string, v: any) { this.f.push((r: any) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: any[]) { this.f.push((r: any) => vs.includes(r[c])); return this; }
  order(c: string, o: any = {}) { this.ord = [c, o.ascending !== false]; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res: any, rej: any) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
  match(r: any) { return this.f.every((fn) => fn(r)); }
  conflict(row: any, keys: string[]) { return this.db.tables[this.t].find((x: any) => keys.every((k) => x[k] === row[k])); }
  run() {
    const T = this.db.tables[this.t];
    if (!T) return { data: null, error: { message: "tabla inexistente " + this.t } };
    if (this.op === "insert") {
      for (const r of this.rows) for (const keys of uniq[this.t]) if (this.conflict(r, keys)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      for (const r of this.rows) T.push({ id: "id-" + (++seq), created_at: new Date(Date.now() + seq).toISOString(), sent_at: null, status: "queued", ...r });
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const keys = String(this.up.onConflict || "id").split(",");
      for (const r of this.rows) {
        const ex = this.conflict(r, keys);
        if (ex) { if (!this.up.ignoreDuplicates) Object.assign(ex, r); }
        else T.push({ id: "id-" + (++seq), created_at: new Date().toISOString(), sent_at: null, status: "queued", ...r });
      }
      return { data: null, error: null };
    }
    if (this.op === "update") { for (const r of T) if (this.match(r)) Object.assign(r, this.v); return { data: null, error: null }; }
    if (this.op === "delete") { this.db.tables[this.t] = T.filter((r: any) => !this.match(r)); return { data: null, error: null }; }
    let out = T.filter((r: any) => this.match(r)).map((r: any) => ({ ...r }));
    if (this.ord) { const [c, asc] = this.ord; out.sort((a: any, b: any) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
    if (this.lim) out = out.slice(0, this.lim);
    if (this.o.head) return { data: null, error: null, count: out.length };
    if (this.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null, count: out.length };
  }
}
export function createClient(_u: string, key: string, _o: any) {
  if (!key) throw new Error("sin clave");
  return {
    auth: { getUser: async (t: string) => db.users[t] ? { data: { user: { id: db.users[t] } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } } },
    from: (t: string) => new Q(db, t),
    rpc: async (name: string, args: any) => {
      if (name !== "brujula_push_claim") return { data: null, error: { message: "rpc inesperada" } };
      const now = db.now(), Q2 = db.tables.brujula_push_queue;
      for (const r of Q2) if (!r.sent_at && Date.parse(r.expire_at) <= now) { r.status = "expired"; r.sent_at = new Date(now).toISOString(); }
      db.tables.brujula_push_queue = Q2.filter((r: any) => !(r.sent_at && Date.parse(r.sent_at) < now - 3 * 86400000));
      const due = db.tables.brujula_push_queue.filter((r: any) => !r.sent_at && Date.parse(r.fire_at) <= now + 45000 && Date.parse(r.expire_at) > now).sort((a: any, b: any) => a.fire_at.localeCompare(b.fire_at)).slice(0, args?.p_limit ?? 100);
      for (const r of due) { r.status = "sending"; r.sent_at = new Date(now).toISOString(); }
      return { data: due.map((r: any) => ({ ...r })), error: null };
    },
  };
}`);
writeFileSync(join(tmp, "push-fn.ts"), src.replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'import { createClient } from "./mock-supabase-push.ts";'));

// ——— Entorno ———
const vapidPair = nodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const vjwk: any = vapidPair.privateKey.export({ format: "jwk" });
const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), Buffer.from(vjwk.x, "base64url"), Buffer.from(vjwk.y, "base64url")]).toString("base64url");
const CRON = "c".repeat(32);
const envMap: Record<string, string> = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-de-prueba", VAPID_PUBLIC_KEY: VAPID_PUBLIC, VAPID_PRIVATE_KEY: vjwk.d, VAPID_SUBJECT: "mailto:prueba@example.com", BRUJULA_CRON_SECRET: CRON };
(globalThis as any).__BRUJULA_TEST__ = true;
// Bun: se crea un «Deno» mínimo. Deno: se sustituye Deno.env.get (Deno no se puede reasignar).
if ((globalThis as any).Deno?.env) (globalThis as any).Deno.env.get = (k: string) => envMap[k];
else (globalThis as any).Deno = { env: { get: (k: string) => envMap[k] } };

// Servicio de push simulado: guarda lo que recibe; un endpoint «gone» responde 410.
const pushed: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\//.test(u)) {
    pushed.push({ url: u, headers: init.headers, body: Buffer.from(init.body) });
    return new Response("", { status: u.includes("/gone") ? 410 : 201 });
  }
  if (u.startsWith("https://")) throw new Error("red no permitida en pruebas: " + u);
  return realFetch(url, init);
}) as any;

const mod = await import(join(tmp, "push-fn.ts"));
const { handler, encryptPayload, vapidHeader, pushEndpointOk, cleanItems, b64uDecode, b64uEncode } = mod;
const { db } = await import(join(tmp, "mock-supabase-push.ts"));

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) { try { await fn(); pass++; console.log("ok -", name); } catch (e: any) { fail++; console.log("FALLO -", name, "\n   ", e?.stack || e?.message || e); } }
const eq = (a: any, b: any, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const ok = (c: any, m: string) => { if (!c) throw new Error(m); };

const ORIGIN = "https://nohatosem.github.io";
const TOK_A = "a".repeat(64), TOK_B = "b".repeat(64);
db.users[TOK_A] = "user-a"; db.users[TOK_B] = "user-b";
const call = (body: any, { token = TOK_A, origin = ORIGIN, headers = {} as Record<string, string>, method = "POST" } = {}) =>
  handler(new Request("https://x.supabase.co/functions/v1/brujula-push", { method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(token ? { authorization: "Bearer " + token } : {}), ...headers }, body: method === "POST" ? JSON.stringify(body) : undefined }));

/** Navegador simulado: par ECDH + secreto de autenticación, como PushSubscription.toJSON(). */
function browser(endpoint: string) {
  const ecdh = nodeCrypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  return { ecdh, auth, json: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } } };
}
const decrypt = (b: ReturnType<typeof browser>, body: Buffer) => JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: b.ecdh, authSecret: b.auth }).toString());

// ——— Cifrado y firma ———
await t("cifrado: reproduce el vector del RFC 8291 (Apéndice A)", async () => {
  const asPub = b64uDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", x: b64uEncode(asPub.slice(1, 33)), y: b64uEncode(asPub.slice(33)), ext: true }, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const out = await encryptPayload(new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    b64uDecode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"), b64uDecode("BTBZMqHH6r4Tts7J_aSIgg"),
    { salt: b64uDecode("DGv6ra1nlYgDCS1FRnbzlw"), privateKey, publicKey: asPub });
  eq(b64uEncode(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN", "mensaje cifrado");
});
await t("cifrado: la implementación de referencia lo descifra (claves aleatorias, texto con tildes)", async () => {
  const b = browser("https://fcm.googleapis.com/fcm/send/x");
  const msg = { title: "10:00 · Física: ¿cinemática?", body: "Empieza en 10 min. ñandú", tag: "b-1", url: "./index.html#/hoy" };
  const out = await encryptPayload(new TextEncoder().encode(JSON.stringify(msg)), b.ecdh.getPublicKey(), b.auth);
  eq(decrypt(b, Buffer.from(out)), msg);
  const again = await encryptPayload(new TextEncoder().encode(JSON.stringify(msg)), b.ecdh.getPublicKey(), b.auth);
  ok(Buffer.compare(Buffer.from(out), Buffer.from(again)) !== 0, "cada envío usa sal y clave efímera nuevas");
});
await t("cifrado: rechaza claves del navegador mal formadas", async () => {
  let threw = 0;
  for (const [k, a] of [[new Uint8Array(64), new Uint8Array(16)], [new Uint8Array(65).fill(4), new Uint8Array(15)]]) { try { await encryptPayload(new Uint8Array(3), k, a); } catch { threw++; } }
  eq(threw, 2);
});
await t("VAPID: firma ES256 válida, audiencia del servicio, caducidad < 24 h", async () => {
  const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", { publicKey: VAPID_PUBLIC, privateKey: vjwk.d, subject: "mailto:prueba@example.com" }, 1_800_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  ok(m, "formato vapid t=…, k=…"); eq(m![4], VAPID_PUBLIC, "k");
  const claims = JSON.parse(Buffer.from(m![2], "base64url").toString());
  eq(claims.aud, "https://fcm.googleapis.com"); eq(claims.sub, "mailto:prueba@example.com"); eq(claims.exp, 1_800_000_000 + 12 * 3600);
  eq(JSON.parse(Buffer.from(m![1], "base64url").toString()), { typ: "JWT", alg: "ES256" });
  const signed = Buffer.from(`${m![1]}.${m![2]}`), sig = Buffer.from(m![3], "base64url");
  eq(sig.length, 64, "firma JWS en formato r||s");
  // 1) WebCrypto con la clave pública anunciada en k=… (la que usará el servicio de push).
  const pub = await crypto.subtle.importKey("raw", b64uDecode(m![4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, signed), "WebCrypto verifica la firma");
  // 2) Implementación independiente (OpenSSL vía node:crypto), convirtiendo r||s a DER.
  const der = (x: Buffer) => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; let v = x.subarray(i); if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]); return Buffer.concat([Buffer.from([2, v.length]), v]); };
  const r = der(sig.subarray(0, 32)), sv = der(sig.subarray(32));
  ok(nodeCrypto.verify("sha256", signed, vapidPair.publicKey, Buffer.concat([Buffer.from([0x30, r.length + sv.length]), r, sv])), "node:crypto verifica la firma");
});
await t("solo servicios de push conocidos (sin peticiones a sitios arbitrarios)", () => {
  for (const u of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/a", "https://web.push.apple.com/a", "https://wns2-par02p.notify.windows.com/w/?token=a"]) ok(pushEndpointOk(u), "admite " + u);
  for (const u of ["http://fcm.googleapis.com/a", "https://fcm.googleapis.com.evil.com/a", "https://evil.com/fcm.googleapis.com", "https://169.254.169.254/latest", "https://localhost/a", "https://fcm.googleapis.com:8443/a", "https://user:pw@fcm.googleapis.com/a", "javascript:alert(1)", 42, null]) ok(!pushEndpointOk(u), "rechaza " + u);
});
await t("cola: valida formato, horizonte de 8 días, máximo 60 y enlaces internos", () => {
  const now = Date.parse("2026-10-17T15:00:00Z");
  const base = { fire_at: "2026-10-17T16:00:00Z", expire_at: "2026-10-17T16:15:00Z", title: "  Clase  ", body: "x", url: "./index.html#/sesion/b-1" };
  const r = cleanItems([
    { ...base, tag: "b-ok" }, { ...base, tag: "b-ok" }, { ...base, tag: "mal tag" }, { ...base, tag: "b-past", fire_at: "2026-10-17T14:00:00Z" },
    { ...base, tag: "b-far", fire_at: "2026-10-30T10:00:00Z" }, { ...base, tag: "b-url", url: "https://phish.example" }, { ...base, tag: "b-notitle", title: "  " },
    { ...base, tag: "b-exp", expire_at: "2026-10-20T10:00:00Z" },
  ], now);
  eq(r.map((x: any) => x.tag), ["b-ok", "b-url", "b-exp"]);
  eq(r[0].title, "Clase"); eq(r[1].url, "./index.html#/hoy"); eq(r[2].expire_at, "2026-10-18T16:00:00.000Z", "caduca como mucho 1 día después");
  eq(cleanItems(Array.from({ length: 90 }, (_, i) => ({ ...base, tag: "t" + i })), now).length, 60);
  eq(cleanItems(Array.from({ length: 130 }, (_, i) => ({ ...base, tag: "t" + i })), now), null, "demasiados: se rechaza");
  eq(cleanItems("x" as any, now), null);
});

// ——— HTTP ———
await t("CORS: preflight permitido y origen desconocido rechazado", async () => {
  const r = await call({}, { method: "OPTIONS" }); eq(r.status, 204); eq(r.headers.get("access-control-allow-origin"), ORIGIN);
  eq((await call({ action: "config" }, { origin: "https://malo.example" })).status, 403);
});
await t("config sin secretos VAPID: desactivado (sin error y sin datos)", async () => {
  const k = envMap.VAPID_PRIVATE_KEY; delete envMap.VAPID_PRIVATE_KEY;
  const r = await call({ action: "config" }, { token: "" }); envMap.VAPID_PRIVATE_KEY = k;
  eq(r.status, 200); eq(await r.json(), { enabled: false, publicKey: null, lastRunAt: null });
});
await t("config exige sesión válida y devuelve la clave pública", async () => {
  eq((await call({ action: "config" }, { token: "" })).status, 401);
  eq((await call({ action: "config" }, { token: "z".repeat(64) })).status, 401);
  const r = await call({ action: "config" }); const j = await r.json();
  eq(r.status, 200); eq(j.enabled, true); eq(j.publicKey, VAPID_PUBLIC); eq(j.lastRunAt, null);
  ok(!JSON.stringify(j).includes(vjwk.d), "nunca expone la clave privada");
});

const phoneA = browser("https://fcm.googleapis.com/fcm/send/phone-a");
await t("subscribe: rechaza servicios desconocidos y claves inválidas", async () => {
  eq((await call({ action: "subscribe", subscription: { ...phoneA.json, endpoint: "https://evil.example/push" } })).status, 400);
  eq((await call({ action: "subscribe", subscription: { ...phoneA.json, keys: { p256dh: "corta", auth: phoneA.json.keys.auth } } })).status, 400);
  eq(db.tables.brujula_push_subscriptions.length, 0);
});
await t("subscribe: guarda el dispositivo y envía un aviso de prueba cifrado", async () => {
  pushed.length = 0;
  const r = await call({ action: "subscribe", subscription: phoneA.json, device: "Android · Chrome", test: true }); const j = await r.json();
  eq(r.status, 200); eq(j.devices, 1); eq(j.test, { ok: true, status: 201 });
  eq(db.tables.brujula_push_subscriptions.map((s: any) => [s.user_id, s.device]), [["user-a", "Android · Chrome"]]);
  eq(pushed.length, 1); eq(pushed[0].headers["content-encoding"], "aes128gcm");
  eq(decrypt(phoneA, pushed[0].body).title, "Avisos activados");
});
await t("subscribe: si otra cuenta usa el mismo navegador, la anterior deja de recibir aquí", async () => {
  const r = await call({ action: "subscribe", subscription: phoneA.json }, { token: TOK_B }); eq(r.status, 200);
  eq(db.tables.brujula_push_subscriptions.map((s: any) => s.user_id), ["user-b"]);
  await call({ action: "subscribe", subscription: phoneA.json }); // vuelve a la cuenta A
  eq(db.tables.brujula_push_subscriptions.map((s: any) => s.user_id), ["user-a"]);
});

const soon = (min: number) => new Date(Date.now() + min * 60000).toISOString();
const item = (tag: string, fireMin: number, title = "Clase " + tag) => ({ tag, fire_at: soon(fireMin), expire_at: soon(fireMin + 10), title, body: "Física I · empieza en 10 min.", url: "./index.html#/hoy" });
await t("sync: guarda solo para quien tiene dispositivos; reemplaza lo pendiente", async () => {
  const none = await (await call({ action: "sync", items: [item("b-x", 5)] }, { token: TOK_B })).json();
  eq(none, { ok: true, queued: 0, devices: 0 }); ok(!db.tables.brujula_push_queue.some((r: any) => r.user_id === "user-b"), "sin dispositivos no se guarda nada");
  const r = await (await call({ action: "sync", items: [item("b-1", 0), item("b-2", 30)], state_at: "2026-10-17T15:00:00Z" })).json();
  eq(r.queued, 2);
  await call({ action: "sync", items: [item("b-1", 0), item("b-3", 60)], state_at: "2026-10-17T15:05:00Z" });
  eq(db.tables.brujula_push_queue.map((x: any) => x.tag).sort(), ["b-1", "b-3"], "b-2 ya no está en el plan");
});
await t("sync: una copia más antigua de otro dispositivo no pisa la cola", async () => {
  const r = await (await call({ action: "sync", items: [item("b-viejo", 5)], state_at: "2026-10-17T14:00:00Z" })).json();
  eq(r.stale, true); eq(db.tables.brujula_push_queue.map((x: any) => x.tag).sort(), ["b-1", "b-3"]);
});

const gone = browser("https://fcm.googleapis.com/fcm/send/gone-device");
await t("dispatch: exige el secreto del cron", async () => {
  eq((await call({ action: "dispatch" }, { token: "", origin: "" })).status, 401);
  eq((await call({ action: "dispatch" }, { token: "", origin: "", headers: { "x-brujula-cron": "c".repeat(31) } })).status, 401);
});
await t("dispatch: envía lo que toca, cifrado, una sola vez; quita dispositivos dados de baja", async () => {
  await call({ action: "subscribe", subscription: gone.json, device: "viejo" });
  pushed.length = 0;
  const r = await call({ action: "dispatch" }, { token: "", origin: "", headers: { "x-brujula-cron": CRON } }); const j = await r.json();
  eq(r.status, 200); eq([j.claimed, j.sent, j.failed, j.removed], [1, 1, 0, 1]);
  const toPhone = pushed.filter((p) => p.url.endsWith("/phone-a"));
  eq(toPhone.length, 1);
  const msg = decrypt(phoneA, toPhone[0].body);
  eq(msg, { title: "Clase b-1", body: "Física I · empieza en 10 min.", tag: "b-1", url: "./index.html#/hoy" });
  const ttl = Number(toPhone[0].headers.ttl); ok(ttl >= 60 && ttl <= 3600, "TTL hasta que deja de servir: " + ttl);
  ok(/^vapid t=.+, k=/.test(toPhone[0].headers.authorization), "cabecera VAPID");
  eq(db.tables.brujula_push_subscriptions.map((s: any) => s.endpoint), [phoneA.json.endpoint], "el endpoint 410 se elimina");
  eq(db.tables.brujula_push_queue.find((x: any) => x.tag === "b-1").status, "sent");
  ok(db.tables.brujula_push_health[0]?.last_run_at, "registra la última ejecución");
  pushed.length = 0;
  const again = await (await call({ action: "dispatch" }, { token: "", origin: "", headers: { "x-brujula-cron": CRON } })).json();
  eq([again.claimed, pushed.length], [0, 0], "no repite avisos");
});
await t("sync tras enviar: un aviso ya enviado no se vuelve a encolar", async () => {
  await call({ action: "sync", items: [item("b-1", 0), item("b-3", 60)], state_at: "2026-10-17T15:10:00Z" });
  const b1 = db.tables.brujula_push_queue.filter((x: any) => x.tag === "b-1");
  eq(b1.length, 1); eq(b1[0].status, "sent");
  const r = await (await call({ action: "dispatch" }, { token: "", origin: "", headers: { "x-brujula-cron": CRON } })).json();
  eq(r.claimed, 0);
});
await t("config informa la última ejecución del envío programado", async () => {
  const j = await (await call({ action: "config" })).json(); ok(j.lastRunAt, "lastRunAt");
});
await t("test: envía a todos los dispositivos de la cuenta", async () => {
  pushed.length = 0;
  const j = await (await call({ action: "test" })).json();
  eq([j.devices, j.sent], [1, 1]); eq(decrypt(phoneA, pushed[0].body).tag, "brujula-push-test");
});
await t("unsubscribe: sin dispositivos, se vacía la cola pendiente", async () => {
  const j = await (await call({ action: "unsubscribe", endpoint: phoneA.json.endpoint })).json();
  eq(j.devices, 0);
  ok(!db.tables.brujula_push_queue.some((x: any) => x.user_id === "user-a" && !x.sent_at), "nada pendiente");
});
await t("acción desconocida y JSON inválido", async () => {
  eq((await call({ action: "borrar-todo" })).status, 400);
  const r = await handler(new Request("https://x.supabase.co/functions/v1/brujula-push", { method: "POST", headers: { origin: ORIGIN }, body: "{no" })); eq(r.status, 400);
});

console.log(`\n${pass}/${pass + fail} pruebas de brujula-push correctas`);
if (fail) (globalThis as any).process.exit(1);
