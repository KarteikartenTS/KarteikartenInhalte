// TÜV SÜD Akademie – Karteikarten Web-App (Demo für iPhone/iPad).
// Vorbild ist die Android-App: Module kommen automatisch vom Content-Server, Lernlogik wie Anki,
// Lernstand je Karte über "<Note-GUID>:<ord>", damit er bei Korrekturen erhalten bleibt.
'use strict';

const MIN = 60 * 1000;
const DAY_MS = 24 * 60 * MIN;
const LEARN_STEPS = [1, 10];        // Minuten, wie Anki
const RELEARN_STEPS = [10];
const GRADUATE_DAYS = 1;
const EASY_DAYS = 4;
const START_EASE = 2.5;
const NEW_PER_DAY = 20;             // je Stapel, wie Anki
const LEARN_AHEAD = 20 * MIN;
const DAY_STARTS_AT_HOUR = 4;       // Tageswechsel 4 Uhr, wie Anki

const KEY_PROGRESS = 'tuev.progress.v1';
const KEY_DAILY = 'tuev.daily.v1';
const KEY_VERSIONS = 'tuev.versions.v1';
const KEY_COLLAPSED = 'tuev.collapsed.v1';
const KEY_TOUR = 'tuev.tour.v1';
const KEY_REVLOG = 'tuev.revlog.v1';

const APP_VERSION = 'Web 0.5.1';
// Admin-Panel (Meldungen, anonyme Statistik). Lokal: Wrangler-Dev-Server.
const API_BASE = location.hostname === 'localhost' ? 'http://localhost:8788' : 'https://karteikarten-admin.pages.dev';
const KEY_STATS_OPT = 'tuev.stats.optin.v1';
const KEY_DEVICE = 'tuev.device.v1';
const KEY_STATS_SENT = 'tuev.stats.sent.v1';
const KEY_MINE = 'tuev.mine.v1';            // eigene Einsendungen: [{ token, type, kind, text, created }]
const KEY_MINE_SEEN = 'tuev.mine.seen.v1';  // gelesene Antworten: { token: replied }
const KEY_SEEN_VERSION = 'tuev.seenversion.v1';
const WISH_KINDS = ['Neue Funktion', 'Neue Inhalte / weiteres Modul', 'Verbesserung', 'Sonstiges'];
const KEY_CODES = 'tuev.codes.v1';          // freigeschaltete Module: [{ code, module, title }]
const KEY_HIDDEN = 'tuev.hidden.v1';        // vom Lernenden entfernte Module (Lernstand bleibt)
const KEY_SERVER_CACHE = 'tuev.servercache.v1'; // Server-Module für den Offline-Betrieb
// Empfänger für Fehlermeldungen. Leer = Meldung wird zum Kopieren angeboten statt per Mail geöffnet.
const REPORT_EMAIL = 'louis.thomee@partner.tuvsud.com';
const REPORT_KINDS = ['Inhalt falsch oder veraltet', 'Antwort unvollständig', 'Tipp- oder Rechtschreibfehler', 'Bild fehlt oder ist falsch', 'App funktioniert nicht richtig', 'Sonstiges'];

// Lernmodus "Zahlen & Daten": alle Karten eines Moduls mit dem Tag aus der Content-Pipeline
const NUM_TAG = 'Zahlen';
const NUM_NAME = 'Zahlen & Daten';
const NUM_KEY = '#zahlen';

// ---------- Speicher ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
}

const state = {
  modules: [],                      // {id, title, version, cards, styles}
  cards: [],                        // alle Karten aller Module, mit .module und .order
  progress: load(KEY_PROGRESS, {}),
  revlog: load(KEY_REVLOG, []),
  daily: load(KEY_DAILY, {}),
  collapsed: load(KEY_COLLAPSED, {}),
  deck: null,                       // aktuell gelernter Stapel
  current: null,                    // aktuelle Karte
  shownAt: 0,
};

