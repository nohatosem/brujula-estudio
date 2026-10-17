// Brújula 4 · alta rápida en lenguaje natural (español, local, sin IA).
// «Repasar vectores mañana 4pm 45 min» → {title, date, start, end, kind, courseId}

import { addDays, todayISO, toHHMM, nowMin, weekdayIndex, isValidDate, pad } from '../core/dates.js';
import { norm } from '../core/util.js';

const WEEKDAY = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };
const MONTH = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, ene: 1, feb: 2, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const CONNECTORS = new Set(['a', 'de', 'del', 'el', 'la', 'las', 'los', 'para', 'en', 'por', 'y', 'al', 'desde', 'hasta', 'con', 'durante', 'esta', 'este']);
const EXAM_WORDS = /^(examen|examenes|parcial|final|evaluacion|control)$/;
const CLASS_WORDS = /^(clase|clases|laboratorio|lab|taller|seminario)$/;
const STUDY_WORDS = /^(repaso|repasar|estudiar|estudio|practicar|practica|ejercicios|leer|resolver|preparar|simulacro|tarea|deberes|tema)$/;
const PERSONAL_WORDS = /^(gym|gimnasio|correr|entrenar|entrenamiento|caminar|limpiar|limpieza|lavar|cocinar|comprar|compras|llamar|cita|medico|dentista|salir|cine|fiesta|cumpleanos|reunion|familia|amigos|pasear|dormir|siesta|meditar|yoga|futbol|jugar|trabajo|turno)$/;
export const DEFAULT_DURATION = { study: 45, class: 90, exam: 120, personal: 30 };

