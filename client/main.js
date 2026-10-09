// App shell: menus, character select, lobbies, and match lifecycle.
import { loadCharacters, portrait, PLAYER_COLORS } from './characters.js';
import { Renderer } from './render/renderer.js';
import { setPortraitSource, playerLabel } from './render/hud.js';
import { Audio } from './audio.js';
import { LocalMatch, OnlineMatch, sendHello } from './match.js';
import { Showcase } from './ui/showcase.js';
import { startPadNav } from './ui/padnav.js';
import { CONTROL_HELP, resolveSources } from './input.js';
import { trainingPlayers } from './train-url.js';
import { STATS } from '/shared/balance/rules.js';
import { getStage, DEFAULT_STAGE_ID } from '/shared/stages/index.js';

const stage = getStage(DEFAULT_STAGE_ID);

setPortraitSource(portrait); // HUD portraits from the first frame (no lazy-import gap)

const $ = (s) => document.querySelector(s);
const app = {
  characters: null, renderer: null, audio: new Audio(), match: null, attract: null,
  socket: null, room: null, myId: null, mode: 'local', slots: [], focus: 0, showcases: [],
};

// ── Boot ────────────────────────────────────────────────────────────────
async function boot() {
  app.characters = await loadCharacters();
  app.renderer = new Renderer($('#game'), stage, app.characters);
  $('#roster-count').textContent = `${app.characters.size} fighter${app.characters.size === 1 ? '' : 's'} in the roster`;
  $('#player-name').value = localStorage.getItem('cb.name') || '';
  renderControls();
  wireMenus();
  startPadNav();
  const train = trainingPlayers(location.search, (id) => app.characters.has(id));
  if (train) {
    startLocal(train, true);
    return;
  }
  startAttract();
  show('title');
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  app.screen = id;
}

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

const ids = () => [...app.characters.keys()];
const randomId = () => ids()[Math.floor(Math.random() * ids().length)];
const entry = (id) => app.characters.get(id);

// Background CPU battle that plays behind the menus.
function startAttract() {
  stopAttract();
  if (app.characters.size === 0) return;
  const n = Math.min(4, Math.max(2, app.characters.size));
  const players = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: 'CPU', charId: randomId(), cpu: 'hard' }));
  app.attract = new LocalMatch({ renderer: app.renderer, audio: null, stage, characters: app.characters, players, rules: { infinite: true, countdown: false }, hud: false });
  app.attract.start();
}
function stopAttract() { app.attract?.stop(); app.attract = null; }

// ── Menus ───────────────────────────────────────────────────────────────
function wireMenus() {
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    app.audio.ui();
    const go = b.dataset.go;
    if (go === 'local') return openSelect('local');
    if (go === 'training') return openSelect('training');
    show(go);
  }));
  $('#start-local').addEventListener('click', startFromSelect);
  $('#create-room').addEventListener('click', () => connectAnd('room:create', {}));
  $('#join-room').addEventListener('click', () => connectAnd('room:join', { code: $('#room-code').value }));
  $('#room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join-room').click(); });
  $('#leave-room').addEventListener('click', leaveRoom);
  $('#add-bot').addEventListener('click', () => app.socket.emit('room:addBot', { level: $('#bot-level').value }));
  $('#lobby-stocks').addEventListener('change', (e) => app.socket.emit('room:settings', { stocks: Number(e.target.value) }));
  $('#start-online').addEventListener('click', () => app.socket.emit('room:start', null, (r) => { if (!r.ok) $('#lobby-error').textContent = r.error; }));
  // The only Resume handler: resume() is idempotent on both match kinds.
  $('#resume').addEventListener('click', () => (app.match ? app.match.resume() : closePause()));
  $('#quit').addEventListener('click', quitMatch);
  $('#results-continue').addEventListener('click', () => {
    app.audio.ui();
    if (app.room) { startAttract(); show('lobby'); renderLobby(); } else { startAttract(); show('title'); }
  });
  $('#results-rematch').addEventListener('click', () => { app.audio.ui(); startFromSelect(); });
  $('#results-select').addEventListener('click', () => { app.audio.ui(); startAttract(); openSelect(app.mode); });
}