function today(now = Date.now()) {
  const d = new Date(now - DAY_STARTS_AT_HOUR * 3600 * 1000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}
function daily() {
  const t = today();
  if (state.daily.day !== t) state.daily = { day: t, newSeen: {}, studied: 0, seconds: 0 };
  return state.daily;
}

// ---------- Stapel ----------
const parentsOf = (deck) => deck.split('::').map((_, i, a) => a.slice(0, i + 1).join('::'));
const isVirtual = (deck) => deck.endsWith('::' + NUM_KEY);
const rootOf = (deck) => deck.split('::')[0];
const deckLabel = (deck) => (isVirtual(deck) ? NUM_NAME : deck.split('::').pop());
/** Gehört die Karte zum Stapel? Beim Eintrag "Zahlen & Daten": alle getaggten Karten des Moduls. */
const inDeck = (card, deck) => (isVirtual(deck)
  ? rootOf(card.deck) === rootOf(deck) && (card.tags || []).includes(NUM_TAG)
  : card.deck === deck || card.deck.startsWith(deck + '::'));
const progressOf = (card) => state.progress[card.id] || { t: 0 };

// Hauptordner (Modul) ohne eigenes Limit, es zählen nur die Limits der Kapitel
function newLeft(deck) {
  if (!deck.includes('::')) return Infinity;
  return Math.max(0, NEW_PER_DAY - (daily().newSeen[deck] || 0));
}

/** Neue Karten, die heute in [deck] noch drankommen dürfen (Limits des Stapels und seiner Unterstapel). */
function newCardsFor(deck) {
  const left = { [deck]: newLeft(deck) };
  const out = [];
  for (const c of state.cards) {
    if (!inDeck(c, deck) || progressOf(c).t !== 0) continue;
    if (left[deck] <= 0) break;
    // Limits aller Stapel zwischen [deck] und dem Kartenstapel
    const chain = isVirtual(deck) ? [deck] : parentsOf(c.deck).filter((d) => d === deck || d.startsWith(deck + '::'));
    if (chain.some((d) => (left[d] ??= newLeft(d)) <= 0)) continue;
    chain.forEach((d) => left[d]--);
    out.push(c);
  }
  return out;
}

function countsFor(deck, now = Date.now()) {
  const t = today(now);
  let learn = 0, review = 0;
  for (const c of state.cards) {
    if (!inDeck(c, deck)) continue;
    const p = progressOf(c);
    if ((p.t === 1 || p.t === 3) && today(p.due) <= t) learn++;
    else if (p.t === 2 && p.due <= t) review++;
  }
  return { n: newCardsFor(deck).length, l: learn, r: review };
}

function nextCard(deck, now = Date.now()) {
  const t = today(now);
  const cards = state.cards.filter((c) => inDeck(c, deck));
  const learning = cards.filter((c) => [1, 3].includes(progressOf(c).t)).sort((a, b) => progressOf(a).due - progressOf(b).due);
  if (learning.length && progressOf(learning[0]).due <= now) return learning[0];
  const reviews = cards.filter((c) => progressOf(c).t === 2 && progressOf(c).due <= t)
    .sort((a, b) => progressOf(a).due - progressOf(b).due || a.order - b.order);
  if (reviews.length) return reviews[0];
  const fresh = newCardsFor(deck);
  if (fresh.length) return fresh[0];
  if (learning.length && progressOf(learning[0]).due <= now + LEARN_AHEAD) return learning[0];
  return null;
}

// ---------- Planung (wie Anki, vereinfacht) ----------
function schedule(card, ease, now = Date.now()) {
  const p = { ease: START_EASE, ivl: 0, reps: 0, lapses: 0, s: 0, ...progressOf(card) };
  const t = today(now);
  const wasNew = p.t === 0;
  p.reps++;
  if (p.t === 0 || p.t === 1) {
    const step = wasNew ? 0 : p.s;
    if (ease === 1) Object.assign(p, { t: 1, s: 0, due: now + LEARN_STEPS[0] * MIN });
    else if (ease === 2) {
      const delay = step === 0 && LEARN_STEPS.length > 1 ? (LEARN_STEPS[0] + LEARN_STEPS[1]) / 2 : LEARN_STEPS[step];
      Object.assign(p, { t: 1, s: step, due: now + delay * MIN });
    } else if (ease === 3) {
      if (step + 1 < LEARN_STEPS.length) Object.assign(p, { t: 1, s: step + 1, due: now + LEARN_STEPS[step + 1] * MIN });
      else Object.assign(p, { t: 2, ivl: GRADUATE_DAYS, due: t + GRADUATE_DAYS });
    } else Object.assign(p, { t: 2, ivl: EASY_DAYS, due: t + EASY_DAYS });
  } else if (p.t === 2) {
    if (ease === 1) Object.assign(p, { t: 3, s: 0, lapses: p.lapses + 1, ease: Math.max(1.3, p.ease - 0.2), ivl: 1, due: now + RELEARN_STEPS[0] * MIN });
    else {
      const factor = ease === 2 ? 1.2 : ease === 3 ? p.ease : p.ease * 1.3;
      p.ivl = Math.max(p.ivl + 1, Math.round(p.ivl * factor));
      if (ease === 2) p.ease = Math.max(1.3, p.ease - 0.15);
      if (ease === 4) p.ease += 0.15;
      p.due = t + p.ivl;
    }
  } else { // Wiederlernen
    if (ease <= 2) Object.assign(p, { s: 0, due: now + RELEARN_STEPS[0] * MIN });
    else Object.assign(p, { t: 2, ivl: ease === 4 ? p.ivl + 1 : p.ivl, due: t + (ease === 4 ? p.ivl + 1 : p.ivl) });
  }
  return { p, wasNew };
}

function formatDelay(card, ease) {
  const now = Date.now();
  const { p } = schedule(card, ease, now);
  if (p.t === 1 || p.t === 3) {
    const m = Math.round((p.due - now) / MIN);
    return m < 60 ? `<${Math.max(1, m)} Min` : `<${Math.round(m / 60)} Std`;
  }
  const d = p.due - today(now);
  if (d < 30) return `${d} T`;
  if (d < 365) return `${(d / 30).toFixed(d < 300 ? 1 : 0).replace('.', ',')} Mo`;
  return `${(d / 365).toFixed(1).replace('.', ',')} J`;
}

// ---------- Inhalte ----------
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function postJson(path, body) {
  const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.fehler || `HTTP ${r.status}`), { status: r.status });
  return data;
}

/** Module vom Server: öffentliche + per Code freigeschaltete. Offline aus dem Zwischenspeicher. */
async function loadServerModules(removed) {
  const codes = load(KEY_CODES, []);
  const cache = load(KEY_SERVER_CACHE, {});
  try {
    const r = await postJson('/api/modules', { codes: codes.map((c) => c.code) });
    // Ungültige oder gesperrte Codes: Modul entfernen und Bescheid sagen
    if (r.invalid.length) {
      for (const c of codes.filter((x) => r.invalid.includes(x.code))) {
        removed.push(c.title);
        delete cache[c.module];
      }
      save(KEY_CODES, codes.filter((x) => !r.invalid.includes(x.code)));
    }
    const out = [];
    for (const m of r.modules) {
      const code = load(KEY_CODES, []).find((c) => c.module === m.id)?.code;
      if (cache[m.id]?.version !== m.version) cache[m.id] = await postJson('/api/module', { id: m.id, code });
      out.push(cache[m.id]);
    }
    for (const id of Object.keys(cache)) if (!r.modules.some((m) => m.id === id)) delete cache[id];
    save(KEY_SERVER_CACHE, cache);
    return out;
  } catch (e) {
    console.warn('Server-Module offline aus dem Zwischenspeicher', e);
    return Object.values(cache);
  }
}

async function loadContent() {
  const versions = load(KEY_VERSIONS, {});
  const changed = [];
  const removed = [];
  const list = await fetchJson('content/modules.json');
  const all = [];
  for (const m of list.modules) {
    try {
      all.push(await fetchJson(`content/${m.id}/cards.json`));
    } catch (e) {
      console.warn('Modul nicht geladen', m.id, e);
    }
  }
  all.push(...(await loadServerModules(removed)).filter((m) => !all.some((x) => x.id === m.id)));
  state.allModules = all;
  const hidden = load(KEY_HIDDEN, []);
  const modules = all.filter((m) => !hidden.includes(m.id));
  for (const data of modules) {
    if (versions[data.id] && versions[data.id] !== data.version) changed.push(data.title);
    versions[data.id] = data.version;
  }
  save(KEY_VERSIONS, versions);
  if (removed.length) setTimeout(() => toast(`Nicht mehr freigeschaltet: ${removed.join(', ')}`), 4200);
  state.modules = modules;
  state.cards = modules.flatMap((m) => m.cards.map((c, i) => ({ ...c, module: m.id, order: i })));
  return changed;
}

// ---------- Ansichten ----------
const $ = (id) => document.getElementById(id);

function show(view) {
  for (const v of ['view-decks', 'view-study', 'view-done', 'view-stats']) $(v).hidden = v !== view;
  $('btn-back').hidden = view === 'view-decks';
  $('watermark').hidden = view === 'view-study';
}

