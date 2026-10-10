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
const inDeck = (card, deck) => card.deck === deck || card.deck.startsWith(deck + '::');
const progressOf = (card) => state.progress[card.id] || { t: 0 };

function newLeft(deck) { return Math.max(0, NEW_PER_DAY - (daily().newSeen[deck] || 0)); }

/** Neue Karten, die heute in [deck] noch drankommen dürfen (Limits des Stapels und seiner Unterstapel). */
function newCardsFor(deck) {
  const left = { [deck]: newLeft(deck) };
  const out = [];
  for (const c of state.cards) {
    if (!inDeck(c, deck) || progressOf(c).t !== 0) continue;
    if (left[deck] <= 0) break;
    // Limits aller Stapel zwischen [deck] und dem Kartenstapel
    const chain = parentsOf(c.deck).filter((d) => d === deck || d.startsWith(deck + '::'));
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

async function loadContent() {
  const versions = load(KEY_VERSIONS, {});
  const changed = [];
  const list = await fetchJson('content/modules.json');
  const modules = [];
  for (const m of list.modules) {
    try {
      const data = await fetchJson(`content/${m.id}/cards.json`);
      if (versions[m.id] && versions[m.id] !== data.version) changed.push(data.title);
      versions[m.id] = data.version;
      modules.push(data);
    } catch (e) {
      console.warn('Modul nicht geladen', m.id, e);
    }
  }
  save(KEY_VERSIONS, versions);
  state.modules = modules;
  state.cards = modules.flatMap((m) => m.cards.map((c, i) => ({ ...c, module: m.id, order: i })));
  return changed;
}

// ---------- Ansichten ----------
const $ = (id) => document.getElementById(id);

function show(view) {
  for (const v of ['view-decks', 'view-study', 'view-done']) $(v).hidden = v !== view;
  $('btn-back').hidden = view === 'view-decks';
  $('watermark').hidden = view === 'view-study';
}

function renderDecks() {
  const decks = [...new Set(state.cards.flatMap((c) => parentsOf(c.deck)))].sort((a, b) => a.localeCompare(b, 'de'));
  const list = $('deck-list');
  list.textContent = '';
  let due = 0;
  for (const deck of decks) {
    const parts = deck.split('::');
    const level = parts.length - 1;
    if (parentsOf(deck).slice(0, -1).some((d) => state.collapsed[d])) continue;
    const hasChildren = decks.some((d) => d.startsWith(deck + '::'));
    const c = countsFor(deck);
    if (level === 0) due += c.n + c.l + c.r;

    const li = document.createElement('li');
    li.className = 'deck';
    li.style.setProperty('--level', level);
    li.innerHTML = `
      <button class="toggle ${hasChildren ? (state.collapsed[deck] ? 'collapsed' : '') : 'none'}" aria-label="Kapitel auf- oder zuklappen">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z" fill="currentColor"/></svg>
      </button>
      <span class="name"></span>
      <span class="counts">
        <span class="c-new ${c.n ? '' : 'zero'}">${c.n}</span>
        <span class="c-learn ${c.l ? '' : 'zero'}">${c.l}</span>
        <span class="c-review ${c.r ? '' : 'zero'}">${c.r}</span>
      </span>`;
    li.querySelector('.name').textContent = parts[level];
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
  $('title').textContent = deck.split('::').pop();
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
  if (wasNew) for (const deck of parentsOf(card.deck)) d.newSeen[deck] = (d.newSeen[deck] || 0) + 1;
  d.studied++;
  d.seconds += Math.min(60, (Date.now() - state.shownAt) / 1000);
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

    <h3>Hinweise</h3>
    <ul>
      <li>Demo-Version: Die Karten sind unvollständig und dienen nur dem Kennenlernen.</li>
      <li>Keine Anmeldung, kein Tracking. Dein Lernstand wird nur auf diesem Gerät gespeichert.</li>
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

function karla(open) {
  const k = $('karla');
  if (open) {
    tip = 0;
    renderTip();
    k.classList.remove('out');
    k.hidden = false;
  } else {
    save(KEY_TOUR, true);
    k.classList.add('out');
    setTimeout(() => { k.hidden = true; }, 260);
  }
}
function renderTip() {
  $('karla-title').textContent = TIPS[tip][0];
  $('karla-text').textContent = TIPS[tip][1];
  $('karla-progress').textContent = `${tip + 1}/${TIPS.length}`;
  $('karla-back').classList.toggle('invisible', tip === 0);
  $('karla-next').textContent = tip === TIPS.length - 1 ? 'Fertig' : 'Weiter';
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
    if (action === 'about') dialog('Über diese App', aboutHtml());
  });
  $('karla-next').addEventListener('click', () => { if (tip === TIPS.length - 1) karla(false); else { tip++; renderTip(); wiggle(); } });
  $('karla-back').addEventListener('click', () => { tip = Math.max(0, tip - 1); renderTip(); wiggle(); });
  $('karla-close').addEventListener('click', () => karla(false));
  $('karla-figure').addEventListener('click', wiggle);
  document.addEventListener('keydown', (e) => {
    if ($('view-study').hidden) return;
    if (!$('btn-show').hidden && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); showAnswer(); }
    else if (!$('ease-buttons').hidden && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key));
  });
  // Nach längerer Pause im Hintergrund: Inhalte prüfen und Übersicht auffrischen
  document.addEventListener('visibilitychange', () => {
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
  if (!load(KEY_TOUR, false) && state.cards.length) karla(true);
}

main();