function renderControls() {
  $('#controls-body').innerHTML = `
    <h3>Keyboard (solo & online)</h3><p>${CONTROL_HELP.solo}</p>
    <h3>Local 2-player keyboard</h3><p><b>P1</b> — ${CONTROL_HELP.p1}<br><b>P2</b> — ${CONTROL_HELP.p2}</p>
    <h3>Gamepad</h3><p>${CONTROL_HELP.pad}</p>
    <h3>How it works</h3>
    <div class="keys">
      <b>Attack + direction</b><span>Jab, side, up and down attacks (and aerials in the air)</span>
      <b>Smash (I)</b><span>Strong attacks — hold to charge up to +40% damage</span>
      <b>Special + direction</b><span>Four special moves. Up-special is your recovery.</span>
      <b>Shield</b><span>Block. Tap left/right to roll, down to spot-dodge, in the air to air-dodge.</span>
      <b>↓ on a platform</b><span>Drop through it. ↓ while falling = fast-fall.</span>
      <b>Goal</b><span>Damage % makes enemies fly farther. Knock them past the edges of the screen!</span>
    </div>`;
}

// ── Local / training select ─────────────────────────────────────────────
const CONTROLLERS = [
  ['any', 'Keyboard + Pad 1'], ['p1', 'Keys (left)'], ['p2', 'Keys (right)'],
  ['pad0', 'Gamepad 1'], ['pad1', 'Gamepad 2'], ['pad2', 'Gamepad 3'], ['pad3', 'Gamepad 4'],
  ['cpu-easy', 'CPU Easy'], ['cpu-normal', 'CPU Normal'], ['cpu-hard', 'CPU Hard'], ['off', 'Off'],
];
const TRAINING_DUMMY = [['cpu-dummy', 'Dummy'], ['cpu-easy', 'CPU Easy'], ['cpu-normal', 'CPU Normal'], ['cpu-hard', 'CPU Hard']];

function openSelect(mode) {
  app.mode = mode;
  const training = mode === 'training';
  $('#select-title').textContent = training ? 'Training — Pick a Fighter' : 'Choose Your Fighters';
  $('#stocks-wrap').classList.toggle('hidden', training);
  if (!app.slots.length || app.slotsMode !== mode) {
    app.slots = training
      ? [{ type: 'any', charId: ids()[0] }, { type: 'cpu-dummy', charId: ids()[1] || ids()[0] }]
      : [{ type: 'any', charId: ids()[0] }, { type: 'cpu-normal', charId: ids()[1] || ids()[0] }, { type: 'off', charId: 'random' }, { type: 'off', charId: 'random' }];
    app.slotsMode = mode;
    app.focus = 0;
  }
  buildGrid($('#local-grid'), (id) => {
    app.slots[app.focus].charId = id;
    if (app.slots[app.focus].type === 'off') app.slots[app.focus].type = 'cpu-normal';
    app.audio.select();
    renderSlots();
  });
  renderSlots();
  show('select');
}

function buildGrid(el, onPick) {
  el.innerHTML = '';
  for (const [id, e] of app.characters) {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.id = id;
    card.tabIndex = 0;
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    c.getContext('2d').drawImage(portrait(e, 120), 0, 0, 120, 120);
    card.append(c);
    const name = document.createElement('div');
    name.className = e.character.name.length > 11 ? 'name long' : 'name';
    name.textContent = e.character.name;
    card.append(name);
    const pips = document.createElement('div');
    pips.className = 'pips';
    card.append(pips);
    card.title = `${e.character.name} — by ${e.character.author}\n${e.character.description}`;
    card.addEventListener('click', () => onPick(id));
    el.append(card);
  }
  const rnd = document.createElement('div');
  rnd.className = 'char-card random';
  rnd.tabIndex = 0;
  rnd.textContent = '?';
  rnd.title = 'Random';
  rnd.addEventListener('click', () => onPick('random'));
  el.append(rnd);
}