function renderDecks() {
  const real = [...new Set(state.cards.flatMap((c) => parentsOf(c.deck)))].sort((a, b) => a.localeCompare(b, 'de'));
  // Je Modul den Eintrag "Zahlen & Daten" direkt unter dem Hauptordner einfügen
  const decks = real.flatMap((d) => {
    const v = `${d}::${NUM_KEY}`;
    return !d.includes('::') && state.cards.some((c) => inDeck(c, v)) ? [d, v] : [d];
  });
  const list = $('deck-list');
  list.textContent = '';
  let due = 0;
  for (const deck of decks) {
    const parts = deck.split('::');
    const level = parts.length - 1;
    if (parentsOf(deck).slice(0, -1).some((d) => state.collapsed[d])) continue;
    const hasChildren = !isVirtual(deck) && decks.some((d) => d.startsWith(deck + '::') && !isVirtual(d));
    const c = countsFor(deck);
    if (level === 0) due += c.n + c.l + c.r;

    const li = document.createElement('li');
    li.className = isVirtual(deck) ? 'deck virtual' : 'deck';
    li.style.setProperty('--level', level);
    li.innerHTML = `
      <button class="toggle ${hasChildren ? (state.collapsed[deck] ? 'collapsed' : '') : 'none'}" aria-label="Kapitel auf- oder zuklappen">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" fill="currentColor"/></svg>
      </button>
      <span class="name"></span>
      <span class="counts">${level === 0
        // Hauptordner: nur die Gesamtzahl der Karteikarten im Ordner
        ? `<span class="c-total" title="Karteikarten insgesamt">${state.cards.filter((x) => inDeck(x, deck)).length}</span>`
        : `<span class="c-new ${c.n ? '' : 'zero'}">${c.n}</span>
        <span class="c-learn ${c.l ? '' : 'zero'}">${c.l}</span>
        <span class="c-review ${c.r ? '' : 'zero'}">${c.r}</span>`}
      </span>`;
    li.querySelector('.name').textContent = deckLabel(deck);
    li.querySelector('.toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      state.collapsed[deck] = !state.collapsed[deck];
      save(KEY_COLLAPSED, state.collapsed);
      renderDecks();
    });
    li.addEventListener('click', () => startStudy(deck));
    list.appendChild(li);
  }
  $('empty').hidden = state.cards.length > 0;
  $('title').textContent = 'TÜV SÜD Akademie';
  $('subtitle').textContent = state.cards.length ? `${due} ${due === 1 ? 'Karte' : 'Karten'} fällig` : '';
  const d = daily();
  $('today').textContent = state.cards.length
    ? `Heute ${d.studied} ${d.studied === 1 ? 'Karte' : 'Karten'} in ${Math.round(d.seconds / 60)} Min gelernt`
    : '';
  const n = state.cards.length;
  $('total').textContent = n ? `${n.toLocaleString('de-DE')} Karteikarten geladen` : '';
  show('view-decks');
}

function startStudy(deck) {
  state.deck = deck;
  $('title').textContent = deckLabel(deck);
  nextInStudy();
}

function nextInStudy() {
  const card = nextCard(state.deck);
  if (!card) {
    const later = state.cards.filter((c) => inDeck(c, state.deck) && [1, 3].includes(progressOf(c).t))
      .map((c) => progressOf(c).due).sort((a, b) => a - b)[0];
    $('done-text').textContent = later && later - Date.now() < DAY_MS
      ? `Einige Karten kommen in etwa ${Math.max(1, Math.round((later - Date.now()) / MIN))} Minuten wieder.`
      : 'In diesem Stapel ist gerade nichts fällig. Morgen geht es weiter!';
    $('subtitle').textContent = '';
    show('view-done');
    return;
  }
  state.current = card;
  state.shownAt = Date.now();
  const c = countsFor(state.deck);
  $('s-new').textContent = c.n; $('s-learn').textContent = c.l; $('s-review').textContent = c.r;
  const t = progressOf(card).t;
  for (const [id, on] of [['s-new', t === 0], ['s-learn', t === 1 || t === 3], ['s-review', t === 2]]) $(id).classList.toggle('current', on);
  $('subtitle').textContent = `${c.n + c.l + c.r} offen`;
  renderCard(card.q, card);
  $('btn-show').hidden = false;
  $('ease-buttons').hidden = true;
  show('view-study');
}

function renderCard(html, card) {
  // Medienpfade aus dem Export ("media/x") auf den Modulordner umbiegen
  $('card').innerHTML = html.replace(/(src|href)="media\//g, `$1="content/${card.module}/media/`);
  $('card-scroll').scrollTop = 0;
}

function showAnswer() {
  const card = state.current;
  renderCard(card.a, card);
  const answer = $('card').querySelector('#answer');
  if (answer) answer.scrollIntoView({ block: 'start' });
  for (const b of $('ease-buttons').querySelectorAll('button')) {
    b.querySelector('small').textContent = formatDelay(card, Number(b.dataset.ease));
  }
  $('btn-show').hidden = true;
  $('ease-buttons').hidden = false;
}

function answer(ease) {
  const card = state.current;
  const { p, wasNew } = schedule(card, ease);
  state.progress[card.id] = p;
  const d = daily();
  const decks = parentsOf(card.deck).concat(isVirtual(state.deck) ? [state.deck] : []);
  if (wasNew) for (const deck of decks) d.newSeen[deck] = (d.newSeen[deck] || 0) + 1;
  const seconds = Math.min(60, (Date.now() - state.shownAt) / 1000);
  d.studied++;
  d.seconds += seconds;
  // Lernprotokoll für die Statistik (begrenzt, damit der Speicher nicht vollläuft)
  state.revlog.push({ t: Date.now(), d: today(), id: card.id, e: ease, s: Math.round(seconds), n: wasNew ? 1 : 0 });
  if (state.revlog.length > 20000) state.revlog.splice(0, state.revlog.length - 20000);
  save(KEY_REVLOG, state.revlog);
  save(KEY_PROGRESS, state.progress);
  save(KEY_DAILY, state.daily);
  nextInStudy();
}

// ---------- Kleinkram ----------
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function dialog(title, html) {
  $('dialog-title').textContent = title;
  $('dialog-text').innerHTML = html;
  $('dialog').hidden = false;
}

// ---------- Statistik ----------
const COLORS = { unseen: '#D9DDE2', working: '#7FB2E5', solid: '#005CA9', bar: '#005CA9', again: '#D32F2F', hard: '#455A64', good: '#4CAF50', easy: '#005CA9' };
const SOLID_DAYS = 21;   // ab diesem Intervall gilt eine Karte als gefestigt (wie Anki "ausgereift")
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Einfaches Säulendiagramm als SVG. values: Zahlen, labels: Beschriftung je Säule (leer = keine). */
function columns(values, labels, title) {
  const w = 340, h = 150, top = 14, bottom = 22, n = values.length;
  const max = Math.max(1, ...values);
  const bw = w / n;
  const bars = values.map((v, i) => {
    const bh = ((h - top - bottom) * v) / max;
    const x = i * bw + bw * 0.15, y = h - bottom - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(bh, v ? 1 : 0).toFixed(1)}" rx="2" fill="${COLORS.bar}"><title>${esc(labels[i] || '')}: ${v}</title></rect>`
      + (labels[i] ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" class="axis">${esc(labels[i])}</text>` : '');
  }).join('');
  return `<svg viewBox="-16 0 ${w + 32} ${h}" role="img" aria-label="${esc(title)}">
    <line x1="0" x2="${w}" y1="${h - bottom}" y2="${h - bottom}" class="base"/>
    <text x="0" y="10" class="axis">max. ${max}</text>${bars}</svg>`;
}

