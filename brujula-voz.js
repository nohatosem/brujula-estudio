/* Brújula 3.7 · Conversación por voz con Gemini: Web Speech API.
   El micrófono solo comienza por acción explícita del usuario.
   Algunos navegadores pueden enviar audio a su proveedor de reconocimiento.
   No se graban ni guardan archivos de audio en Supabase. */
(() => {
 "use strict";
 const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
 const synth = window.speechSynthesis;
 const $ = id => document.getElementById(id);
 let conversation = false;
 let recognition = null;
 let speaking = false;
 let phase = "idle";
 let epoch = 0;

 const activePanel = () => Boolean($("brujulaAiFeed"));
 const currentUser = () => window.brujulaAi?.getUserId?.() || "";

 function status(message, isError = false) {
   const target = $("brujulaVoiceStatus");
   if (target) {
     target.textContent = message;
     target.dataset.type = isError ? "error" : "info";
   }
 }
 function controls() {
   const talk = $("brujulaVoiceTalk");
   const dictate = $("brujulaVoiceDictate");
   if (talk) {
     talk.textContent = conversation ? "⏹ Detener conversación" : "🎙 Conversar por voz";
     talk.setAttribute("aria-pressed", String(conversation));
     talk.disabled = !Recognition || !currentUser();
   }
   if (dictate) {
     dictate.disabled = !Recognition || !currentUser() || conversation || phase === "listening";
     dictate.textContent = phase === "dictation" ? "🎤 Escuchando…" : "🎤 Dictar pregunta";
   }
 }
 function stop(message = "Conversación por voz detenida.", announce = true) {
   epoch += 1;
   conversation = false;
   phase = "idle";
   speaking = false;
   const old = recognition;
   recognition = null;
   if (old) {
     old.onresult = null;
     old.onerror = null;
     old.onend = null;
     try { old.abort(); } catch (_) {}
   }
   if (synth) {
     try { synth.cancel(); } catch (_) {}
   }
   controls();
   if (announce && activePanel()) status(message);
 }

 function speak(answer, thenListen) {
   if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
     stop("Este navegador no puede leer respuestas en voz alta.", true);
     return;
   }
   if (recognition) { stop("No se puede hablar mientras el micrófono está activo.", true); return; }
   const mark = epoch;
   const text = String(answer || "")
     .replace(/https?:\/\/\S+/g, "enlace")
     .replace(/[*_#\x60]/g, "")
     .slice(0, 1900).trim();
   if (!text) {
     if (thenListen && conversation) listen("conversation");
     return;
   }
   try {
     synth.cancel();
     const utter = new SpeechSynthesisUtterance(text);
     utter.lang = "es-PE";
     utter.rate = 0.95;
     utter.pitch = 1;
     const voices = synth.getVoices();
     const selected = voices.find(v => v.lang.toLowerCase() === "es-pe")
       || voices.find(v => v.lang.toLowerCase().startsWith("es"));
     if (selected) utter.voice = selected;
     speaking = true;
     phase = "speaking";
     status(thenListen ? "🔊 Brújula está respondiendo. Después volverá a escuchar." : "🔊 Reproduciendo respuesta.");
     controls();
     utter.onend = () => {
       if (mark !== epoch) return;
       speaking = false;
       phase = "idle";
       if (thenListen && conversation && activePanel() && currentUser()) listen("conversation");
       else { controls(); status("La respuesta terminó."); }
     };
     utter.onerror = () => {
       if (mark !== epoch) return;
       stop("No pude reproducir la voz. Puedes leer la respuesta en pantalla.");
     };
     synth.speak(utter);
   } catch (_) {
     stop("No se pudo iniciar la voz del navegador.", true);
   }
 }

 function listen(kind) {
   if (!Recognition) {
     stop("Este navegador no admite reconocimiento de voz. Utiliza Chrome o escribe tu pregunta.");
     return;
   }
   if (!activePanel() || !currentUser()) {
     stop("Abre Mi asistente e inicia sesión para usar la voz.");
     return;
   }
   if (recognition || speaking) return;
   if (kind === "conversation" && !$("brujulaAiConsent")?.checked) {
     stop("Primero autoriza el envío de la conversación a Gemini marcando la casilla.");
     return;
   }
   const mark = epoch;
   const rec = new Recognition();
   recognition = rec;
   phase = kind === "dictation" ? "dictation" : "listening";
   let recognized = "";
   let hasError = false;
   rec.lang = "es-PE";
   rec.continuous = false;
   rec.interimResults = true;
   rec.maxAlternatives = 1;
   rec.onresult = event => {
     if (mark !== epoch || recognition !== rec) return;
     let final = "", interim = "";
     for (let i = 0; i < event.results.length; i++) {
       const alt = event.results[i]?.[0]?.transcript || "";
       if (event.results[i].isFinal) final += alt + " ";
       else interim += alt + " ";
     }
     const input = $("brujulaAiInput");
     if (input) input.value = (final || interim).trim().slice(0, 1800);
     if (final.trim()) recognized = final.trim().slice(0, 1800);
   };
   rec.onerror = event => {
     if (mark !== epoch || recognition !== rec) return;
     hasError = true;
     const messages = {
       "not-allowed":"El micrófono está bloqueado. Permite el acceso desde el candado de Chrome.",
       "service-not-allowed":"El servicio de reconocimiento de voz no está permitido.",
       "audio-capture":"No se detectó ningún micrófono.",
       "network":"El reconocimiento de voz necesita conexión o no pudo conectar.",
       "no-speech":"No escuché ninguna frase. Pulsa el micrófono para volver a intentar.",
       "aborted":"Se detuvo el micrófono."
     };
     stop(messages[event.error] || "No se pudo reconocer tu voz.");
   };
   rec.onend = () => {
     if (mark !== epoch || recognition !== rec || hasError) return;
     recognition = null;
     phase = "idle";
     controls();
     if (!activePanel() || !currentUser()) { stop("", false); return; }
     if (kind === "dictation") {
       status(recognized ? "✅ Dictado listo. Revisa la pregunta y pulsa Enviar." : "No capté ninguna frase. Puedes intentarlo otra vez.");
       return;
     }
     if (!conversation) return;
     if (!recognized) {
       stop("No escuché una pregunta. La conversación se pausó para proteger tu privacidad.");
       return;
     }
     status("📨 Pregunta reconocida. Consultando Gemini…");
     if (!window.brujulaAi?.ask || window.brujulaAi.isBusy?.()) {
       stop("El chat está ocupado. Espera a que termine antes de hablar.");
       return;
     }
     void window.brujulaAi.ask();
   };
   try {
     rec.start();
     status(kind === "conversation" ? "🎙 Escuchando. Habla ahora y deja una pausa al terminar." : "🎤 Dictando. Habla ahora; revisa el texto antes de enviarlo.");
     controls();
   } catch (_) {
     stop("Chrome no pudo activar el micrófono. Revisa los permisos y prueba de nuevo.");
   }
 }

 document.addEventListener("click", event => {
   const button = event.target?.closest?.("[data-brujula-voice]");
   if (!button) return;
   const action = button.dataset.brujulaVoice;
   if (action === "talk") {
     if (conversation) { stop(); return; }
     if (window.brujulaAi?.isBusy?.()) { status("Espera a que termine la respuesta anterior."); return; }
     stop("", false);
     conversation = true;
     controls();
     listen("conversation");
   } else if (action === "dictate") {
     if (conversation) stop("", false);
     else if (recognition) { stop("Dictado detenido."); return; }
     listen("dictation");
   }
 });

 window.addEventListener("brujula-ai-response", event => {
   if (!conversation || !activePanel() || event.detail?.userId !== currentUser()) return;
   speak(event.detail.reply, true);
 });
 window.addEventListener("brujula-ai-error", event => {
   if (conversation && event.detail?.userId === currentUser()) stop("Se interrumpió la conversación. Revisa el aviso del chat y vuelve a intentar.");
 });
 window.addEventListener("brujula-ai-account-change", () => stop("", false));
 document.addEventListener("visibilitychange", () => {
   if (document.hidden && (conversation || recognition)) stop("El micrófono se detuvo al salir de esta pestaña.");
 });
 window.addEventListener("pagehide", () => stop("", false));

 const observer = new MutationObserver(() => {
   if ((conversation || recognition || speaking) && !activePanel()) {
     stop("", false);
   }
   if (activePanel()) {
     const talk = $("brujulaVoiceTalk");
     if (talk && !talk.dataset.ready) {
       talk.dataset.ready = "1";
       controls();
       if (!Recognition) status("Este Chrome no tiene reconocimiento de voz disponible. Puedes escribir o usar Escuchar.");
     }
   }
 });
 observer.observe(document.body, {subtree:true,childList:true});
 window.brujulaVoice = {stop};
})();