function updatePips(gridEl, picks) {
  gridEl.querySelectorAll('.char-card').forEach((card) => {
    const pips = card.querySelector('.pips');
    if (!pips) return;
    pips.innerHTML = '';
    picks.forEach(({ charId, color }) => {
      if (charId !== card.dataset.id) return;
      const p = document.createElement('div');
      p.className = 'pip';
      p.style.background = color;
      pips.append(p);
    });
  });
}

function statRows(e) {
  if (!e) return '';
  const st = e.character.stats;
  const n = (k) => (st[k] - STATS[k].min) / (STATS[k].max - STATS[k].min);
  const rows = [
    ['Weight', n('weight')], ['Speed', n('runSpeed')], ['Air', n('airSpeed')], ['Jump', (n('jumpHeight') + n('doubleJumpHeight') + n('airJumps')) / 2.2],
    ['Power', e.report.movePower / e.report.moveBudget],
  ];
  return rows.map(([k, v]) => `<span>${k}</span><div class="stat-bar"><i style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></i></div>`).join('');
}

/** Escapes text for innerHTML (player and character names come from other people). */
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function slotElement({ index, color, title, controls, charId, extraClass = '', removable, ready }) {
  const el = document.createElement('div');
  el.className = `slot ${extraClass}`;
  el.style.setProperty('--slot-color', color);
  const e = charId === 'random' ? null : entry(charId);
  el.innerHTML = `
    <div class="slot-head"><span>${escHtml(title)}</span>${controls || ''}</div>
    <canvas></canvas>
    <div class="slot-name">${escHtml(e ? e.character.name : charId === 'random' ? 'Random' : '—')}</div>
    <div class="stats">${statRows(e)}</div>`;
  if (removable) {
    const b = document.createElement('button');
    b.className = 'remove'; b.textContent = '✕';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); removable(); });
    el.append(b);
  }
  if (ready) { const r = document.createElement('div'); r.className = 'ready-tag'; r.textContent = ready; el.append(r); }
  return { el, entry: e, index };
}

function mountShowcases(items) {
  app.showcases.forEach((s) => s.destroy());
  app.showcases = items.filter((i) => i.entry).map((i) => {
    const sc = new Showcase(i.el.querySelector('canvas'), { color: i.color });
    sc.set(i.entry, i.color);
    return sc;
  });
}

function renderSlots() {
  const wrap = $('#slots');
  wrap.innerHTML = '';
  const training = app.mode === 'training';
  const items = app.slots.map((s, i) => {
    const color = PLAYER_COLORS[i];
    const opts = (training && i === 1 ? TRAINING_DUMMY : training ? CONTROLLERS.filter(([v]) => !v.startsWith('cpu') && v !== 'off') : CONTROLLERS)
      .map(([v, l]) => `<option value="${v}" ${v === s.type ? 'selected' : ''}>${l}</option>`).join('');
    const it = slotElement({ index: i, color, title: `P${i + 1}`, controls: `<select>${opts}</select>`, charId: s.charId, extraClass: `${i === app.focus ? 'focus' : ''} ${s.type === 'off' ? 'off' : ''}` });
    it.color = color;
    it.el.querySelector('select').addEventListener('change', (ev) => { s.type = ev.target.value; renderSlots(); });
    it.el.querySelector('select').addEventListener('click', (ev) => ev.stopPropagation());
    it.el.addEventListener('click', () => { app.focus = i; app.audio.ui(); renderSlots(); });
    wrap.append(it.el);
    return it;
  });
  mountShowcases(items);
  updatePips($('#local-grid'), app.slots.filter((s) => s.type !== 'off').map((s, i) => ({ charId: s.charId, color: PLAYER_COLORS[app.slots.indexOf(s)] })));
}