function renderStats() {
  const t = today();
  const log = state.revlog;
  const days = [...new Set(log.map((r) => r.d))].sort((a, b) => b - a);
  let streak = 0;
  for (let d = days.includes(t) ? t : t - 1; days.includes(d); d--) streak++;
  const seen = state.cards.filter((c) => progressOf(c).t !== 0);
  const solid = state.cards.filter((c) => progressOf(c).t === 2 && progressOf(c).ivl >= SOLID_DAYS);
  const todayCount = log.filter((r) => r.d === t).length;

  // Lernverlauf der letzten 30 Tage
  const hist = Array.from({ length: 30 }, (_, i) => log.filter((r) => r.d === t - 29 + i).length);
  const histLabels = hist.map((_, i) => (i % 7 === 1 ? new Date((t - 29 + i) * 86400000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''));
  // Fällige Wiederholungen der nächsten 14 Tage
  const ahead = Array.from({ length: 14 }, (_, i) => state.cards.filter((c) => {
    const p = progressOf(c);
    return p.t === 2 ? Math.max(p.due, t) === t + i : (p.t === 1 || p.t === 3) && i === 0;
  }).length);
  const aheadLabels = ahead.map((_, i) => (i === 0 ? 'heute' : i % 3 === 0 ? `+${i}` : ''));
  // Antworten der letzten 30 Tage
  const recent = log.filter((r) => r.d > t - 30);
  const answers = [1, 2, 3, 4].map((e) => recent.filter((r) => r.e === e).length);
  const total = Math.max(1, recent.length);

  // Fortschritt je Kapitel (+ Zahlen & Daten)
  const rows = [...new Set(state.cards.map((c) => c.deck))].sort((a, b) => a.localeCompare(b, 'de'));
  for (const root of new Set(rows.map(rootOf))) if (state.cards.some((c) => inDeck(c, `${root}::${NUM_KEY}`))) rows.unshift(`${root}::${NUM_KEY}`);
  const progressRows = rows.map((deck) => {
    const cards = state.cards.filter((c) => inDeck(c, deck));
    const s = cards.filter((c) => progressOf(c).t === 2 && progressOf(c).ivl >= SOLID_DAYS).length;
    const w = cards.filter((c) => progressOf(c).t !== 0).length - s;
    const u = cards.length - s - w;
    const pct = (x) => ((100 * x) / Math.max(1, cards.length)).toFixed(1);
    return `<div class="prow"><div class="plabel"><span>${esc(deckLabel(deck))}</span><span class="pnum">${Math.round((100 * (s + w)) / Math.max(1, cards.length))} %</span></div>
      <div class="pbar" title="${s} gefestigt, ${w} in Arbeit, ${u} noch neu">
        <span style="width:${pct(s)}%;background:${COLORS.solid}"></span><span style="width:${pct(w)}%;background:${COLORS.working}"></span><span style="width:${pct(u)}%;background:${COLORS.unseen}"></span>
      </div></div>`;
  }).join('');

  $('stats').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Heute</span><b>${todayCount}</b><small>Antworten</small></div>
      <div class="kpi"><span>Lernserie</span><b>${streak}</b><small>${streak === 1 ? 'Tag' : 'Tage'} in Folge</small></div>
      <div class="kpi"><span>Begonnen</span><b>${seen.length}</b><small>von ${state.cards.length} Karten</small></div>
      <div class="kpi"><span>Gefestigt</span><b>${solid.length}</b><small>Intervall ≥ ${SOLID_DAYS} Tage</small></div>
    </div>
    <h2>Fortschritt je Kapitel</h2>
    <div class="legend"><span><i style="background:${COLORS.solid}"></i>gefestigt</span><span><i style="background:${COLORS.working}"></i>in Arbeit</span><span><i style="background:${COLORS.unseen}"></i>noch neu</span></div>
    ${progressRows}
    <h2>Lernverlauf (30 Tage)</h2>
    ${columns(hist, histLabels, 'Antworten pro Tag in den letzten 30 Tagen')}
    <h2>Fällig in den nächsten 14 Tagen</h2>
    ${columns(ahead, aheadLabels, 'Fällige Karten pro Tag in den nächsten 14 Tagen')}
    <h2>Deine Antworten (30 Tage)</h2>
    ${recent.length ? `<div class="answers">${[['Nochmal', COLORS.again], ['Schwer', COLORS.hard], ['Gut', COLORS.good], ['Einfach', COLORS.easy]].map(([name, color], i) => `
      <div class="arow"><span>${name}</span><div class="abar"><span style="width:${((100 * answers[i]) / total).toFixed(1)}%;background:${color}"></span></div><span class="pnum">${Math.round((100 * answers[i]) / total)} %</span></div>`).join('')}</div>`
      : '<p class="hint">Noch keine Antworten. Die Statistik füllt sich, sobald du lernst.</p>'}
    <h2>Anonyme Lernstatistik</h2>
    <label class="optin"><input type="checkbox" id="stats-optin" ${statsOptIn() ? 'checked' : ''}>
      <span>Anonyme Lernstatistik an die TÜV SÜD Akademie senden</span></label>
    <p class="hint">Hilft der Akademie zu sehen, welche Kapitel schwerfallen. Gesendet werden nur zusammengefasste Werte je Kapitel
      (z. B. „12 von 20 Karten begonnen“) und die Zahl der Antworten pro Tag – ohne Namen, ohne einzelne Antworten.
      Ausgewertet wird nur in Gruppen ab 5 Lernenden. Ausschalten löscht deine Daten auf dem Server.</p>
    <p class="hint">Gezählt wird ab dem ${log.length ? new Date(log[0].t).toLocaleDateString('de-DE') : 'ersten Lernen'} auf diesem Gerät.</p>`;
  $('stats-optin').addEventListener('change', (e) => setStatsOptIn(e.target.checked));
  $('title').textContent = 'Statistik';
  $('subtitle').textContent = '';
  show('view-stats');
}

// ---------- Anonyme Lernstatistik (nur mit Einwilligung) ----------
const statsOptIn = () => load(KEY_STATS_OPT, false) === true;
function deviceId() {
  let id = load(KEY_DEVICE, null);
  if (!id) { id = crypto.randomUUID(); save(KEY_DEVICE, id); }
  return id;
}
async function setStatsOptIn(on) {
  save(KEY_STATS_OPT, on);
  if (on) {
    save(KEY_STATS_SENT, 0);
    await sendStats();
    toast('Danke! Anonyme Statistik ist eingeschaltet.');
    return;
  }
  const id = load(KEY_DEVICE, null);
  try {
    if (id) await fetch(`${API_BASE}/api/stats/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: id }) });
    try { localStorage.removeItem(KEY_DEVICE); } catch {}
    toast('Ausgeschaltet. Deine Daten auf dem Server wurden gelöscht.');
  } catch {
    toast('Ausgeschaltet. Löschen auf dem Server klappt beim nächsten Online-Sein.');
  }
}
/** Höchstens alle 30 Minuten: zusammengefasster Stand je Kapitel + Antworten heute. */
async function sendStats(force = false) {
  if (!statsOptIn() || !state.cards.length) return;
  if (!force && Date.now() - load(KEY_STATS_SENT, 0) < 30 * MIN) return;
  const decks = [...new Set(state.cards.map((c) => c.deck))].map((deck) => {
    const cards = state.cards.filter((c) => c.deck === deck);
    return {
      deck,
      total: cards.length,
      seen: cards.filter((c) => progressOf(c).t !== 0).length,
      solid: cards.filter((c) => progressOf(c).t === 2 && progressOf(c).ivl >= SOLID_DAYS).length,
    };
  });
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const r = await fetch(`${API_BASE}/api/stats`, {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId(), day, app: APP_VERSION, answersToday: state.revlog.filter((x) => x.d === today()).length, decks }),
    });
    if (r.ok) save(KEY_STATS_SENT, Date.now());
  } catch (e) {
    console.warn('Statistik nicht gesendet', e);
  }
}

