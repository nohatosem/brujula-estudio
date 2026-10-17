/* Brújula 3.6: chat educativo con Gemini a través de Supabase Edge Functions.
   El navegador NUNCA contiene GEMINI_API_KEY. Las conversaciones son temporales. */
(() => {
  let owner = "";
  let turns = [];
  let busy = false;
  let lastAnswer = "";
  const $ = id => document.getElementById(id);

  function sessionGuard() {
    const id = (typeof cloud !== "undefined" && cloud.user && cloud.user.id) || "";
    if (owner !== id) { owner = id; turns = []; lastAnswer = ""; }
    return !!id;
  }

  function show(message, type = "info") {
    const el = $("brujulaAiStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
  }

  function paint() {
    const feed = $("brujulaAiFeed");
    if (!feed) return;
    sessionGuard();
    feed.replaceChildren();
    if (!turns.length) {
      const intro = document.createElement("p");
      intro.className = "brujula-ai-welcome";
      intro.textContent = "¡Hola! Pregúntame sobre Física, programación u otra materia. También puedo ayudarte a pensar cómo organizar tus estudios.";
      feed.append(intro);
    }
    for (const item of turns) {
      const bubble = document.createElement("div");
      bubble.className = "brujula-ai-bubble " + (item.role === "user" ? "from-user" : "from-model");
      const heading = document.createElement("strong");
      heading.textContent = item.role === "user" ? "Tú" : "Gemini · tutor";
      const text = document.createElement("div");
      text.textContent = item.text;
      bubble.append(heading, text);
      feed.append(bubble);
    }
    feed.scrollTop = feed.scrollHeight;
    const send = $("brujulaAiSend");
    if (send) { send.disabled = busy; send.textContent = busy ? "Consultando…" : "Enviar pregunta →"; }
  }

  function scheduleSummary() {
    if (typeof state === "undefined" || !Array.isArray(state.blocks)) return [];
    return state.blocks
      .filter(b => b.status !== "mastered" && typeof b.date === "string")
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .slice(0, 25)
      .map(b => ({date: String(b.date || ""), start: String(b.start || ""), end: String(b.end || ""),
        title: String(b.title || "").slice(0, 90), status: String(b.status || "").slice(0, 30)}));
  }

  async function ask() {
    if (busy) return;
    if (!sessionGuard()) { show("Inicia sesión en Brújula para utilizar el chat.", "error"); return; }
    const input = $("brujulaAiInput");
    const consent = $("brujulaAiConsent");
    const share = $("brujulaAiShareSchedule");
    if (!input) return;
    const message = input.value.trim();
    if (!message) { show("Escribe primero tu pregunta.", "error"); return; }
    if (message.length > 1800) { show("La pregunta debe tener 1.800 caracteres o menos.", "error"); return; }
    if (!consent || !consent.checked) {
      show("Antes de conversar, acepta que tu mensaje se enviará a la API gratuita de Gemini de Google.", "error");
      return;
    }
    busy = true; paint(); show("Preparando una respuesta…");
    try {
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session || session.user.id !== owner) throw Error("Sesión no válida. Vuelve a iniciar sesión.");
      const body = {message, history: turns.slice(-8), consent: true,
        shareSchedule: !!share?.checked,
        schedule: share?.checked ? scheduleSummary() : []};
      const {data, error} = await client.functions.invoke("brujula-ai", {body});
      if (error) {
        let detail = "";
        if (error.context && typeof error.context.json === "function") {
          try { const json = await error.context.json(); detail = json.error || ""; } catch (_) {}
        }
        throw Error(detail || error.message || "No se pudo contactar con Gemini.");
      }
      if (!data || typeof data.reply !== "string") throw Error(data?.error || "Respuesta inválida.");
      turns.push({role:"user",text:message},{role:"model",text:data.reply});
      turns = turns.slice(-12);
      lastAnswer = data.reply;
      input.value = "";
      show("Respuesta recibida · " + String(data.remaining || 0) + " consultas restantes hoy.");
    } catch (err) {
      show(err.message || "Ocurrió un error. Inténtalo nuevamente.", "error");
    } finally {
      busy = false;
      paint();
    }
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-brujula-ai]");
    if (!btn) return;
    const action = btn.dataset.brujulaAi;
    if (action === "send") { void ask(); }
    if (action === "clear") { turns = []; lastAnswer = ""; paint(); show("Conversación temporal borrada."); }
    if (action === "speak") {
      if (!lastAnswer) return show("Todavía no hay una respuesta para escuchar.");
      if (!("speechSynthesis" in window)) return show("Este navegador no permite leer en voz alta.");
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(lastAnswer.slice(0, 2400));
      utter.lang = "es-PE"; utter.rate = 0.95;
      speechSynthesis.speak(utter);
    }
  });
  document.addEventListener("keydown", e => {
    if (e.target?.id === "brujulaAiInput" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); void ask();
    }
  });

  // Se repinta al visitar el asistente o cambiar de cuenta, sin guardar chats en Supabase.
  const observer = new MutationObserver(() => {
    if ($("brujulaAiFeed") && !$("brujulaAiFeed").dataset.ready) {
      $("brujulaAiFeed").dataset.ready = "1";
      paint();
    }
  });
  observer.observe(document.body, {subtree:true,childList:true});
  window.brujulaAi = {refresh:paint};
})();