function startFromSelect() {
  const active = app.slots.map((s, i) => ({ ...s, i })).filter((s) => s.type !== 'off');
  if (active.length < 2) return toast('Need at least 2 fighters.');
  // 'Keyboard + Pad 1' gives up any keys/pad another human slot claimed.
  const human = active.filter((s) => !s.type.startsWith('cpu-'));
  const dupe = human.find((s, k) => human.findIndex((o) => o.type === s.type) !== k);
  if (dupe) toast(`Two players share the same controls (${CONTROLLERS.find(([v]) => v === dupe.type)?.[1]}).`);
  const sources = new Map(human.map((s, k) => [s.i, resolveSources(human.map((o) => o.type))[k]]));
  const players = active.map((s) => {
    const cpu = s.type.startsWith('cpu-') ? s.type.slice(4) : null;
    return {
      id: `p${s.i}`, name: cpu ? `CPU ${s.i + 1}` : `P${s.i + 1}`,
      charId: s.charId === 'random' ? randomId() : s.charId, cpu, source: cpu ? null : sources.get(s.i),
    };
  });
  startLocal(players, app.mode === 'training', Number($('#stocks').value));
}

function startLocal(players, training, stocks = 3) {
  stopAttract();
  show(null);
  app.showcases.forEach((s) => s.destroy());
  $('#training-help').classList.toggle('hidden', !training);
  app.match = new LocalMatch({
    renderer: app.renderer, audio: app.audio, stage, characters: app.characters, players, training,
    rules: { stocks },
    onEnd: (data) => showResults(data),
    onPause: (p) => openPause(p, training ? 'H hitboxes · R reset positions · Y slow-mo · T taunt' : ''),
  });
  app.match.start();
}

// ── Pause ───────────────────────────────────────────────────────────────
function openPause(open, hint = '') {
  $('#pause').classList.toggle('hidden', !open);
  $('#pause-hint').textContent = hint;
  $('#quit').textContent = app.room ? 'Leave Room' : 'Quit Match';
}
function closePause() { $('#pause').classList.add('hidden'); }

function quitMatch() {
  closePause();
  $('#training-help').classList.add('hidden');
  app.match?.stop();
  app.match = null;
  if (app.room) { leaveRoom(); return; }
  if (new URLSearchParams(location.search).has('train')) history.replaceState(null, '', '/');
  startAttract();
  show('title');
}

// ── Results ─────────────────────────────────────────────────────────────
function showResults({ results, winner }) {
  app.match = null;
  closePause();
  $('#training-help').classList.add('hidden');
  const roster = app.renderer.roster;
  const info = (id) => roster.find((r) => r.id === id);
  const w = info(winner) || info(results[0]?.id);
  $('#winner-name').textContent = w ? `${playerLabel(w)} · ${w.entry.character.name}` : 'Draw';
  $('#winner-name').style.color = w?.color || '#fff';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  $('#results-table').innerHTML = `<tr><th>#</th><th>Player</th><th>KOs</th><th>Falls</th><th>Damage</th></tr>` +
    results.map((r) => {
      const i = info(r.id);
      const who = i ? playerLabel(i) : r.name;
      return `<tr><td class="place" style="color:${i?.color}">${r.placement}</td><td><i class="swatch" style="background:${i?.color || '#fff'}"></i>${esc(who)} <span style="opacity:.6">(${esc(entry(r.charId)?.character.name || r.charId)})</span></td><td>${r.kos}</td><td>${r.falls}</td><td>${r.damageDealt}%</td></tr>`;
    }).join('');
  // Local play can jump straight back in with the same setup.
  $('#results-rematch').classList.toggle('hidden', !!app.room);
  $('#results-select').classList.toggle('hidden', !!app.room);
  $('#results-continue').classList.toggle('primary', !!app.room);
  app.showcases.forEach((s) => s.destroy());
  if (w) {
    const sc = new Showcase($('#winner-canvas'), { color: w.color, zoom: 0.95 });
    sc.set(w.entry, w.color);
    app.showcases = [sc];
  }
  show('results');
}