// ---------- Module verwalten: freischalten per Code, entfernen, wieder hinzufügen ----------
function openModules() {
  const hidden = load(KEY_HIDDEN, []);
  const codes = load(KEY_CODES, []);
  const rows = (state.allModules || []).map((m) => {
    const isHidden = hidden.includes(m.id);
    const byCode = codes.find((c) => c.module === m.id);
    return `<li class="mod-row"><span><b>${esc(m.title)}</b><br><small class="muted">${m.cards.length} Karten${byCode ? ' · per Code freigeschaltet' : ''}${isHidden ? ' · entfernt' : ''}</small></span>
      ${isHidden ? `<button class="btn-secondary" data-mod-add="${esc(m.id)}">Hinzufügen</button>` : `<button class="btn-secondary" data-mod-remove="${esc(m.id)}">Entfernen</button>`}</li>`;
  }).join('');
  dialog('Module verwalten', `
    <form id="unlock-form" class="unlock">
      <label for="unlock-code">Modul freischalten</label>
      <div class="unlock-row"><input id="unlock-code" autocomplete="off" autocapitalize="characters" placeholder="Code, z. B. MUEN-AB2C-XY3Z">
      <button class="btn-primary" type="submit">Freischalten</button></div>
      <p class="field-error" id="unlock-error" hidden></p>
      <p class="hint">Den Code bekommst du von der TÜV SÜD Akademie, z. B. zu deinem Lehrgang.</p>
    </form>
    <h3>Deine Module</h3>
    <ul class="mod-list">${rows || '<li class="muted">Noch keine Module.</li>'}</ul>
    <p class="hint">Entfernen blendet ein Modul aus. Dein Lernstand bleibt gespeichert und ist wieder da, wenn du es erneut hinzufügst.</p>`);
  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('unlock-code').value.trim();
    if (!code) return;
    try {
      const r = await postJson('/api/unlock', { code });
      const list = load(KEY_CODES, []).filter((c) => c.module !== r.module.id);
      list.push({ code: r.code, module: r.module.id, title: r.module.title });
      save(KEY_CODES, list);
      save(KEY_HIDDEN, load(KEY_HIDDEN, []).filter((id) => id !== r.module.id));
      $('dialog').hidden = true;
      await refresh(false);
      // Karla freut sich mit (statt kurzer Hinweis unten)
      karlaUnlocked(r.module.id, r.module.title);
    } catch (err) {
      $('unlock-error').textContent = err.status === 404 ? 'Dieser Code ist ungültig oder abgelaufen.' : 'Freischalten gerade nicht möglich. Bitte Internetverbindung prüfen.';
      $('unlock-error').hidden = false;
    }
  });
  $('dialog-text').querySelectorAll('[data-mod-remove]').forEach((b) => b.addEventListener('click', async () => {
    const m = state.allModules.find((x) => x.id === b.dataset.modRemove);
    if (!confirm(`„${m.title}“ aus deiner Übersicht entfernen? Dein Lernstand bleibt gespeichert.`)) return;
    save(KEY_HIDDEN, [...new Set([...load(KEY_HIDDEN, []), m.id])]);
    await refresh(false);
    openModules();
  }));
  $('dialog-text').querySelectorAll('[data-mod-add]').forEach((b) => b.addEventListener('click', async () => {
    save(KEY_HIDDEN, load(KEY_HIDDEN, []).filter((id) => id !== b.dataset.modAdd));
    await refresh(false);
    openModules();
  }));
}

