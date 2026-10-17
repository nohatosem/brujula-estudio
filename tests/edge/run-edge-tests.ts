// Pruebas de la Edge Function con Bun: sustituye supabase-js por un simulador y
// intercepta fetch hacia Gemini. Uso: bun tests/edge/run-edge-tests.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const src = readFileSync(join(here, "../../supabase/functions/brujula-ai/index.ts"), "utf8");
const tmp = join(here, ".tmp");
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, "mock-supabase.ts"), `
export const calls: any = { rpc: 0, getUser: 0 };
export const mockState: any = { user: { id: "u1" }, remaining: 5, rpcError: null };
export function createClient(_url: string, _key: string, _opts: any) {
  return {
    auth: { getUser: async (_t: string) => { calls.getUser++; return mockState.user ? { data: { user: mockState.user }, error: null } : { data: { user: null }, error: { message: "bad" } }; } },
    rpc: async (name: string) => { calls.rpc++; if (name !== "brujula_ai_take_turn") throw new Error("rpc inesperada"); return mockState.rpcError ? { data: null, error: mockState.rpcError } : { data: mockState.remaining, error: null }; },
  };
}`);
writeFileSync(join(tmp, "fn.ts"), src.replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'import { createClient } from "./mock-supabase.ts";'));

const envMap: Record<string, string> = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", GEMINI_API_KEY: "clave-de-prueba" };
(globalThis as any).__BRUJULA_TEST__ = true;
// Bun: se crea un «Deno» mínimo. Deno: se sustituye Deno.env.get (Deno no se puede reasignar).
if ((globalThis as any).Deno?.env) (globalThis as any).Deno.env.get = (k: string) => envMap[k];
else (globalThis as any).Deno = { env: { get: (k: string) => envMap[k] } };
const geminiCalls: any[] = [];
let geminiReply: (model: string, body: any) => { status: number; json?: any } = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: "Hola" }] } }] } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.startsWith("https://generativelanguage.googleapis.com/")) {
    const model = u.split("/models/")[1].split(":")[0];
    const body = JSON.parse(init.body);
    geminiCalls.push({ model, body, key: init.headers["x-goog-api-key"] });
    const r = geminiReply(model, body);
    return new Response(JSON.stringify(r.json || {}), { status: r.status, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
}) as any;

const { handler } = await import(join(tmp, "fn.ts"));
const { mockState, calls } = await import(join(tmp, "mock-supabase.ts"));
const ORIGIN = "https://nohatosem.github.io";
const TOKEN = "Bearer " + "x".repeat(60);
const req = (body: any, { origin = ORIGIN, auth = TOKEN, method = "POST", raw = null as string | null } = {}) => new Request("https://x.supabase.co/functions/v1/brujula-ai", { method, headers: { origin, authorization: auth, "content-type": "application/json" }, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void>) { try { await fn(); pass++; console.log("ok -", name); } catch (e: any) { fail++; console.log("FALLO -", name, "\n   ", e?.message || e); } }
const eq = (a: any, b: any, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
const ok = (c: any, m: string) => { if (!c) throw new Error(m); };

const ctx = {
  today: "2026-10-17", now: "10:30", rules: { wake: "07:00", sleep: "23:00", lunchStart: "13:00", lunchEnd: "14:00", breakMins: 15, maxStudyMin: 360 },
  courses: [{ name: "Física I", difficulty: 5, importance: 5 }],
  schedule: [{ id: "b1", course: "Física I", date: "2026-10-18", start: "10:00", end: "11:00", title: "MRU", kind: "study", status: "scheduled", priority: "high", difficulty: 4, locked: false },
             { id: "b2", course: "Física I", date: "2026-10-19", start: "08:00", end: "10:00", title: "Clase", kind: "class", status: "scheduled", priority: "normal", difficulty: 3, locked: true }],
  topics: [{ title: "MRU", course: "Física I", mastery: 30, level: "review", due: "2026-10-17" }], evaluations: [], metrics: { studyMinByDay: { "2026-10-17": 120 }, conflicts: 0 },
};

await t("rechaza orígenes no autorizados", async () => { eq((await handler(req({}, { origin: "https://malo.example" }))).status, 403); });
await t("responde preflight CORS", async () => { const r = await handler(req({}, { method: "OPTIONS" })); eq(r.status, 204); eq(r.headers.get("access-control-allow-origin"), ORIGIN); });
await t("exige sesión", async () => { eq((await handler(req({ consent: true, message: "hola" }, { auth: "" }))).status, 401); });
await t("rechaza sesión caducada", async () => { mockState.user = null; const r = await handler(req({ consent: true, message: "hola" })); mockState.user = { id: "u1" }; eq(r.status, 401); });
await t("sin GEMINI_API_KEY → 503 claro", async () => { const k = envMap.GEMINI_API_KEY; delete envMap.GEMINI_API_KEY; const r = await handler(req({ consent: true, message: "hola" })); envMap.GEMINI_API_KEY = k; eq(r.status, 503); ok((await r.json()).error.includes("GEMINI_API_KEY"), "mensaje"); });
await t("exige consentimiento", async () => { eq((await handler(req({ consent: false, message: "hola" }))).status, 400); });
await t("rechaza cuerpos demasiado grandes", async () => { eq((await handler(req(null, { raw: JSON.stringify({ consent: true, message: "a", pad: "x".repeat(40000) }) }))).status, 413); });
await t("cuota agotada: no llama a Gemini", async () => { mockState.remaining = 0; const before = geminiCalls.length; const r = await handler(req({ consent: true, message: "hola" })); mockState.remaining = 5; eq(r.status, 429); eq(geminiCalls.length, before); });
await t("chat: clave solo en cabecera, sistema y respuesta", async () => {
  geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: "Un vector tiene magnitud y dirección." }] } }] } });
  const r = await handler(req({ consent: true, message: "¿Qué es un vector?", history: [{ role: "user", text: "hola" }, { role: "model", text: "hola" }] }));
  eq(r.status, 200); const j = await r.json();
  eq(j.reply, "Un vector tiene magnitud y dirección."); eq(j.remaining, 5); eq(j.model, "gemini-3.5-flash-lite");
  const last = geminiCalls.at(-1); eq(last.key, "clave-de-prueba"); ok(!JSON.stringify(last.body).includes("clave-de-prueba"), "la clave no va en el cuerpo");
  ok(last.body.system_instruction.parts[0].text.includes("tutor"), "instrucción de tutor"); eq(last.body.contents.length, 3);
});
await t("modelo configurable con GEMINI_MODEL", async () => { envMap.GEMINI_MODEL = "gemini-x"; await handler(req({ consent: true, message: "hola" })); delete envMap.GEMINI_MODEL; eq(geminiCalls.at(-1).model, "gemini-x"); });
await t("si el modelo no existe (404) usa el de respaldo", async () => {
  geminiReply = (m) => m === "gemini-3.5-flash-lite" ? { status: 404, json: { error: { message: "not found" } } } : { status: 200, json: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } };
  const r = await handler(req({ consent: true, message: "hola" })); const j = await r.json();
  eq(r.status, 200); eq(j.model, "gemini-3.1-flash-lite");
});
await t("429 de Google → mensaje de cuota", async () => { geminiReply = () => ({ status: 429, json: {} }); const r = await handler(req({ consent: true, message: "hola" })); eq(r.status, 429); eq((await r.json()).code, "GEMINI_QUOTA"); });
await t("analyze: filtra borrados, protegidos, cursos inventados y formatos", async () => {
  geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ version: 1, summary: "Semana cargada antes del parcial.", insights: [{ type: "risk", title: "Parcial en 3 días", detail: "Preparación baja" }, { type: "raro", title: "Repasa MRU" }], changes: [
    { action: "delete", id: "b1" },
    { action: "update", id: "b2", start: "09:00", end: "11:00" },
    { action: "add", course: "Química", date: "2026-10-18", start: "16:00", end: "16:30", title: "x", kind: "study" },
    { action: "add", course: "Física I", date: "2026-10-18", start: "16:00", end: "16:30", title: "Repaso: MRU", kind: "exam", priority: "urgentísimo", difficulty: 9, reason: "Toca repaso", secret: "no" },
    { action: "update", id: "b1", date: "2026-10-18", start: "17:00", end: "18:00", kind: "personal" },
    { action: "add", course: "Física I", date: "18/10", start: "16:00", end: "16:30", title: "fecha mala", kind: "study" },
  ] }) }] } }] } });
  const r = await handler(req({ mode: "analyze", consent: true, shareSchedule: true, message: "", context: ctx }));
  eq(r.status, 200); const j = await r.json();
  eq(j.analysis.summary, "Semana cargada antes del parcial.");
  eq(j.analysis.insights.map((x: any) => x.type), ["risk", "tip"]);
  eq(j.analysis.changes.length, 2);
  const add = j.analysis.changes[0], upd = j.analysis.changes[1];
  eq([add.action, add.kind, add.priority, add.difficulty, "secret" in add], ["add", "study", "normal", 5, false]);
  eq([upd.action, upd.id, "kind" in upd], ["update", "b1", false]);
  const sent = geminiCalls.at(-1).body; ok(sent.generationConfig.responseMimeType === "application/json", "JSON"); ok(sent.contents[0].parts[0].text.includes("DATOS (JSON)"), "datos marcados como datos");
});
await t("analyze/plan exigen permiso de compartir horario", async () => { eq((await handler(req({ mode: "plan", consent: true, message: "organiza", context: ctx }))).status, 400); });
await t("plan: pregunta aclaratoria sin cambios", async () => {
  geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: '```json\n{"version":1,"explanation":"","changes":[],"question":"¿Qué día prefieres?"}\n```' }] } }] } });
  const j = await (await handler(req({ mode: "plan", consent: true, shareSchedule: true, message: "organiza mi semana", context: ctx }))).json();
  eq(j.clarification, "¿Qué día prefieres?"); eq(j.proposal.changes, []);
});
await t("compatibilidad 3.8: schedule_proposal intacto", async () => {
  geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ version: 1, changes: [{ action: "update", id: "b1", start: "16:00", end: "17:00" }] }) }] } }] } });
  const r = await handler(req({ mode: "schedule_proposal", consent: true, shareSchedule: true, message: "mueve MRU", courses: ["Física I"], schedule: ctx.schedule, preferences: { wake: "07:00" } }));
  const j = await r.json(); eq(r.status, 200); eq(j.proposal.changes.length, 1);
  geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ version: 1, changes: [{ action: "delete", id: "b1" }] }) }] } }] } });
  eq((await handler(req({ mode: "schedule_proposal", consent: true, shareSchedule: true, message: "borra", courses: [], schedule: [] }))).status, 502);
});
await t("orígenes extra con BRUJULA_ALLOWED_ORIGINS", async () => { envMap.BRUJULA_ALLOWED_ORIGINS = "http://localhost:4173"; geminiReply = () => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }); const r = await handler(req({ consent: true, message: "hola" }, { origin: "http://localhost:4173" })); delete envMap.BRUJULA_ALLOWED_ORIGINS; eq(r.status, 200); });
console.log(`\n${pass} correctas, ${fail} fallidas · rpc=${calls.rpc} getUser=${calls.getUser}`);
if (fail) process.exit(1);