// ── Online ──────────────────────────────────────────────────────────────
function ensureSocket() {
  if (app.socket) return app.socket;
  if (!window.io) { toast('Online play needs the server (npm start).'); return null; }
  const s = window.io({ transports: ['websocket', 'polling'] });
  app.socket = s;
  app.net = { socket: s };
  s.on('connect', () => { app.myId = s.id; sendHello(s, app.characters); });
  s.on('room:stale', ({ message }) => toast(message, 8000));
  s.on('disconnect', () => { if (app.room) { toast('Disconnected from server.'); app.room = null; app.match?.stop(); app.match = null; closePause(); startAttract(); show('online'); } });
  s.on('room:state', (st) => { app.room = st; if (app.screen === 'lobby') renderLobby(); });
  s.on('match:start', (start) => {
    const { roster } = start;
    stopAttract();
    app.showcases.forEach((x) => x.destroy());
    show(null);
    app.match = new OnlineMatch({
      renderer: app.renderer, audio: app.audio, net: app.net, roster, start, source: 'any',
      onAbort: (a) => { toast(a.message || 'Match aborted.', 6000); app.match = null; closePause(); startAttract(); show('lobby'); renderLobby(); },
      onEnd: (data) => showResults(data),
      onPause: (open) => openPause(open, 'The match keeps running online.'),
    });
    app.match.start();
  });
  return s;
}

function connectAnd(event, payload) {
  const s = ensureSocket();
  if (!s) return;
  const name = $('#player-name').value.trim() || 'Player';
  localStorage.setItem('cb.name', name);
  $('#online-error').textContent = '';
  s.emit(event, { ...payload, name }, (r) => {
    if (!r?.ok) { $('#online-error').textContent = r?.error || 'Could not connect.'; return; }
    app.audio.select();
    show('lobby');
    buildGrid($('#online-grid'), (id) => { app.socket.emit('room:select', { charId: id === 'random' ? randomId() : id }); app.audio.select(); });
    renderLobby();
  });
}

function leaveRoom() {
  app.socket?.emit('room:leave');
  app.room = null;
  app.match?.stop();
  app.match = null;
  closePause();
  app.showcases.forEach((s) => s.destroy());
  startAttract();
  show('online');
}

function renderLobby() {
  const room = app.room;
  if (!room) return;
  $('#lobby-code').textContent = room.code;
  const host = room.hostId === app.socket.id;
  document.querySelectorAll('.host-only').forEach((e) => e.classList.toggle('hidden', !host));
  document.querySelectorAll('.guest-only').forEach((e) => e.classList.toggle('hidden', host));
  $('#lobby-stocks').value = String(room.stocks);
  const wrap = $('#lobby-slots');
  wrap.innerHTML = '';
  const items = room.players.map((p, i) => {
    const color = PLAYER_COLORS[i];
    const me = p.id === app.socket.id;
    const it = slotElement({
      index: i, color, title: `${p.bot ? `CPU ${i + 1} · ${p.bot}` : playerLabel({ index: i, name: p.name })}${me ? ' (you)' : ''}${p.id === room.hostId ? ' ★' : ''}`,
      charId: p.charId, extraClass: me ? 'focus' : '',
      removable: host && p.bot ? () => app.socket.emit('room:removeBot', { id: p.id }) : null,
    });
    it.color = color;
    wrap.append(it.el);
    return it;
  });
  mountShowcases(items);
  updatePips($('#online-grid'), room.players.map((p, i) => ({ charId: p.charId, color: PLAYER_COLORS[i] })));
  $('#lobby-error').textContent = room.inMatch ? 'Match in progress…' : '';
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:#f88;padding:20px">${e.stack}</pre>`); });