// ---------- Meine Rückmeldungen (Feedback-Schleife) ----------
const STATUS_TEXT = { offen: 'eingegangen', 'in-arbeit': 'in Arbeit', erledigt: 'erledigt', abgelehnt: 'nicht umgesetzt' };
let mineCache = [];
async function checkMine() {
  const mine = load(KEY_MINE, []);
  if (!mine.length) return;
  try {
    mineCache = (await postJson('/api/report-status', { tokens: mine.map((m) => m.token) })).reports;
  } catch (e) { console.warn('Rückmeldungen nicht abrufbar', e); }
  const seen = load(KEY_MINE_SEEN, {});
  const unread = mineCache.some((r) => r.replied && seen[r.token] !== r.replied);
  $('menu-dot').hidden = $('mine-dot').hidden = !unread;
}
async function openMine() {
  await checkMine();
  const mine = load(KEY_MINE, []).slice().reverse();
  const seen = load(KEY_MINE_SEEN, {});
  const rows = mine.map((m) => {
    const r = mineCache.find((x) => x.token === m.token) || {};
    const isNew = r.replied && seen[m.token] !== r.replied;
    return `<li class="mine-row">
      <div class="mine-head"><b>${m.type === 'wunsch' ? 'Idee' : 'Fehler'}: ${esc(m.kind)}</b><span class="status-pill s-${esc(r.status || 'offen')}">${esc(STATUS_TEXT[r.status] || 'gesendet')}</span></div>
      <small class="muted">${new Date(m.created).toLocaleDateString('de-DE')} · ${esc(m.text)}</small>
      ${r.reply ? `<div class="mine-reply ${isNew ? 'new' : ''}"><b>Antwort der Akademie${isNew ? ' (neu)' : ''}:</b><br>${esc(r.reply)}</div>` : ''}
    </li>`;
  }).join('');
  dialog('Meine Rückmeldungen', mine.length
    ? `<ul class="mod-list">${rows}</ul><p class="hint">Hier siehst du, was aus deinen Meldungen und Ideen geworden ist. Gespeichert nur auf diesem Gerät.</p>`
    : '<p>Du hast noch nichts eingesendet. Fehler meldest du beim Lernen über „Fehler melden“, Ideen über das Menü „Idee vorschlagen“.</p>');
  // Als gelesen markieren
  for (const r of mineCache) if (r.replied) seen[r.token] = r.replied;
  save(KEY_MINE_SEEN, seen);
  $('menu-dot').hidden = $('mine-dot').hidden = true;
}

// ---------- Was ist neu? ----------
const CHANGELOG = [
  { version: 'Web 0.5.1', date: '17.10.2026', items: [
    'Karla freut sich mit: Beim Freischalten eines Moduls zeigt sie dir, was neu ist und wo du anfängst.',
  ] },
  { version: 'Web 0.5.0', date: '17.10.2026', items: [
    'Idee vorschlagen: Wünsche direkt an die Akademie senden (Menü).',
    'Meine Rückmeldungen: Status und Antwort der Akademie zu deinen Meldungen und Ideen.',
    'Was ist neu? – diese Übersicht nach jedem Update.',
  ] },
  { version: 'Web 0.4.0', date: '17.10.2026', items: [
    'Module freischalten per Code, z. B. „Mündliche Prüfung“ (Menü → Module verwalten).',
    'Module ausblenden und wieder hinzufügen, der Lernstand bleibt erhalten.',
  ] },
  { version: 'Web 0.3.0', date: '17.10.2026', items: [
    'Fehlermeldungen gehen direkt an die Akademie.',
    'Anonyme Lernstatistik (freiwillig, unter Statistik einschaltbar).',
  ] },
  { version: 'Web 0.2.0', date: '10.10.2026', items: [
    'Lernmodus „Zahlen & Daten“ für Grenzwerte, Fristen und Stichtage.',
    'Statistik mit Lernverlauf, Fortschritt je Kapitel und Fälligkeiten.',
    'Fehler zu einzelnen Karten melden.',
  ] },
];
/** Nach einem Update einmal zeigen; beim allerersten Start nicht (dann erklärt Karla). */
function showNews(force = false) {
  const seen = load(KEY_SEEN_VERSION, null);
  save(KEY_SEEN_VERSION, APP_VERSION);
  // Bestehende Nutzer ohne gespeicherte Version (vor 0.5.0) sehen die neueste Änderung
  if (!force && (seen === APP_VERSION || (!seen && !load(KEY_TOUR, false)))) return;
  const idx = force ? CHANGELOG.length : Math.max(1, CHANGELOG.findIndex((c) => c.version === seen));
  const entries = CHANGELOG.slice(0, idx === -1 ? CHANGELOG.length : idx);
  dialog('Was ist neu?', entries.map((c) => `<h3>${esc(c.version.replace('Web ', 'Version '))} <small class="muted">${esc(c.date)}</small></h3>
    <ul>${c.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')
    + '<p class="hint">Fehlt dir etwas? Menü → „Idee vorschlagen“.</p>');
}

// ---------- Fehler melden ----------
const plainText = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  return d.textContent.replace(/\s+/g, ' ').trim();
};
let reportCard = null;

let reportType = 'fehler';
function openReport(card, type = 'fehler') {
  reportCard = card;
  reportType = type;
  const wish = type === 'wunsch';
  $('report-title').textContent = wish ? 'Idee oder Wunsch einreichen' : card ? 'Fehler mit dieser Karte melden' : 'Fehler melden';
  $('report-text-label').firstChild.textContent = wish ? 'Was wünschst du dir? ' : 'Was ist falsch? ';
  $('report-text').placeholder = wish ? 'z. B. Ein Modul zu Bremsen wäre super, weil …' : 'z. B. Der Grenzwert ist seit 2021 ein anderer: …';
  const info = $('report-card-info');
  info.hidden = !card;
  if (card) {
    const q = plainText(card.q);
    info.innerHTML = `<b>${esc(card.deck.replace(/::/g, ' › '))}</b><br>${esc(q.length > 160 ? q.slice(0, 157) + '…' : q)}`;
  }
  $('report-kind').innerHTML = (wish ? WISH_KINDS : REPORT_KINDS.filter((k) => card || !k.startsWith('Bild')))
    .map((k) => `<option>${esc(k)}</option>`).join('');
  if (!card && !wish) $('report-kind').value = 'App funktioniert nicht richtig';
  $('report-text').value = '';
  $('report-error').hidden = true;
  $('report-hint').textContent = 'Die Meldung geht direkt an die Akademie. Ohne Internet öffnet sich stattdessen eine vorbereitete E-Mail.';
  $('report').hidden = false;
  $('report-text').focus();
}

function reportBody(kind, text) {
  const lines = [`Art: ${kind}`, '', 'Beschreibung:', text, ''];
  if (reportCard) {
    lines.push('Karte:', `  Kapitel: ${reportCard.deck.replace(/::/g, ' › ')}`, `  Frage: ${plainText(reportCard.q)}`, `  Karten-ID: ${reportCard.id}`, '');
  }
  const m = state.modules.map((x) => `${x.title} (Stand ${x.version})`).join(', ');
  lines.push('Technische Angaben:', `  App: ${APP_VERSION}`, `  Inhalte: ${m}`, `  Gerät: ${navigator.userAgent}`, `  Zeit: ${new Date().toLocaleString('de-DE')}`);
  return lines.join('\n');
}

async function sendReport(e) {
  e.preventDefault();
  const text = $('report-text').value.trim();
  if (!text) {
    $('report-error').hidden = false;
    $('report-text').focus();
    return;
  }
  const kind = $('report-kind').value;
  const subject = reportCard
    ? `Karteikarten-App: Fehler in Karte (${deckLabel(reportCard.deck)})`
    : `Karteikarten-App: ${kind}`;
  const body = reportBody(kind, text);
  $('report-send').disabled = true;
  try {
    // Zuerst direkt ans Admin-Panel; nur wenn das nicht klappt, per E-Mail
    const r = await fetch(`${API_BASE}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: reportType, kind, text, app: APP_VERSION,
        content: state.modules.map((x) => `${x.title} (Stand ${x.version})`).join(', '),
        ...(reportCard ? { cardId: reportCard.id, deck: reportCard.deck, question: plainText(reportCard.q) } : {}),
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { token } = await r.json();
    // Beleg merken: darüber kommen Status und Antwort der Akademie ("Meine Rückmeldungen")
    if (token) save(KEY_MINE, [...load(KEY_MINE, []), { token, type: reportType, kind, text: text.slice(0, 200), created: Date.now() }]);
    toast(reportType === 'wunsch'
      ? 'Danke für deine Idee! Die Antwort siehst du unter „Meine Rückmeldungen“.'
      : 'Danke! Deine Meldung ist angekommen. Die Antwort siehst du unter „Meine Rückmeldungen“.');
    $('report').hidden = true;
    return;
  } catch (err) {
    console.warn('Meldung an Admin-Panel fehlgeschlagen, weiter per E-Mail', err);
  } finally {
    $('report-send').disabled = false;
  }
  if (REPORT_EMAIL) {
    location.href = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast('Danke! Bitte die Mail noch absenden.');
  } else {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast('Meldung kopiert. Bitte in eine Mail an die Akademie einfügen.');
    } catch {
      dialog('Meldung zum Kopieren', `<pre class="report-pre">${esc(`${subject}\n\n${body}`)}</pre>`);
    }
  }
  $('report').hidden = true;
}