/** hint: 'manana' | 'tarde' | 'noche' | 'mediodia' | 'exact' | null */
function to24(h, m, meridiem, hint) {
  if (meridiem === 'pm' && h < 12) h += 12;
  else if (meridiem === 'am' && h === 12) h = 0;
  else if (!meridiem && hint !== 'exact' && hint !== 'manana' && hint !== 'mediodia') {
    if (hint === 'tarde' || hint === 'noche') { if (h < 12) h += 12; }
    else if (h >= 1 && h <= 6) h += 12; // «a las 3» casi siempre es por la tarde
  }
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function parseQuickAdd(text, opts = {}) {
  const now = opts.now || new Date();
  const today = opts.today || todayISO(now);
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  const words = raw ? raw.split(' ') : [];
  const toks = words.map((w) => norm(w).replace(/^[¿¡("'«]+|[?!,.;:)"'»]+$/g, ''));
  const used = new Array(words.length).fill(false);
  const take = (...idx) => idx.forEach((i) => { if (i >= 0 && i < used.length) used[i] = true; });
  const out = { title: '', date: null, start: null, end: null, duration: null, kind: null, courseId: null, priority: null, found: [] };

  // Prioridad
  toks.forEach((t, i) => {
    if (t === 'urgente' || words[i] === '!' || words[i] === '!!') { out.priority = 'critical'; take(i); }
    else if (t === 'importante') { out.priority = out.priority || 'high'; take(i); }
  });

  // Momento del día
  let hint = null;
  toks.forEach((t, i) => {
    if (t === 'tarde' || t === 'noche') {
      hint = t; take(i);
      if (toks[i - 1] === 'la') { take(i - 1); if (['de', 'por', 'en'].includes(toks[i - 2])) take(i - 2); }
      else if (toks[i - 1] === 'esta') { take(i - 1); if (!out.date) { out.date = today; out.found.push('date'); } }
    } else if (t === 'manana' && toks[i - 1] === 'la') {
      hint = 'manana'; take(i, i - 1); if (['de', 'por', 'en'].includes(toks[i - 2])) take(i - 2);
    } else if (t === 'mediodia') { hint = 'mediodia'; take(i); if (['al', 'a'].includes(toks[i - 1])) take(i - 1); }
  });

  // Fecha
  const setDate = (d, ...idx) => { if (!out.date && isValidDate(d)) { out.date = d; take(...idx); out.found.push('date'); } };
  toks.forEach((t, i) => {
    if (used[i]) return;
    if (t === 'hoy') setDate(today, i);
    else if (t === 'pasado' && toks[i + 1] === 'manana') setDate(addDays(today, 2), i, i + 1);
    else if (t === 'manana' && toks[i - 1] !== 'pasado') setDate(addDays(today, 1), i);
    else if (t in WEEKDAY) {
      let delta = (WEEKDAY[t] - weekdayIndex(today) + 7) % 7;
      const prev = toks[i - 1];
      if (['proximo', 'siguiente', 'prox'].includes(prev) && delta === 0) delta = 7;
      setDate(addDays(today, delta), i, ['el', 'este', 'proximo', 'siguiente', 'prox', 'para'].includes(prev) ? i - 1 : -1);
    }
  });
  if (!out.date) {
    for (let i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      let m = toks[i].match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
      if (m && +m[2] >= 1 && +m[2] <= 12) {
        let y = m[3] ? +m[3] : +today.slice(0, 4);
        if (y < 100) y += 2000;
        let d = `${y}-${pad(+m[2])}-${pad(+m[1])}`;
        if (!m[3] && d < today) d = `${y + 1}-${pad(+m[2])}-${pad(+m[1])}`;
        setDate(d, i, toks[i - 1] === 'el' ? i - 1 : -1);
        if (out.date) break;
      }
      m = toks[i].match(/^(\d{1,2})$/);
      if (m && toks[i + 1] === 'de' && (toks[i + 2] in MONTH)) {
        const y = +today.slice(0, 4);
        let d = `${y}-${pad(MONTH[toks[i + 2]])}-${pad(+m[1])}`;
        if (d < today) d = `${y + 1}-${pad(MONTH[toks[i + 2]])}-${pad(+m[1])}`;
        setDate(d, i, i + 1, i + 2, toks[i - 1] === 'el' ? i - 1 : -1);
        if (out.date) break;
      }
      if (m && toks[i - 1] === 'el' && +m[1] >= 1 && +m[1] <= 31) {
        const [y, mo] = today.split('-').map(Number);
        let d = `${y}-${pad(mo)}-${pad(+m[1])}`;
        if (d < today) d = mo === 12 ? `${y + 1}-01-${pad(+m[1])}` : `${y}-${pad(mo + 1)}-${pad(+m[1])}`;
        setDate(d, i, i - 1);
        if (out.date) break;
      }
    }
  }

  // Duración
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    const t = toks[i];
    const prev = toks[i - 1];
    let m;
    if (t === 'media' && toks[i + 1] === 'hora') { out.duration = 30; take(i, i + 1); break; }
    if (t === 'hora' && toks[i + 1] === 'y' && toks[i + 2] === 'media') { out.duration = 90; take(i, i + 1, i + 2); if (prev === 'una' || prev === '1') take(i - 1); break; }
    if ((m = t.match(/^(\d+)h(\d{1,2})?$/)) && (+m[1] <= 4 || m[2] || prev === 'durante' || prev === 'por')) { out.duration = +m[1] * 60 + (+m[2] || 0); take(i); break; }
    if ((m = t.match(/^(\d+(?:[.,]\d+)?)$/)) && /^(h|hr|hrs|hora|horas)$/.test(toks[i + 1] || '')) {
      out.duration = Math.round(parseFloat(m[1].replace(',', '.')) * 60); take(i, i + 1);
      if (/^\d+$/.test(toks[i + 2] || '') && /^(m|min|mins|minutos)$/.test(toks[i + 3] || '')) { out.duration += +toks[i + 2]; take(i + 2, i + 3); }
      break;
    }
    if ((m = t.match(/^(\d+)(m|min|mins|minutos)$/))) { out.duration = +m[1]; take(i); break; }
    if ((m = t.match(/^(\d+)$/)) && /^(m|min|mins|minutos)$/.test(toks[i + 1] || '')) { out.duration = +m[1]; take(i, i + 1); break; }
    if ((t === 'una' || t === '1') && toks[i + 1] === 'hora') { out.duration = 60; take(i, i + 1); break; }
  }
  if (out.duration) { out.found.push('duration'); toks.forEach((t, i) => { if (!used[i] && (t === 'durante' || t === 'por') && used[i + 1]) take(i); }); }

  // Horas y rangos
  const timeAt = (i) => {
    const t = toks[i] || '';
    let m = t.match(/^(\d{1,2})(?::|\.|h)(\d{2})(am|pm)?$/);
    if (m) {
      const mer = m[3] || (/^(am|pm)$/.test(toks[i + 1] || '') ? toks[i + 1] : null);
      const exact = (m[1].length === 2 && m[1][0] === '0') || +m[1] >= 13;
      return { min: to24(+m[1], +m[2], mer, exact ? 'exact' : hint), used: mer && !m[3] ? [i, i + 1] : [i], explicit: true };
    }
    if ((m = t.match(/^(\d{1,2})(am|pm)$/))) return { min: to24(+m[1], 0, m[2]), used: [i], explicit: true };
    if ((m = t.match(/^(\d{1,2})(h|hs)$/))) return { min: to24(+m[1], 0, null, +m[1] >= 13 || m[1][0] === '0' ? 'exact' : hint), used: [i], explicit: true };
    if ((m = t.match(/^(\d{1,2})$/))) {
      if (/^(am|pm)$/.test(toks[i + 1] || '')) return { min: to24(+m[1], 0, toks[i + 1]), used: [i, i + 1], explicit: true };
      return { min: to24(+m[1], 0, null, +m[1] >= 13 ? 'exact' : hint), used: [i], explicit: false };
    }
    return null;
  };
  for (let i = 0; i < toks.length && out.start == null; i++) {
    if (used[i]) continue;
    const r = toks[i].match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (r) {
      const mer = r[5] || null;
      const s = to24(+r[1], +(r[2] || 0), mer, +r[1] >= 13 ? 'exact' : hint);
      let e = to24(+r[3], +(r[4] || 0), mer, +r[3] >= 13 ? 'exact' : hint);
      if (s != null && e != null) { if (e <= s && e + 720 < 1440) e += 720; if (e > s) { out.start = s; out.end = e; take(i); break; } }
    }
    const single = timeAt(i);
    if (!single || single.min == null) continue;
    const prev = toks[i - 1], after = single.used[single.used.length - 1] + 1;
    const rangeFollows = ['a', 'hasta'].includes(toks[after]) && /^\d/.test(toks[toks[after + 1] === 'las' ? after + 2 : after + 1] || '');
    const isTime = single.explicit || prev === 'las' || prev === 'la' || ((prev === 'de' || prev === 'desde') && rangeFollows);
    if (!isTime) continue;
    out.start = single.min; take(...single.used);
    if (prev === 'las' || prev === 'la') { take(i - 1); if (['a', 'de', 'desde'].includes(toks[i - 2])) take(i - 2); }
    else if (prev === 'desde' || prev === 'de') take(i - 1);
    if (['a', 'hasta'].includes(toks[after])) {
      const k = toks[after + 1] === 'las' ? after + 2 : after + 1;
      const endT = timeAt(k);
      if (endT && endT.min != null) {
        let e = endT.min;
        if (e <= out.start && e + 720 < 1440) e += 720;
        if (e > out.start) { out.end = e; take(after, ...endT.used); if (k === after + 2) take(after + 1); }
      }
    }
  }
  if (out.start == null && hint) out.start = hint === 'manana' ? 9 * 60 : hint === 'mediodia' ? 12 * 60 : hint === 'tarde' ? 15 * 60 : 19 * 60;
  if (out.start != null) out.found.push('time');

  // Tipo (las palabras quedan en el título)
  const has = (re) => toks.some((t) => re.test(t));
  out.kind = has(EXAM_WORDS) ? 'exam' : has(CLASS_WORDS) ? 'class' : has(STUDY_WORDS) ? 'study' : has(PERSONAL_WORDS) ? 'personal' : null;

  // Curso
  let best = null;
  for (const c of (opts.courses || []).filter((x) => !x.archived)) {
    const name = norm(c.name);
    const allWords = name.split(/[^a-z0-9+#ñ]+/).filter(Boolean);
    const cwords = allWords.filter((w) => w.length > 2 || /\+\+|#/.test(w));
    const hits = [];
    toks.forEach((t, i) => {
      if (used[i] || !t || CONNECTORS.has(t)) return;
      if (cwords.some((w) => w === t || (t.length >= 4 && w.startsWith(t)) || (w.length >= 5 && t.startsWith(w)))) hits.push(i);
      else if (/c\+\+/.test(name) && (t === 'cpp' || t === 'c++')) hits.push(i);
    });
    if (!hits.length) continue;
    // «Física I»: incluye palabras cortas del nombre que van pegadas («I», «II»).
    for (const i of [...hits]) { const nx = toks[i + 1]; if (nx && !used[i + 1] && nx.length <= 3 && allWords.includes(nx) && !hits.includes(i + 1)) hits.push(i + 1); }
    const score = hits.length / Math.max(1, cwords.length);
    if (!best || score > best.score) best = { c, hits, score };
  }
  if (best) {
    out.courseId = best.c.id; out.found.push('course');
    // En exámenes y clases el nombre del curso forma parte natural del título.
    const keepInTitle = out.kind === 'exam' || out.kind === 'class';
    const rest = toks.filter((t, i) => !used[i] && !best.hits.includes(i) && t && !CONNECTORS.has(t));
    if (rest.length && !keepInTitle) for (const i of best.hits) { take(i); if (['de', 'del'].includes(toks[i - 1])) take(i - 1); }
  }
  if (!out.kind) out.kind = best && /vida|bienestar|personal/.test(norm(best.c.name)) ? 'personal' : best ? 'study' : 'personal';

  // Título
  const titleWords = words.filter((_, i) => !used[i]);
  while (titleWords.length && CONNECTORS.has(norm(titleWords[0]).replace(/[,.;:]$/, ''))) titleWords.shift();
  while (titleWords.length && CONNECTORS.has(norm(titleWords[titleWords.length - 1]).replace(/[,.;:]$/, ''))) titleWords.pop();
  let title = titleWords.join(' ').replace(/\s+([,.;:])/g, '$1').replace(/^[,.;:\s–-]+|[,;:\s–-]+$/g, '').trim();
  if (title) title = title[0].toLocaleUpperCase('es') + title.slice(1);
  out.title = title.slice(0, 130);

  // Derivados
  const fallback = out.kind === 'study' ? (opts.sessionMin || DEFAULT_DURATION.study) : DEFAULT_DURATION[out.kind];
  const dur = out.duration || (out.end != null && out.start != null ? out.end - out.start : fallback);
  out.duration = Math.max(5, Math.min(600, dur));
  if (out.start != null && out.end == null) out.end = Math.min(23 * 60 + 59, out.start + out.duration);
  if (out.start != null && !out.date) out.date = out.start > nowMin(now) ? today : addDays(today, 1);
  return { ...out, start: out.start != null ? toHHMM(out.start) : null, end: out.end != null ? toHHMM(out.end) : null };
}