// ---------- Über diese App ----------
const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
function aboutHtml() {
  const modules = state.modules.map((m) => `${m.title} (${m.cards.length} Karten)`).join(', ') || 'noch nicht geladen';
  return `<div class="about">
    <img class="about-logo" src="icons/tuev-sued-logo.svg" alt="TÜV SÜD">
    <p><b>Karteikarten-App der TÜV SÜD Akademie</b><br>
    Prototyp im Auftrag der TÜV SÜD Akademie. Web-Version für iPhone, iPad und PC.</p>
    <p class="meta">Geladen: ${state.cards.length} Karteikarten · Module: ${modules}</p>

    <h3>TÜV SÜD Akademie</h3>
    <ul>
      <li>${LINK('https://www.tuvsud.com/de-de/store/akademie', 'Website der TÜV SÜD Akademie')}</li>
      <li>${LINK('https://de-internal-learning.tuvsud.com/dashboard', 'Lernportal')} (nur mit TÜV-SÜD-Zugang)</li>
      <li>${LINK('https://www.tuvsud.com/de-de/store/akademie/impressum-akademie', 'Impressum der TÜV SÜD Akademie')}</li>
      <li>${LINK('https://www.tuvsud.com/de-de/store/akademie/datenschutzinformation', 'Datenschutzinformation der TÜV SÜD Akademie')}</li>
    </ul>

    <h3>App und Inhalte</h3>
    <ul>
      <li>${LINK('https://github.com/KarteikartenTS/KarteikartenAndroid/releases/tag/v0.1.0-demo', 'Android-App herunterladen')}</li>
      <li>${LINK('https://github.com/KarteikartenTS/KarteikartenInhalte', 'Web-App und Karteikarten auf GitHub')}</li>
      <li>${LINK('https://github.com/KarteikartenTS/KarteikartenAndroid', 'Quellcode der Android-App auf GitHub')} (GPL-3.0, basiert auf AnkiDroid)</li>
    </ul>

    <h3>Fehler gefunden?</h3>
    <ul>
      <li>Fehler in einer Karte: beim Lernen oben rechts auf „Fehler melden“ tippen. Die Karte wird automatisch mitgeschickt.</li>
      <li>Fehler in der App: <a href="#" id="about-report">Fehler melden</a></li>
    </ul>

    <h3>Hinweise</h3>
    <ul>
      <li>Demo-Version: Die Karten sind unvollständig und dienen nur dem Kennenlernen.</li>
      <li>Keine Anmeldung, kein Tracking. Dein Lernstand wird auf diesem Gerät gespeichert.</li>
      <li>Anonyme Lernstatistik nur, wenn du sie unter „Statistik“ einschaltest.</li>
      <li>Die Seite wird über GitHub Pages ausgeliefert. Dabei verarbeitet GitHub technisch notwendige Verbindungsdaten.</li>
    </ul>
  </div>`;
}

// ---------- Karla ----------
const TIPS = [
  ['Hallo, ich bin Karla!', 'Ich bin deine Lernkarte und zeige dir in ein paar Schritten, was diese App kann. Tippe auf „Weiter“.'],
  ['Deine Module', 'In der Liste siehst du die Karteikarten-Module der TÜV SÜD Akademie, zum Beispiel „PTI 1“.'],
  ['Immer aktuell', 'Neue oder korrigierte Karten kommen automatisch, sobald du die App öffnest. Dein Lernstand bleibt dabei erhalten.'],
  ['Kapitel aufklappen', 'Viele Module haben Kapitel. Tippe auf den kleinen Pfeil neben einem Modul, um die Kapitel zu sehen.'],
  ['So lernst du', 'Tippe auf ein Modul oder Kapitel, um zu lernen. Du siehst zuerst die Frage. Überlege dir die Antwort und decke sie dann auf.'],
  ['Ehrlich bewerten', 'Nach dem Aufdecken bewertest du dich: „Nochmal“, „Schwer“, „Gut“ oder „Einfach“. Danach plant die App, wann die Karte wiederkommt.'],
  ['Die Zahlen rechts', 'Blau sind neue Karten, Rot Karten in der Lernphase, Grün fällige Wiederholungen. Jeden Tag ein bisschen bringt am meisten.'],
  ['Wie eine echte App', 'Tippe in Safari unten auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Dann startet die App mit eigenem Symbol und funktioniert auch offline.'],
  ['Kleiner Tipp', 'Dein Lernstand wird auf diesem Gerät gespeichert. Du findest mich jederzeit über ⋮ und „Lern-Assistent“. Viel Erfolg!'],
];
let tip = 0;
let tips = TIPS;   // aktuelle Sprechblasen: die Tour oder ein Ereignis (z. B. Modul freigeschaltet)

/** Karla zeigen (Tour oder Ereignis-Sprechblasen) bzw. ausblenden. mood "celebrate" = Freudensprung. */
function karla(open, list = TIPS, mood = '') {
  const k = $('karla');
  if (open) {
    tips = list;
    tip = 0;
    renderTip();
    k.classList.remove('out');
    k.hidden = false;
    if (mood) celebrate();
  } else {
    if (tips === TIPS) save(KEY_TOUR, true);
    k.classList.add('out');
    setTimeout(() => { k.hidden = true; }, 260);
  }
}
function renderTip() {
  $('karla-title').textContent = tips[tip][0];
  $('karla-text').textContent = tips[tip][1];
  $('karla-progress').textContent = tips.length > 1 ? `${tip + 1}/${tips.length}` : '';
  $('karla-back').classList.toggle('invisible', tip === 0);
  $('karla-next').textContent = tip === tips.length - 1 ? (tips === TIPS ? 'Fertig' : 'Danke!') : 'Weiter';
  $('karla-close').textContent = tips === TIPS ? 'Tipps schließen' : 'Schließen';
}
/** Freudensprung mit ein paar Konfetti-Karten. */
function celebrate() {
  const f = $('karla-figure');
  f.classList.remove('jump');
  void f.getBoundingClientRect();
  f.classList.add('jump');
  setTimeout(() => f.classList.remove('jump'), 1300);
  const box = $('karla');
  for (let i = 0; i < 14; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.setProperty('--x', `${Math.round(Math.random() * 220 - 60)}px`);
    c.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
    c.style.left = `${40 + Math.random() * 20}px`;
    c.style.animationDelay = `${Math.random() * 0.25}s`;
    c.style.background = ['#005CA9', '#7FB2E5', '#FFC107', '#4CAF50', '#E53935'][i % 5];
    box.appendChild(c);
    setTimeout(() => c.remove(), 1700);
  }
}

/** Ereignis: Modul per Code freigeschaltet. */
function karlaUnlocked(moduleId, title) {
  const cards = state.cards.filter((c) => c.module === moduleId);
  const chapters = new Set(cards.map((c) => c.deck)).size;
  const numbers = cards.filter((c) => (c.tags || []).includes(NUM_TAG)).length;
  const list = [[
    'Freigeschaltet – super!',
    `„${title}“ ist jetzt in deiner Übersicht: ${cards.length} Karten${chapters > 1 ? ` in ${chapters} Kapiteln` : ''}. Tippe auf das Modul oder ein Kapitel und leg los.`,
  ]];
  if (numbers) list.push(['Mein Tipp für dich', `${numbers} Karten mit Grenzwerten, Fristen und Stichtagen übst du gezielt unter „123 Zahlen & Daten“ direkt unter dem Modul.`]);
  list.push(['Gut zu wissen', 'Über ⋮ → „Module verwalten“ kannst du das Modul jederzeit ausblenden und wieder hinzufügen. Dein Lernstand bleibt erhalten. Viel Erfolg!']);
  karla(true, list, 'celebrate');
}
function wiggle() {
  const f = $('karla-figure');
  f.classList.remove('wiggle');
  void f.getBoundingClientRect();
  f.classList.add('wiggle');
  setTimeout(() => f.classList.remove('wiggle'), 520);
}

// ---------- Start ----------
function bind() {
  $('btn-show').addEventListener('click', showAnswer);
  $('btn-report-card').addEventListener('click', () => openReport(state.current));
  $('report-form').addEventListener('submit', sendReport);
  $('report-cancel').addEventListener('click', () => { $('report').hidden = true; });
  $('report-text').addEventListener('input', () => { $('report-error').hidden = true; });
  $('ease-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ease]');
    if (b) answer(Number(b.dataset.ease));
  });
  $('btn-back').addEventListener('click', renderDecks);
  $('btn-done').addEventListener('click', renderDecks);
  $('dialog-close').addEventListener('click', () => { $('dialog').hidden = true; });
  $('btn-menu').addEventListener('click', (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
  document.addEventListener('click', () => { $('menu').hidden = true; });
  $('menu').addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (action === 'assistant') karla(true);
    if (action === 'update') await refresh(true);
    if (action === 'stats') renderStats();
    if (action === 'report') openReport(null);
    if (action === 'wish') openReport(null, 'wunsch');
    if (action === 'mine') openMine();
    if (action === 'news') showNews(true);
    if (action === 'modules') openModules();
    if (action === 'about') {
      dialog('Über diese App', aboutHtml());
      $('about-report').addEventListener('click', (ev) => { ev.preventDefault(); $('dialog').hidden = true; openReport(null); });
    }
  });
  $('karla-next').addEventListener('click', () => { if (tip === tips.length - 1) karla(false); else { tip++; renderTip(); wiggle(); } });
  $('karla-back').addEventListener('click', () => { tip = Math.max(0, tip - 1); renderTip(); wiggle(); });
  $('karla-close').addEventListener('click', () => karla(false));
  $('karla-figure').addEventListener('click', wiggle);
  document.addEventListener('keydown', (e) => {
    // Tastenkürzel nur beim Lernen, nicht beim Tippen in Formularen
    if ($('view-study').hidden || !$('report').hidden || !$('dialog').hidden) return;
    if (!$('btn-show').hidden && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); showAnswer(); }
    else if (!$('ease-buttons').hidden && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key));
  });
  // Nach längerer Pause im Hintergrund: Inhalte prüfen und Übersicht auffrischen
  document.addEventListener('visibilitychange', () => {
    // Beim Verlassen der App den Stand senden (nur mit Einwilligung, höchstens alle 30 Min.)
    if (document.visibilityState === 'hidden') sendStats();
    if (document.visibilityState === 'visible' && !$('view-decks').hidden) refresh(false);
  });
}

async function refresh(manual) {
  try {
    const changed = await loadContent();
    if (!$('view-decks').hidden) renderDecks();
    if (changed.length) toast(`Neue oder geänderte Karten: ${changed.join(', ')}`);
    else if (manual) toast('Alles aktuell.');
  } catch (e) {
    console.warn(e);
    if (manual || !state.cards.length) toast('Karteikarten konnten nicht geladen werden. Bitte Internetverbindung prüfen.');
    if (!$('view-decks').hidden) renderDecks();
  }
}

async function main() {
  bind();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  // Lernstand möglichst vor dem Aufräumen durch den Browser schützen
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await refresh(false);
  if (!load(KEY_TOUR, false) && state.cards.length) { karla(true); save(KEY_SEEN_VERSION, APP_VERSION); } else showNews();
  checkMine();
  sendStats();
}

main();
