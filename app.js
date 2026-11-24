'use strict';
/* =====================================================================
   RCJ Rescue Maze – configuratore, arbitraggio e report PDF
   Punteggi secondo RCJ Rescue Maze 2027 (draft, 2026-09-08), cap. 5.6
   ===================================================================== */

// ---------------------------------------------------------------- utils
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtDate = ts => ts ? new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '-';
const K = (f, x, y) => f + ',' + x + ',' + y;
const unK = k => k.split(',').map(Number);
const rnd = n => Math.floor(Math.random() * n);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }

// ------------------------------------------------------------ definitions
const TILE = {
  normal: { label: 'Normale', color: '#ffffff' },
  black:  { label: 'Nera (buco)', color: '#1e1e1e' },
  silver: { label: 'Argento (checkpoint)', color: '#b9c2cc' },
  blue:   { label: 'Blu (pozzanghera)', color: '#5a9be6' },
  red:    { label: 'Rossa (ingresso ZP)', color: '#e05252' },
  start:  { label: 'Partenza', color: '#86d49a' },
  ramp:   { label: 'Rampa', color: '#f3cd62' },
  stairs: { label: 'Scale', color: '#d19a5c' },
  void:   { label: 'Vuota (fuori campo)', color: '#e9ecef' },
};
const FLAGS = { bump: 'Dossi', obs: 'Ostacolo', debris: 'Detriti', danger: 'Zona pericolosa' };
const VKIND = { smiley: 'Smiley', cog: 'Target cognitivo', fake: 'Falsa vittima' };
const VSTAT = { H: 'Ferita', S: 'Stabile', U: 'Illesa' };
const KITS = { H: 2, S: 1, U: 0 };
const SIDE = { N: 'Nord', E: 'Est', S: 'Sud', W: 'Ovest' };
const MAXSIZE = 26;

// ---------------------------------------------------------------- model
const newTile = () => ({ t: 'normal', bump: false, obs: false, debris: false, danger: false });
function newFloor(w, h) {
  const tiles = Array.from({ length: w * h }, newTile);
  const hw = new Array((h + 1) * w).fill(false), vw = new Array(h * (w + 1)).fill(false);
  const fl = { tiles, hw, vw };
  perimeter({ w, h }, fl);
  return fl;
}
function perimeter(m, fl) {
  for (let x = 0; x < m.w; x++) { fl.hw[x] = true; fl.hw[m.h * m.w + x] = true; }
  for (let y = 0; y < m.h; y++) { fl.vw[y * (m.w + 1)] = true; fl.vw[y * (m.w + 1) + m.w] = true; }
}
function newMap(name, w, h) {
  const m = { id: uid(), name, w, h, floors: [newFloor(w, h)], victims: [], created: Date.now(), updated: Date.now() };
  m.floors[0].tiles[(h - 1) * w].t = 'start';
  return m;
}
const tileAt = (m, f, x, y) => m.floors[f].tiles[y * m.w + x];
function wallIdx(m, x, y, side) {
  switch (side) {
    case 'N': return ['hw', y * m.w + x];
    case 'S': return ['hw', (y + 1) * m.w + x];
    case 'W': return ['vw', y * (m.w + 1) + x];
    case 'E': return ['vw', y * (m.w + 1) + x + 1];
  }
}
const getWall = (m, f, x, y, s) => { const [a, i] = wallIdx(m, x, y, s); return !!m.floors[f][a][i]; };
const setWall = (m, f, x, y, s, v) => { const [a, i] = wallIdx(m, x, y, s); m.floors[f][a][i] = v; };
const colName = x => x < 26 ? String.fromCharCode(65 + x) : 'X' + x;
const tname = (f, x, y) => `P${f + 1}-${colName(x)}${y + 1}`;
const tnameK = k => tname(...unK(k));
const vIndex = (m, v) => m.victims.indexOf(v) + 1;
const vname = (m, v) => `Vittima ${vlabel(m, v)} - ${VKIND[v.kind]}${v.kind === 'fake' ? '' : ' ' + VSTAT[v.status]} (${tname(v.f, v.x, v.y)} ${SIDE[v.side]})`;

function startPos(m) {
  for (let f = 0; f < m.floors.length; f++) {
    const i = m.floors[f].tiles.findIndex(t => t.t === 'start');
    if (i >= 0) return { f, x: i % m.w, y: Math.floor(i / m.w) };
  }
  return { f: 0, x: 0, y: m.h - 1 };
}

// --------------------------------------------- linear / floating victims
// Regola 3.3: le caselle "lineari" sono quelle raggiungibili dalla partenza seguendo
// sempre il muro sinistro/destro. Le caselle nere contano come muri virtuali.
// Implementazione: una vittima è lineare se il suo muro appartiene allo stesso
// insieme connesso di muri che tocca la casella di partenza (o rampe/scale sui piani superiori).
function wallComp(m, f) {
  const W = m.w, H = m.h, fl = m.floors[f], V = (x, y) => y * (W + 1) + x;
  const p = Array.from({ length: (W + 1) * (H + 1) }, (_, i) => i), has = new Uint8Array(p.length);
  const find = i => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  const uni = (a, b) => { has[a] = has[b] = 1; a = find(a); b = find(b); if (a !== b) p[a] = b; };
  const blk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ['black', 'void'].includes(fl.tiles[y * W + x].t);
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) if (fl.hw[y * W + x] || blk(x, y - 1) || blk(x, y)) uni(V(x, y), V(x + 1, y));
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (fl.vw[y * (W + 1) + x] || blk(x - 1, y) || blk(x, y)) uni(V(x, y), V(x, y + 1));
  const seeds = new Set();
  fl.tiles.forEach((t, i) => {
    if (t.t === 'start' || (f > 0 && (t.t === 'ramp' || t.t === 'stairs'))) {
      const x = i % W, y = Math.floor(i / W);
      for (const [a, b] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) if (has[V(a, b)]) seeds.add(find(V(a, b)));
    }
  });
  if (!seeds.size && has[0]) seeds.add(find(0));
  return { find, seeds, V };
}
function computeLinearity(m) {
  const comps = m.floors.map((_, f) => wallComp(m, f)), res = {};
  for (const v of m.victims) {
    const c = comps[v.f]; if (!c) continue;
    const vx = v.side === 'E' ? v.x + 1 : v.x, vy = v.side === 'S' ? v.y + 1 : v.y;
    res[v.id] = c.seeds.has(c.find(c.V(vx, vy)));
  }
  return res;
}
const isLinear = (v, lin) => v.lin === 'L' ? true : v.lin === 'F' ? false : !!lin[v.id];

// ---------------------------------------------------------- run replay
function emptyState(m) {
  const sp = startPos(m);
  return { start: sp, pos: { ...sp }, visited: new Set([K(sp.f, sp.x, sp.y)]), cps: new Set(), blue: new Map(),
    bumps: new Set(), ramps: new Set(), stairs: new Set(), vic: {}, misid: 0, lop: 0, exit: false, lastCP: null };
}
function replay(run) {
  const m = run.map, st = emptyState(m);
  const V = id => (st.vic[id] ||= { id: false, kits: 0 });
  for (const e of run.events) {
    switch (e.type) {
      case 'pos': st.pos = { f: e.f, x: e.x, y: e.y }; st.visited.add(K(e.f, e.x, e.y)); if (tileAt(m, e.f, e.x, e.y).t === 'silver') st.lastCP = { f: e.f, x: e.x, y: e.y }; break;
      case 'cp': if (e.on) { st.cps.add(e.k); const [f, x, y] = unK(e.k); st.lastCP = { f, x, y }; } else st.cps.delete(e.k); break;
      case 'blue': st.blue.set(e.k, Math.max(0, (st.blue.get(e.k) || 0) + e.d)); break;
      case 'bump': e.on ? st.bumps.add(e.k) : st.bumps.delete(e.k); break;
      case 'ramp': e.on ? st.ramps.add(e.k) : st.ramps.delete(e.k); break;
      case 'stairs': e.on ? st.stairs.add(e.k) : st.stairs.delete(e.k); break;
      case 'vid': V(e.v).id = e.on; break;
      case 'kit': V(e.v).kits = e.n; break;
      case 'misid': st.misid = Math.max(0, st.misid + e.d); break;
      case 'lop': st.lop++; st.pos = { ...(st.lastCP || st.start) }; break;
      case 'exit': st.exit = e.on; break;
    }
  }
  return st;
}

// ---------------------------------------------------------------- scoring
function scoreRun(m, st) {
  const lin = computeLinearity(m);
  let svi = 0, srd = 0, vPts = 0, kPts = 0;
  const vrows = [];
  for (const v of m.victims) {
    const s = st.vic[v.id] || { id: false, kits: 0 };
    const L = isLinear(v, lin);
    let p = 0, kp = 0, k = 0;
    if (v.kind !== 'fake' && s.id) {
      svi++;
      p = v.kind === 'smiley' ? (L ? 5 : 15) : (L ? 10 : 30);
      k = Math.min(s.kits || 0, KITS[v.status]);
      kp = k === 1 ? 10 : k === 2 ? 30 : 0;
      srd += k; vPts += p; kPts += kp;
    }
    vrows.push({ v, L, identified: v.kind !== 'fake' && s.id, kits: s.kits || 0, kitsOk: k, pts: p, kitPts: kp });
  }
  let bPts = 0, sbv = 0;
  for (const c of st.blue.values()) if (c > 0) { bPts += Math.max(0, 30 - 10 * (c - 1)); if (c === 1) sbv++; }
  const cp = st.cps.size * 10, bump = st.bumps.size * 5, ramp = st.ramps.size * 10, stairs = st.stairs.size * 10;
  const rel = Math.max(0, svi * 10 + srd * 10 + sbv * 10 - st.lop * 15);
  const exit = st.exit ? svi * 10 + sbv * 10 + st.stairs.size * 5 + st.ramps.size * 5 : 0;
  const mis = st.misid * 5;
  const gross = vPts + kPts + bPts + cp + bump + ramp + stairs + rel + exit;
  const total = Math.max(0, gross - mis);
  const lines = [
    ['Vittime identificate', `${svi} (SVI)`, vPts],
    ['Kit di soccorso', `${srd} consegnati (SRD)`, kPts],
    ['Caselle blu', `${st.blue.size} visitate, ${sbv} una sola volta (SBV)`, bPts],
    ['Checkpoint', `${st.cps.size} x 10`, cp],
    ['Dossi', `${st.bumps.size} caselle x 5`, bump],
    ['Rampe', `${st.ramps.size} x 10`, ramp],
    ['Scale', `${st.stairs.size} x 10`, stairs],
    ['Bonus affidabilità', `SVI·10 + SRD·10 + SBV·10 − LoP·15 (LoP: ${st.lop})`, rel],
    ['Bonus uscita', st.exit ? 'SVI·10 + SBV·10 + SSN·5 + SRN·5' : 'non ottenuto', exit],
    ['Misidentificazioni', `${st.misid} x −5`, -mis],
  ];
  return { total, lines, vrows, svi, srd, sbv, lop: st.lop, misid: st.misid, exit: st.exit };
}
function maxState(m) {
  const st = emptyState(m);
  m.floors.forEach((fl, f) => fl.tiles.forEach((t, i) => {
    const k = K(f, i % m.w, Math.floor(i / m.w));
    if (t.t === 'silver') st.cps.add(k);
    if (t.t === 'blue') st.blue.set(k, 1);
    if (t.t === 'ramp') st.ramps.add(k);
    if (t.t === 'stairs') st.stairs.add(k);
    if (t.bump) st.bumps.add(k);
  }));
  for (const v of m.victims) st.vic[v.id] = { id: true, kits: KITS[v.status] || 0 };
  st.exit = true;
  return st;
}

// ------------------------------------------------------------- validation
function validate(m) {
  const out = [];
  let starts = 0;
  m.floors.forEach(fl => fl.tiles.forEach(t => { if (t.t === 'start') starts++; }));
  if (starts === 0) out.push('Manca la casella di partenza.');
  if (starts > 1) out.push('Ci sono più caselle di partenza.');
  const sp = startPos(m);
  if (starts && tileAt(m, sp.f, sp.x, sp.y).danger) out.push('La partenza non può essere nella zona pericolosa (3.5.8).');
  const hasDanger = m.floors.some(fl => fl.tiles.some(t => t.danger)), hasRed = m.floors.some(fl => fl.tiles.some(t => t.t === 'red'));
  if (hasDanger && !hasRed) out.push('Zona pericolosa senza casella rossa di ingresso (3.5.2).');
  for (const v of m.victims) {
    const t = tileAt(m, v.f, v.x, v.y);
    if (!getWall(m, v.f, v.x, v.y, v.side)) out.push(`Vittima ${vlabel(m, v)}: non è su un muro.`);
    if (['black', 'silver', 'blue', 'red', 'ramp', 'stairs', 'void'].includes(t.t) || t.obs || t.bump)
      out.push(`Vittima ${vlabel(m, v)}: su muro che dà su ${TILE[t.t].label.toLowerCase()}${t.obs ? '/ostacolo' : ''}${t.bump ? '/dossi' : ''} (3.6.3).`);
  }
  if (starts === 1 && !solvable(m, 0)) out.push('Piano 1: alcune caselle non sono raggiungibili dalla partenza (caselle nere/muri).');
  return out;
}
function solvable(m, f) {
  const fl = m.floors[f], sp = startPos(m);
  if (sp.f !== f) return true;
  const ok = (x, y) => !['black', 'void'].includes(fl.tiles[y * m.w + x].t);
  const seen = new Set([sp.y * m.w + sp.x]), q = [[sp.x, sp.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [s, dx, dy] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || getWall(m, f, x, y, s) || !ok(nx, ny) || seen.has(ny * m.w + nx)) continue;
      seen.add(ny * m.w + nx); q.push([nx, ny]);
    }
  }
  return fl.tiles.every((t, i) => !ok(i % m.w, Math.floor(i / m.w)) || seen.has(i));
}

// --------------------------------------------------------- classic maze
// Labirinto "perfetto" (recursive backtracker) + anelli/foyer opzionali + elementi RCJ casuali
function generateMaze(m, f, loops, populate) {
  const fl = m.floors[f], W = m.w, H = m.h;
  fl.tiles.forEach((t, i) => { if (!(f === 0 && t.t === 'start')) Object.assign(t, newTile()); });
  fl.hw.fill(true); fl.vw.fill(true);
  m.victims = m.victims.filter(v => v.f !== f);
  const sp = f === 0 ? startPos(m) : { x: 0, y: H - 1 };
  const seen = new Set([sp.y * W + sp.x]), stack = [[sp.x, sp.y]];
  const dirs = [['N', 0, -1, 'S'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E'], ['E', 1, 0, 'W']];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = dirs.filter(([, dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && !seen.has(ny * W + nx); });
    if (!opts.length) { stack.pop(); continue; }
    const [s, dx, dy] = opts[rnd(opts.length)];
    setWall(m, f, x, y, s, false);
    seen.add((y + dy) * W + x + dx); stack.push([x + dx, y + dy]);
  }
  // anelli: rimuove muri interni a caso (i labirinti RCJ non sono "perfetti")
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const s of ['E', 'S']) {
    if ((s === 'E' && x === W - 1) || (s === 'S' && y === H - 1)) continue;
    if (getWall(m, f, x, y, s) && Math.random() < loops) setWall(m, f, x, y, s, false);
  }
  if (!populate) return;
  const free = () => fl.tiles.map((t, i) => [t, i]).filter(([t]) => t.t === 'normal' && !t.bump && !t.obs);
  const pick = () => { const a = free(); return a.length ? a[rnd(a.length)] : null; };
  const n = W * H;
  for (let i = 0; i < Math.max(1, Math.round(n / 14)); i++) { const p = pick(); if (p) p[0].t = 'silver'; }
  for (let i = 0; i < Math.max(1, Math.round(n / 24)); i++) { const p = pick(); if (p) p[0].t = 'blue'; }
  for (let i = 0; i < Math.max(1, Math.round(n / 24)); i++) { const p = pick(); if (p) p[0].bump = true; }
  for (let i = 0; i < Math.max(1, Math.round(n / 16)); i++) {
    const p = pick(); if (!p) break;
    p[0].t = 'black';
    if (f === 0 && !solvable(m, 0)) p[0].t = 'normal';
  }
  // vittime: sui muri di caselle normali, preferibilmente nei vicoli ciechi
  const cand = [];
  fl.tiles.forEach((t, i) => {
    if (t.t !== 'normal' || t.bump || t.obs) return;
    const x = i % W, y = Math.floor(i / W);
    const walls = Object.keys(SIDE).filter(s => getWall(m, f, x, y, s));
    for (const s of walls) cand.push({ x, y, s, w: walls.length });
  });
  cand.sort((a, b) => b.w - a.w + (Math.random() - .5) * 2);
  const used = new Set(), nv = Math.max(2, Math.round(n / 7));
  for (const c of cand) {
    if (used.size >= nv) break;
    if (used.has(c.x + ',' + c.y)) continue;
    used.add(c.x + ',' + c.y);
    const r = Math.random();
    m.victims.push({ id: uid(), f, x: c.x, y: c.y, side: c.s, kind: r < .45 ? 'smiley' : r < .9 ? 'cog' : 'fake', status: 'HSU'[rnd(3)], lin: null });
  }
}

function sampleMap() {
  const m = newMap('Esempio – campo 8x6', 8, 6);
  const W = (x, y, s) => setWall(m, 0, x, y, s, true);
  [[0, 1, 'S'], [1, 1, 'S'], [2, 1, 'S'],            // divisorio in alto a sinistra
   [5, 0, 'E'], [6, 1, 'S'], [7, 1, 'S'],             // zona pericolosa G1-H2 (ingresso da F2)
   [5, 1, 'S'],                                       // muro con falsa vittima
   [3, 3, 'E'], [3, 3, 'S'],                          // isola: muri non collegati -> vittime flottanti
   [1, 4, 'E'], [1, 5, 'E'],                          // corridoio in basso
   [6, 3, 'S'], [7, 3, 'S']].forEach(a => W(...a));   // muro sopra la rampa
  const T = (x, y, t) => { tileAt(m, 0, x, y).t = t; };
  T(2, 4, 'silver'); T(6, 2, 'silver'); T(4, 5, 'blue'); T(1, 2, 'black'); T(6, 1, 'red'); T(7, 4, 'ramp');
  tileAt(m, 0, 5, 4).bump = true; tileAt(m, 0, 3, 0).obs = true;
  for (const [x, y] of [[6, 0], [7, 0], [6, 1], [7, 1]]) tileAt(m, 0, x, y).danger = true;
  const V = (x, y, side, kind, status) => m.victims.push({ id: uid(), f: 0, x, y, side, kind, status, lin: null });
  V(0, 0, 'W', 'smiley', 'H'); V(1, 5, 'S', 'smiley', 'S'); V(3, 3, 'E', 'cog', 'S'); V(4, 3, 'W', 'smiley', 'H');
  V(7, 0, 'N', 'cog', 'H'); V(5, 2, 'N', 'fake', 'U'); V(7, 5, 'E', 'smiley', 'U');
  return m;
}

// --------------------------------------------------------------- storage
const LS = {
  get(k, d) { try { const v = localStorage.getItem('rcjmaze.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rcjmaze.' + k, JSON.stringify(v)); } catch (e) { toast('Salvataggio non riuscito: ' + e.message); } },
};
let maps = LS.get('maps', null);
if (!Array.isArray(maps) || !maps.length) maps = [sampleMap()];
let runs = LS.get('runs', []);
const ui = Object.assign({ tab: 'editor', mapId: maps[0].id, floor: 0, runFloor: 0, tool: 'wall', vkind: 'smiley', vstat: 'H',
  sel: null, activeRun: null, setupMap: null, histTeam: '', histMap: '', drop: 0, recapDetails: true }, LS.get('ui', {}));
const saveMaps = () => LS.set('maps', maps);
const saveRuns = () => LS.set('runs', runs);
const saveUI = () => LS.set('ui', ui);
let saveMapsT; const saveMapsSoon = () => { clearTimeout(saveMapsT); saveMapsT = setTimeout(saveMaps, 300); };

const curMap = () => maps.find(m => m.id === ui.mapId) || maps[0];
const activeRun = () => runs.find(r => r.id === ui.activeRun) || null;

// ================================================================ DRAWING
// Stile ispirato agli scoresheet del RCJ Rescue CMS: caselle crema (lineari) / menta (flottanti),
// muri come barre tra i pilastri (neri = lineari, blu scuro = flottanti), elementi numerati,
// vittime con cerchio rosa ed etichetta (A, B, … lineari · α, β, … flottanti).
const COL = { cream: '#fff8e1', mint: '#b6f5d2', wall: '#111111', wallF: '#0b1a80', pillar: '#cdcdcd', border: '#8f8f8f',
  badge: '#2f86d6', pink: '#e8418f', black: '#000000', red: '#ff1f1f', blue: '#0a1cf5', ramp: '#f3cd62', stairs: '#e2c49a', start: '#9fd14a' };
const LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', GRK = 'αβγδεζηθικλμνξοπρστυφχψω';
const seqLabel = (i, set) => set[i % set.length] + (i >= set.length ? Math.floor(i / set.length) + 1 : '');

function analyze(m) {
  const comps = m.floors.map((_, f) => wallComp(m, f));
  const vLin = (f, x, y) => { const c = comps[f]; return c.seeds.has(c.find(c.V(x, y))); };
  const vicLin = {}, label = {};
  let li = 0, fi = 0, qi = 0;
  for (const v of m.victims) {
    const vx = v.side === 'E' ? v.x + 1 : v.x, vy = v.side === 'S' ? v.y + 1 : v.y;
    vicLin[v.id] = vLin(v.f, vx, vy);
    const L = isLinear(v, vicLin);
    label[v.id] = v.kind === 'fake' ? '?' + (++qi) : L ? seqLabel(li++, LAT) : seqLabel(fi++, GRK);
  }
  const floatTile = m.floors.map((fl, f) => fl.tiles.map((t, i) => {
    const x = i % m.w, y = Math.floor(i / m.w); let lin = 0, flo = 0;
    for (const s of ['N', 'E', 'S', 'W']) if (getWall(m, f, x, y, s)) {
      const [vx, vy] = s === 'E' ? [x + 1, y] : s === 'S' ? [x, y + 1] : [x, y];
      vLin(f, vx, vy) ? lin++ : flo++;
    }
    return flo > 0 && lin === 0;
  }));
  const num = { cp: {}, blue: {}, bump: {}, ramp: {}, stairs: {} }, cnt = { cp: 0, blue: 0, bump: 0, ramp: 0, stairs: 0 };
  m.floors.forEach((fl, f) => fl.tiles.forEach((t, i) => {
    const k = K(f, i % m.w, Math.floor(i / m.w));
    if (t.t === 'silver') num.cp[k] = ++cnt.cp;
    if (t.t === 'blue') num.blue[k] = ++cnt.blue;
    if (t.t === 'ramp') num.ramp[k] = ++cnt.ramp;
    if (t.t === 'stairs') num.stairs[k] = ++cnt.stairs;
    if (t.bump) num.bump[k] = ++cnt.bump;
  }));
  return { vLin, vicLin, label, floatTile, num };
}
const vlabel = (m, v) => analyze(m).label[v.id] || '?';

function drawMap(ctx, m, f, ts, pad, o = {}) {
  const fl = m.floors[f], st = o.st, A = o.an || analyze(m), lin = A.vicLin;
  const Wp = m.w * ts + pad * 2, Hp = m.h * ts + pad * 2, g = Math.max(3, ts * 0.13), s = ts - g;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, Wp, Hp);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!o.noCoords) {
    ctx.fillStyle = '#8a94a3'; ctx.font = `${Math.max(9, pad * 0.5)}px sans-serif`;
    for (let x = 0; x < m.w; x++) ctx.fillText(colName(x), pad + x * ts + ts / 2, pad / 2 - 2);
    for (let y = 0; y < m.h; y++) ctx.fillText(String(y + 1), pad / 2 - 2, pad + y * ts + ts / 2);
  }
  ctx.save(); ctx.translate(pad, pad);
  const badge = (n, x, y) => { const b = ts * .22; ctx.fillStyle = COL.badge; ctx.fillRect(x, y, b, b); ctx.fillStyle = '#fff'; ctx.font = `${b * .8}px sans-serif`; ctx.fillText(String(n), x + b / 2, y + b / 2 + 1); };
  const circ = (n, x, y) => { const r = ts * .11; ctx.fillStyle = COL.badge; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = `${r * 1.4}px sans-serif`; ctx.fillText(String(n), x, y + 1); };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = y * m.w + x, t = fl.tiles[i], X = x * ts + g / 2, Y = y * ts + g / 2, k = K(f, x, y);
    if (t.t === 'void') { ctx.fillStyle = '#eef0f2'; ctx.fillRect(X, Y, s, s); ctx.strokeStyle = '#d4d8dd'; ctx.lineWidth = 1; hatch(ctx, X, Y, s, 8); continue; }
    const base = { normal: 1, start: 1 }[t.t] ? (A.floatTile[f][i] ? COL.mint : COL.cream) : { black: COL.black, red: COL.red, blue: COL.blue, ramp: COL.ramp, stairs: COL.stairs, silver: '#c5cbd2' }[t.t];
    ctx.fillStyle = base; ctx.fillRect(X, Y, s, s);
    if (t.t === 'silver') { const gr = ctx.createLinearGradient(X, Y, X + s, Y + s); gr.addColorStop(0, '#f1f3f5'); gr.addColorStop(.45, '#9aa3ad'); gr.addColorStop(.55, '#b9c0c8'); gr.addColorStop(1, '#eef0f3'); ctx.fillStyle = gr; ctx.fillRect(X, Y, s, s); }
    if (st && st.visited.has(k) && !['black', 'blue', 'red'].includes(t.t)) { ctx.fillStyle = 'rgba(46,158,79,.20)'; ctx.fillRect(X, Y, s, s); }
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1; ctx.strokeRect(X + .5, Y + .5, s - 1, s - 1);
    if (t.danger) { ctx.strokeStyle = 'rgba(230,60,60,.45)'; ctx.lineWidth = 1; hatch(ctx, X, Y, s, 7); }
    if (t.t === 'stairs') { ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = Math.max(1.5, ts * .03); for (let j = 1; j < 5; j++) { ctx.beginPath(); ctx.moveTo(X + s * .12, Y + s * j / 5); ctx.lineTo(X + s * .88, Y + s * j / 5); ctx.stroke(); } }
    if (t.t === 'ramp') { ctx.strokeStyle = '#8a6a10'; ctx.lineWidth = Math.max(2, ts * .04); for (const off of [.35, .6]) { ctx.beginPath(); ctx.moveTo(X + s * .3, Y + s * (off + .15)); ctx.lineTo(X + s * .5, Y + s * off); ctx.lineTo(X + s * .7, Y + s * (off + .15)); ctx.stroke(); } }
    if (t.debris) { ctx.fillStyle = '#7d6b58'; for (const [a, b] of [[.3, .35], [.62, .3], [.45, .62], [.7, .7], [.28, .72]]) { ctx.beginPath(); ctx.arc(X + s * a, Y + s * b, ts * .035, 0, 7); ctx.fill(); } }
    if (t.obs) { ctx.fillStyle = '#4b5563'; roundRect(ctx, X + s * .35, Y + s * .3, s * .32, s * .32, s * .05); ctx.fill(); }
    if (t.bump) { drawLogs(ctx, X + s * .1, Y + s * .58, s * .38, s * .26); circ(A.num.bump[k], X + s * .72, Y + s * .72); }
    if (t.t === 'start') { const cx = X + s * .28, cy = Y + s * .28, r = s * .16; ctx.strokeStyle = COL.start; ctx.lineWidth = r * .35; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.fillStyle = COL.start; ctx.beginPath(); ctx.moveTo(cx - r * .3, cy - r * .45); ctx.lineTo(cx + r * .5, cy); ctx.lineTo(cx - r * .3, cy + r * .45); ctx.fill(); }
    const nb = t.t === 'silver' ? A.num.cp[k] : t.t === 'blue' ? A.num.blue[k] : t.t === 'ramp' ? A.num.ramp[k] : t.t === 'stairs' ? A.num.stairs[k] : null;
    if (nb) badge(nb, X + 2, Y + 2);
    if (st) {
      const done = (t.t === 'silver' && st.cps.has(k)) || (t.t === 'ramp' && st.ramps.has(k)) || (t.t === 'stairs' && st.stairs.has(k)) || (t.bump && st.bumps.has(k));
      if (done) check(ctx, X + s * .8, Y + s * .2, ts * .14, '#1f8a3f');
      const bc = st.blue.get(k);
      if (bc) { ctx.fillStyle = '#fff'; ctx.font = `700 ${ts * .24}px sans-serif`; ctx.fillText('x' + bc, X + s / 2, Y + s / 2); }
      if (st.lastCP && st.lastCP.f === f && st.lastCP.x === x && st.lastCP.y === y) { ctx.strokeStyle = '#1f8a3f'; ctx.lineWidth = 3; ctx.strokeRect(X + 3, Y + 3, s - 6, s - 6); }
    }
    if (o.sel && o.sel.type === 'tile' && o.sel.f === f && o.sel.x === x && o.sel.y === y) { ctx.strokeStyle = '#e8418f'; ctx.lineWidth = 3; ctx.setLineDash([5, 3]); ctx.strokeRect(X + 2, Y + 2, s - 4, s - 4); ctx.setLineDash([]); }
  }
  // pilastri e muri
  ctx.fillStyle = COL.pillar;
  for (let y = 0; y <= m.h; y++) for (let x = 0; x <= m.w; x++) ctx.fillRect(x * ts - g / 2, y * ts - g / 2, g, g);
  for (let y = 0; y <= m.h; y++) for (let x = 0; x < m.w; x++) if (fl.hw[y * m.w + x]) { ctx.fillStyle = A.vLin(f, x, y) ? COL.wall : COL.wallF; ctx.fillRect(x * ts + g / 2, y * ts - g / 2, ts - g, g); }
  for (let y = 0; y < m.h; y++) for (let x = 0; x <= m.w; x++) if (fl.vw[y * (m.w + 1) + x]) { ctx.fillStyle = A.vLin(f, x, y) ? COL.wall : COL.wallF; ctx.fillRect(x * ts - g / 2, y * ts + g / 2, g, ts - g); }
  // vittime
  for (const v of m.victims) {
    if (v.f !== f || (o.hideFake && v.kind === 'fake')) continue;
    const P = victimPos(v, ts, g), sv = st && st.vic[v.id];
    drawVictim(ctx, v, P.sx, P.sy, P.rs);
    ctx.fillStyle = v.kind === 'fake' ? '#9aa1aa' : COL.pink; ctx.beginPath(); ctx.arc(P.lx, P.ly, P.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    const lb = A.label[v.id] || '?';
    ctx.fillStyle = '#fff'; ctx.font = `${P.r * (lb.length > 1 ? 1.05 : 1.5)}px sans-serif`; ctx.fillText(lb, P.lx, P.ly + 1);
    if (sv && sv.id && v.kind !== 'fake') { ctx.strokeStyle = '#1f8a3f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(P.lx, P.ly, P.r + 3, 0, 7); ctx.stroke(); }
    if (sv && sv.kits) { ctx.fillStyle = '#d97706'; for (let i = 0; i < sv.kits; i++) ctx.fillRect(P.sx - P.rs + i * P.rs * 1.05, P.sy + P.rs + 2, P.rs * .8, P.rs * .8); }
    if (o.sel && o.sel.type === 'victim' && o.sel.id === v.id) { ctx.strokeStyle = '#2f6fb3'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(P.lx, P.ly, P.r + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
  // robot
  if (st && st.pos.f === f) {
    const X = st.pos.x * ts + ts / 2, Y = st.pos.y * ts + ts / 2, r = ts * .19;
    ctx.fillStyle = 'rgba(47,111,179,.92)'; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${r}px sans-serif`; ctx.fillText('R', X, Y + 1);
  }
  ctx.restore();
}
// etichetta rosa a ridosso del muro + simbolo della vittima accanto
function victimPos(v, ts, g) {
  const X = v.x * ts, Y = v.y * ts, r = ts * .12, rs = ts * .13, d = g / 2 + r + 1;
  switch (v.side) {
    case 'N': return { lx: X + ts * .7, ly: Y + d, sx: X + ts * .4, sy: Y + d + rs * .5, r, rs };
    case 'S': return { lx: X + ts * .7, ly: Y + ts - d, sx: X + ts * .4, sy: Y + ts - d - rs * .5, r, rs };
    case 'W': return { lx: X + d, ly: Y + ts * .3, sx: X + d + rs * .5, sy: Y + ts * .62, r, rs };
    case 'E': return { lx: X + ts - d, ly: Y + ts * .3, sx: X + ts - d - rs * .5, sy: Y + ts * .62, r, rs };
  }
}
function drawLogs(ctx, x, y, w, h) {
  const lh = h / 3;
  for (let i = 0; i < 3; i++) {
    const yy = y + i * lh, xx = x + (i === 1 ? w * .08 : 0), ww = w * .92;
    ctx.fillStyle = '#a0683a'; roundRect(ctx, xx, yy, ww, lh * .9, lh * .45); ctx.fill();
    ctx.fillStyle = '#d9a46b'; ctx.beginPath(); ctx.ellipse(xx + ww - lh * .35, yy + lh * .45, lh * .3, lh * .4, 0, 0, 7); ctx.fill();
  }
}
function drawVictim(ctx, v, cx, cy, r) {
  if (v.kind === 'cog') {
    const sets = { H: ['#2563eb', '#16a34a', '#facc15', '#facc15', '#16a34a'], S: ['#16a34a', '#facc15', '#facc15', '#facc15', '#facc15'], U: ['#dc2626', '#16a34a', '#facc15', '#facc15', '#facc15'] }[v.status];
    for (let i = 4; i >= 0; i--) { ctx.fillStyle = sets[i]; ctx.beginPath(); ctx.arc(cx, cy, r * (i + 1) / 5, 0, 7); ctx.fill(); }
    ctx.strokeStyle = '#1d2430'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    return;
  }
  ctx.fillStyle = v.kind === 'fake' ? '#c4c9d0' : '#fcd34d'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1d2430'; ctx.lineWidth = Math.max(1, r * .08); ctx.stroke();
  if (v.kind === 'fake') { ctx.fillStyle = '#1d2430'; ctx.font = `700 ${r}px sans-serif`; ctx.fillText('?', cx, cy + 1); return; }
  ctx.fillStyle = '#1d2430';
  ctx.beginPath(); ctx.arc(cx - r * .35, cy - r * .25, r * .11, 0, 7); ctx.arc(cx + r * .35, cy - r * .25, r * .11, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(1, r * .12); ctx.beginPath();
  if (v.status === 'U') ctx.arc(cx, cy + r * .05, r * .45, .15 * Math.PI, .85 * Math.PI);
  else if (v.status === 'H') ctx.arc(cx, cy + r * .65, r * .4, 1.2 * Math.PI, 1.8 * Math.PI);
  else { ctx.moveTo(cx - r * .38, cy + r * .35); ctx.lineTo(cx + r * .38, cy + r * .35); }
  ctx.stroke();
}
function hatch(ctx, X, Y, ts, step) {
  ctx.save(); ctx.beginPath(); ctx.rect(X, Y, ts, ts); ctx.clip();
  for (let d = -ts; d < ts; d += step) { ctx.beginPath(); ctx.moveTo(X + d, Y + ts); ctx.lineTo(X + d + ts, Y); ctx.stroke(); }
  ctx.restore();
}
function check(ctx, x, y, s, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, s * .3); ctx.beginPath(); ctx.moveTo(x - s * .5, y); ctx.lineTo(x - s * .1, y + s * .4); ctx.lineTo(x + s * .55, y - s * .4); ctx.stroke(); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function layoutCanvas(canvas, wrap, m) {
  const avW = wrap.clientWidth - 16, avH = Math.max(320, wrap.clientHeight - 16);
  const ts = Math.max(26, Math.min(90, Math.floor(Math.min(avW / (m.w + .7), avH / (m.h + .7)))));
  const pad = Math.round(ts * .35), cw = m.w * ts + pad * 2, ch = m.h * ts + pad * 2, dpr = window.devicePixelRatio || 1;
  canvas.width = cw * dpr; canvas.height = ch * dpr; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, ts, pad };
}
function hitTest(ev, canvas, geo, m) {
  const r = canvas.getBoundingClientRect();
  const fx = (ev.clientX - r.left - geo.pad) / geo.ts, fy = (ev.clientY - r.top - geo.pad) / geo.ts;
  const x = Math.floor(fx), y = Math.floor(fy);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  const u = fx - x, v = fy - y, d = { N: v, S: 1 - v, W: u, E: 1 - u };
  let side = 'N'; for (const s in d) if (d[s] < d[side]) side = s;
  return { x, y, u, v, side, dist: d[side] };
}

// ================================================================ EDITOR
const TOOLS_MAIN = { wall: ['Muri', '#1f2630'], props: ['Seleziona', '#2f6fb3'], erase: ['Gomma', '#ffffff'], victim: ['Vittima', '#fcd34d'] };
let edGeo = null, drag = null;

function renderEditor() {
  const m = curMap();
  if (ui.floor >= m.floors.length) ui.floor = 0;
  // pannello sinistro
  const tbtn = (id, label, color) => `<button class="tool ${ui.tool === id ? 'active' : ''}" data-act="tool" data-v="${id}"><span class="sw" style="background:${color}"></span>${label}</button>`;
  $('#edLeft').innerHTML = `
    <h3>Strumenti</h3><div class="tools">${Object.entries(TOOLS_MAIN).map(([k, [l, c]]) => tbtn(k, l, c)).join('')}</div>
    <h3>Caselle</h3><div class="tools">${Object.entries(TILE).map(([k, d]) => tbtn(k, d.label.replace(/ \(.*/, ''), d.color)).join('')}</div>
    <h3>Elementi sulla casella</h3><div class="tools">
      ${tbtn('bump', 'Dossi', '#8a5a2b')}${tbtn('obs', 'Ostacolo', '#4b5563')}${tbtn('debris', 'Detriti', '#7d6b58')}${tbtn('danger', 'Zona peric.', '#f4b4b4')}</div>
    <h3>Vittima da posizionare</h3>
    <div class="seg">${Object.entries(VKIND).map(([k, l]) => `<button class="${ui.vkind === k ? 'active' : ''}" data-act="vkind" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="seg" style="margin-top:4px">${Object.entries(VSTAT).map(([k, l]) => `<button class="${ui.vstat === k ? 'active' : ''}" data-act="vstat" data-v="${k}" ${ui.vkind === 'fake' ? 'disabled' : ''}>${l} (${k})</button>`).join('')}</div>
    <h3>Labirinto classico</h3>
    <div class="row"><label>Anelli</label><input type="range" id="genLoops" min="0" max="0.5" step="0.05" value="${ui.genLoops ?? 0.15}" class="grow"></div>
    <div class="row"><label><input type="checkbox" id="genPop" ${ui.genPop === false ? '' : 'checked'}> aggiungi caselle e vittime</label></div>
    <button class="full" data-act="generate">Genera sul piano ${ui.floor + 1}</button>
    <h3>Legenda</h3>
    <div class="muted">Stile scoresheet RCJ: vittime <b>A, B, C…</b> = lineari, <b>α, β, γ…</b> = flottanti (calcolo automatico, modificabile con <b>Seleziona</b>). Caselle menta e muri blu scuro = zona flottante. Smiley: triste = ferita, neutro = stabile, sorriso = illesa.</div>`;
  // piani
  $('#edFloors').innerHTML = m.floors.map((_, i) => `<button class="${i === ui.floor ? 'active' : ''}" data-act="floor" data-v="${i}">Piano ${i + 1}</button>`).join('') +
    `<button data-act="addFloor">+ Piano</button>${m.floors.length > 1 ? `<button class="danger" data-act="delFloor">Elimina piano ${ui.floor + 1}</button>` : ''}`;
  $('#edHint').textContent = {
    wall: 'Clicca vicino al bordo di una casella per aggiungere/togliere un muro. Trascina per disegnare più muri.',
    props: 'Clicca una casella o una vittima per modificarne le proprietà nel pannello a destra.',
    erase: 'Clicca o trascina per riportare le caselle a normali e rimuovere le vittime (i muri restano).',
    victim: 'Clicca vicino al muro dove si trova la vittima. Clicca di nuovo sulla stessa vittima per rimuoverla.',
  }[ui.tool] || (FLAGS[ui.tool] ? `Clicca o trascina per attivare/disattivare: ${FLAGS[ui.tool]}.` : `Clicca o trascina per dipingere caselle: ${TILE[ui.tool]?.label}.`);
  renderEditorRight();
  drawEditor();
}
function renderEditorRight() {
  const m = curMap(), lin = computeLinearity(m), mx = scoreRun(m, maxState(m)), warns = validate(m);
  const count = t => m.floors.reduce((a, fl) => a + fl.tiles.filter(x => x.t === t).length, 0);
  const real = m.victims.filter(v => v.kind !== 'fake');
  $('#edRight').innerHTML = `
    <h3>Labirinto</h3>
    <select class="full" data-chg="pickMap">${maps.map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <div class="row"><input class="grow" data-chg="mapName" value="${esc(m.name)}" placeholder="Nome"></div>
    <div class="row"><label>Larghezza</label><input type="number" id="mw" min="2" max="${MAXSIZE}" value="${m.w}"><label>Altezza</label><input type="number" id="mh" min="2" max="${MAXSIZE}" value="${m.h}"><button data-act="resize">Applica</button></div>
    <div class="row"><button data-act="newMap">Nuovo</button><button data-act="dupMap">Duplica</button><button data-act="png">PNG</button><button data-act="sheet" title="Scoresheet vuoto da stampare">Scoresheet</button><button class="danger" data-act="delMap">Elimina</button></div>
    <h3>Selezione</h3>${selectionHTML(m, lin)}
    <h3>Riepilogo</h3>
    <div class="kv">
      <span>Caselle</span><b>${m.w}×${m.h} × ${m.floors.length} piano/i</b>
      <span>Vittime reali / false</span><b>${real.length} / ${m.victims.length - real.length}</b>
      <span>Lineari / flottanti</span><b>${real.filter(v => isLinear(v, lin)).length} / ${real.filter(v => !isLinear(v, lin)).length}</b>
      <span>Checkpoint · Blu · Nere</span><b>${count('silver')} · ${count('blue')} · ${count('black')}</b>
      <span>Rampe · Scale</span><b>${count('ramp')} · ${count('stairs')}</b>
    </div>
    <h3>Punteggio massimo teorico</h3>
    <div class="kv">${mx.lines.filter(l => l[2]).map(l => `<span>${l[0]}</span><b>${l[2]}</b>`).join('')}<span class="tot">Totale</span><b class="tot">${mx.total}</b></div>
    <h3>Controllo regolamento</h3>
    ${warns.length ? warns.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('') : '<div class="ok">✓ Nessun problema rilevato</div>'}`;
}
function selectionHTML(m, lin) {
  const s = ui.sel;
  if (s && s.type === 'victim') {
    const v = m.victims.find(x => x.id === s.id);
    if (v) return `<div class="muted">Vittima <b>${esc(vlabel(m, v))}</b> · ${tname(v.f, v.x, v.y)} lato ${SIDE[v.side]}</div>
      <div class="row"><label>Tipo</label><select data-chg="vKind">${Object.entries(VKIND).map(([k, l]) => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row"><label>Stato</label><select data-chg="vStat">${Object.entries(VSTAT).map(([k, l]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row"><label>Casella</label><select data-chg="vLin">
        <option value="" ${!v.lin ? 'selected' : ''}>Automatico (${lin[v.id] ? 'lineare' : 'flottante'})</option>
        <option value="L" ${v.lin === 'L' ? 'selected' : ''}>Lineare</option><option value="F" ${v.lin === 'F' ? 'selected' : ''}>Flottante</option></select></div>
      <button class="danger" data-act="delVictim">Elimina vittima</button>`;
  }
  if (s && s.type === 'tile' && s.f < m.floors.length) {
    const t = tileAt(m, s.f, s.x, s.y);
    return `<div class="muted">Casella ${tname(s.f, s.x, s.y)}</div>
      <div class="row"><label>Tipo</label><select data-chg="tType">${Object.entries(TILE).map(([k, d]) => `<option value="${k}" ${t.t === k ? 'selected' : ''}>${d.label}</option>`).join('')}</select></div>
      <div class="row">${Object.entries(FLAGS).map(([k, l]) => `<label><input type="checkbox" data-chg="tFlag" data-v="${k}" ${t[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;
  }
  return '<div class="muted">Usa lo strumento <b>Seleziona</b> e clicca una casella o una vittima.</div>';
}
function drawEditor() {
  const m = curMap();
  edGeo = layoutCanvas($('#edCanvas'), $('#edWrap'), m);
  drawMap(edGeo.ctx, m, ui.floor, edGeo.ts, edGeo.pad, { sel: ui.sel });
}

function edApply(h, first) {
  const m = curMap(), f = ui.floor, t = tileAt(m, f, h.x, h.y), tool = ui.tool;
  const key = tool === 'wall' ? `${h.x},${h.y},${h.side}` : `${h.x},${h.y}`;
  if (!first && drag.last === key) return;
  drag.last = key;
  if (tool === 'wall') {
    if (first) drag.val = !getWall(m, f, h.x, h.y, h.side);
    setWall(m, f, h.x, h.y, h.side, drag.val);
  } else if (TILE[tool]) {
    if (tool === 'start') m.floors.forEach(fl => fl.tiles.forEach(x => { if (x.t === 'start') x.t = 'normal'; }));
    t.t = tool;
  } else if (FLAGS[tool]) {
    if (first) drag.val = !t[tool];
    t[tool] = drag.val;
  } else if (tool === 'erase') {
    Object.assign(t, newTile());
    m.victims = m.victims.filter(v => !(v.f === f && v.x === h.x && v.y === h.y));
  } else if (tool === 'victim') {
    if (!first) return;
    const ex = m.victims.find(v => v.f === f && v.x === h.x && v.y === h.y && v.side === h.side);
    if (ex && ex.kind === ui.vkind && (ex.status === ui.vstat || ex.kind === 'fake')) { m.victims.splice(m.victims.indexOf(ex), 1); ui.sel = null; }
    else if (ex) { ex.kind = ui.vkind; ex.status = ui.vstat; }
    else {
      if (!getWall(m, f, h.x, h.y, h.side)) setWall(m, f, h.x, h.y, h.side, true);
      const v = { id: uid(), f, x: h.x, y: h.y, side: h.side, kind: ui.vkind, status: ui.vkind === 'fake' ? 'U' : ui.vstat, lin: null };
      m.victims.push(v); ui.sel = { type: 'victim', id: v.id };
    }
  } else if (tool === 'props') {
    if (!first) return;
    const v = m.victims.find(v => v.f === f && v.x === h.x && v.y === h.y && v.side === h.side && h.dist < .35);
    ui.sel = v ? { type: 'victim', id: v.id } : { type: 'tile', f, x: h.x, y: h.y };
  }
  m.updated = Date.now();
  saveMapsSoon();
  drawEditor();
}
function setupEditorCanvas() {
  const c = $('#edCanvas');
  c.addEventListener('pointerdown', ev => {
    const h = hitTest(ev, c, edGeo, curMap()); if (!h) return;
    drag = { last: null, val: null }; c.setPointerCapture(ev.pointerId);
    edApply(h, true);
  });
  c.addEventListener('pointermove', ev => {
    if (!drag) return;
    const h = hitTest(ev, c, edGeo, curMap()); if (!h) return;
    if (ui.tool === 'wall' && h.dist > .25) return;
    edApply(h, false);
  });
  const end = () => { if (drag) { drag = null; renderEditorRight(); saveUI(); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}

function resizeMap(m, w, h) {
  w = Math.max(2, Math.min(MAXSIZE, w | 0)); h = Math.max(2, Math.min(MAXSIZE, h | 0));
  const old = clone(m);
  m.floors = old.floors.map((ofl, f) => {
    const fl = newFloor(w, h); fl.hw.fill(false); fl.vw.fill(false);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < old.w && y < old.h) fl.tiles[y * w + x] = ofl.tiles[y * old.w + x];
    for (let y = 0; y <= Math.min(h, old.h); y++) for (let x = 0; x < Math.min(w, old.w); x++) fl.hw[y * w + x] = ofl.hw[y * old.w + x];
    for (let y = 0; y < Math.min(h, old.h); y++) for (let x = 0; x <= Math.min(w, old.w); x++) fl.vw[y * (w + 1) + x] = ofl.vw[y * (old.w + 1) + x];
    perimeter({ w, h }, fl);
    return fl;
  });
  m.w = w; m.h = h;
  m.victims = m.victims.filter(v => v.x < w && v.y < h);
  if (!m.floors.some(fl => fl.tiles.some(t => t.t === 'start'))) m.floors[0].tiles[(h - 1) * w].t = 'start';
}

// ================================================================== RUN
let runGeo = null;
function runElapsed(run) { const c = run.clock; return c.acc + (c.running ? Date.now() - c.since : 0); }
function setClock(run, on) {
  const c = run.clock;
  if (on && !c.running) { c.running = true; c.since = Date.now(); if (!run.startedAt) run.startedAt = Date.now(); }
  if (!on && c.running) { c.acc += Date.now() - c.since; c.running = false; }
}
function addEvents(evs) {
  const run = activeRun(); if (!run) return;
  if (run.status === 'ended') run.edited = true;
  const t = runElapsed(run), g = uid();
  for (const e of evs) run.events.push({ ...e, t, g, at: Date.now() });
  afterRunChange();
}
function undo() {
  const run = activeRun(); if (!run || !run.events.length) return;
  const g = run.events[run.events.length - 1].g;
  const removed = [];
  while (run.events.length && run.events[run.events.length - 1].g === g) removed.push(run.events.pop());
  toast('Annullato: ' + removed.map(e => descEvent(e, run.map)).join(', '));
  afterRunChange();
}
function afterRunChange() {
  const run = activeRun();
  if (run) run.score = scoreRun(run.map, replay(run)).total;
  saveRuns(); renderRun();
}
function robotHere(f, x, y) {
  const run = activeRun(), m = run.map, t = tileAt(m, f, x, y), st = replay(run), k = K(f, x, y);
  if (t.t === 'void') return toast('Casella fuori dal campo');
  if (st.pos.f === f && st.pos.x === x && st.pos.y === y) return toast('Il robot è già su questa casella');
  const evs = [{ type: 'pos', f, x, y }];
  if (t.t === 'silver' && !st.cps.has(k)) evs.push({ type: 'cp', k, on: true });
  if (t.t === 'blue') evs.push({ type: 'blue', k, d: 1 });
  if (t.bump && !st.bumps.has(k)) evs.push({ type: 'bump', k, on: true });
  if (t.t === 'black') evs.push({ type: 'lop', why: 'casella nera' });
  addEvents(evs);
  if (t.t === 'black') toast('Casella nera: Lack of Progress, robot all\'ultimo checkpoint');
}
function moveRobot(dir) {
  const run = activeRun(); if (!run) return;
  const st = replay(run), m = run.map, d = { ArrowUp: ['N', 0, -1], ArrowDown: ['S', 0, 1], ArrowLeft: ['W', -1, 0], ArrowRight: ['E', 1, 0] }[dir];
  const { f, x, y } = st.pos, nx = x + d[1], ny = y + d[2];
  if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) return;
  if (getWall(m, f, x, y, d[0])) return toast('C\'è un muro in quella direzione');
  ui.runFloor = f;
  robotHere(f, nx, ny);
}
function doLoP() { addEvents([{ type: 'lop', why: 'dichiarato' }]); toast('Lack of Progress: robot all\'ultimo checkpoint visitato'); }
function doMisid() { addEvents([{ type: 'misid', d: 1 }]); }
function doExit() {
  const run = activeRun(), st = replay(run);
  if (st.exit) { addEvents([{ type: 'exit', on: false }]); return; }
  const s = st.start;
  if (st.pos.f !== s.f || st.pos.x !== s.x || st.pos.y !== s.y) {
    if (confirm('Il robot non risulta sulla casella di partenza.\nSecondo il regolamento (5.6.14) è una misidentificazione (−5).\n\nOK = registra misidentificazione\nAnnulla = il robot è sulla partenza: assegna l\'exit bonus')) { addEvents([{ type: 'misid', d: 1, why: 'exit fuori partenza' }]); return; }
    addEvents([{ type: 'pos', ...s }, { type: 'exit', on: true }]);
  } else addEvents([{ type: 'exit', on: true }]);
  if (run.status !== 'ended' && confirm('Exit bonus assegnato: la gara termina (5.7.2c). Terminare la prova ora?')) endRun();
}
function endRun() {
  const run = activeRun(); if (!run) return;
  setClock(run, false); run.status = 'ended'; run.endedAt = Date.now();
  afterRunChange();
  toast('Prova terminata e salvata nello storico');
}
function descEvent(e, m) {
  const vic = id => { const v = m.victims.find(x => x.id === id); return v ? vname(m, v) : 'vittima'; };
  switch (e.type) {
    case 'pos': return 'Robot su ' + tname(e.f, e.x, e.y);
    case 'cp': return (e.on ? 'Checkpoint visitato ' : 'Checkpoint annullato ') + tnameK(e.k);
    case 'blue': return (e.d > 0 ? 'Visita casella blu ' : 'Tolta visita casella blu ') + tnameK(e.k);
    case 'bump': return (e.on ? 'Dossi superati ' : 'Dossi annullati ') + tnameK(e.k);
    case 'ramp': return (e.on ? 'Rampa superata ' : 'Rampa annullata ') + tnameK(e.k);
    case 'stairs': return (e.on ? 'Scale superate ' : 'Scale annullate ') + tnameK(e.k);
    case 'vid': return (e.on ? 'Identificata ' : 'Identificazione annullata ') + vic(e.v);
    case 'kit': return `Kit di soccorso: ${e.n} a ${vic(e.v)}`;
    case 'misid': return e.d > 0 ? 'Misidentificazione (-5)' + (e.why ? ' - ' + e.why : '') : 'Misidentificazione annullata';
    case 'lop': return 'Lack of Progress (' + (e.why || 'dichiarato') + ')';
    case 'exit': return e.on ? 'Exit bonus ottenuto' : 'Exit bonus annullato';
    case 'note': return 'Nota: ' + e.text;
  }
  return e.type;
}

function renderRun() {
  const run = activeRun();
  if (!run) return renderRunSetup();
  const m = run.map, st = replay(run), sc = scoreRun(m, st);
  if (ui.runFloor >= m.floors.length) ui.runFloor = 0;
  const ended = run.status === 'ended';
  $('#runLeft').innerHTML = `
    <h3>Prova in corso</h3>
    <div><b>${esc(run.team)}</b> · Round ${esc(run.round)}</div>
    <div class="muted">${esc(run.field || m.name)}${run.field ? ' · ' + esc(m.name) : ''}${run.referee ? ' · Arbitro: ' + esc(run.referee) : ''}</div>
    <div class="muted">${ended ? '<span class="badge end">terminata</span>' + (run.edited ? ' <span class="badge">modificata</span>' : '') : run.clock.running ? '<span class="badge live">● in corso</span>' : '<span class="badge">in pausa</span>'}</div>
    <div class="timer" id="timer"></div><div class="timer-sub" id="timerSub"></div>
    ${ended ? '' : `<button class="big full ${run.clock.running ? '' : 'primary'}" data-act="clock">${run.clock.running ? '⏸ Pausa' : (run.startedAt ? '▶ Riprendi' : '▶ Avvia prova')}</button>`}
    <h3>Azioni rapide</h3>
    <div class="btngrid">
      <button data-act="lop">LoP <span class="muted">(L)</span></button>
      <button data-act="misid">Misid. −5 <span class="muted">(M)</span></button>
      <button data-act="exit" class="${st.exit ? 'on' : ''}">Exit bonus</button>
      <button data-act="undo" ${run.events.length ? '' : 'disabled'}>↶ Annulla</button>
    </div>
    <h3>Note dell'arbitro</h3>
    <textarea rows="3" data-chg="runNotes" placeholder="Annotazioni (vanno nel PDF)">${esc(run.notes || '')}</textarea>
    <h3>Fine prova</h3>
    <div class="stack">
      ${ended ? '' : '<button class="big danger" data-act="endRun">■ Termina prova</button>'}
      <button data-act="runPdf">⬇ PDF di questa prova</button>
      <button data-act="closeRun">${ended ? 'Chiudi e nuova prova' : 'Torna alla configurazione'}</button>
    </div>`;
  $('#runFloors').innerHTML = m.floors.length > 1 ? m.floors.map((_, i) => `<button class="${i === ui.runFloor ? 'active' : ''}" data-act="runFloor" data-v="${i}">Piano ${i + 1}</button>`).join('') : '';
  $('#runRight').innerHTML = `
    <div class="score-big">${sc.total}</div><div class="timer-sub">punti</div>
    <div class="kv">${sc.lines.map(l => `<span title="${esc(l[1])}">${l[0]}<br><span class="muted">${esc(l[1])}</span></span><b>${l[2]}</b>`).join('')}</div>
    <h3>Vittime</h3>
    <div class="kv">${sc.vrows.map(r => `<span><b>${esc(vlabel(m, r.v))}</b> ${r.v.kind === 'fake' ? 'falsa' : (r.v.kind === 'cog' ? 'cogn.' : 'smiley') + ' ' + r.v.status + ' ' + (r.L ? 'L' : 'F')}</span><b>${r.v.kind === 'fake' ? '-' : r.identified ? `✓ ${r.pts}+${r.kitPts}` : '—'}</b>`).join('') || '<span class="muted">nessuna</span>'}</div>
    <h3>Registro eventi (${run.events.length})</h3>
    <div class="log">${run.events.slice().reverse().map(e => `<div><b>${fmtTime(e.t)}</b><span>${esc(descEvent(e, m))}</span></div>`).join('') || '<div class="muted">Nessun evento</div>'}</div>`;
  updateTimer();
  drawRun();
}
function renderRunSetup() {
  const sm = maps.find(x => x.id === ui.setupMap) || curMap();
  ui.setupMap = sm.id;
  const teams = [...new Set(runs.map(r => r.team))];
  const lastRound = Math.max(0, ...runs.map(r => +r.round || 0));
  $('#runLeft').innerHTML = `
    <h3>Nuova prova</h3>
    <div class="stack">
      <label class="muted">Labirinto</label>
      <select data-chg="setupMap">${maps.map(x => `<option value="${x.id}" ${x.id === sm.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <label class="muted">Evento</label><input id="suEvent" value="${esc(ui.eventName || '')}" placeholder="es. Gara Nazionale 2027">
      <label class="muted">Squadra</label>
      <input id="suTeam" list="teamList" value="${esc(ui.lastTeam || '')}" placeholder="Nome squadra"><datalist id="teamList">${teams.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      <label class="muted">Round</label><input id="suRound" type="number" min="1" value="${ui.lastTeam ? Math.max(1, lastRound) : 1}">
      <label class="muted">Campo / Arena</label><input id="suField" value="${esc(ui.lastField || '')}" placeholder="es. Arena 1">
      <label class="muted">Arbitro</label><input id="suRef" value="${esc(ui.lastRef || '')}" placeholder="Nome arbitro">
      <label class="muted">Durata gara (minuti)</label><input id="suDur" type="number" min="1" max="30" value="${ui.lastDur || 8}">
      <button class="big primary" data-act="startRun">Crea prova</button>
    </div>
    <p class="muted">La mappa viene "congelata" nella prova: modifiche successive al labirinto non cambiano le prove già registrate.</p>`;
  $('#runFloors').innerHTML = '';
  const mx = scoreRun(sm, maxState(sm));
  $('#runRight').innerHTML = `<h3>Anteprima</h3><div class="kv"><span>Punteggio massimo teorico</span><b>${mx.total}</b><span>Vittime</span><b>${sm.victims.filter(v => v.kind !== 'fake').length}</b></div>
    <h3>Prove registrate</h3><div class="log">${runs.slice().reverse().slice(0, 12).map(r => `<div><b>${fmtDate(r.createdAt)}</b><span>${esc(r.team)} · R${esc(r.round)} · <b>${r.score ?? 0}</b> pt</span></div>`).join('') || '<div class="muted">Nessuna</div>'}</div>`;
  runGeo = layoutCanvas($('#runCanvas'), $('#runWrap'), sm);
  drawMap(runGeo.ctx, sm, 0, runGeo.ts, runGeo.pad, {});
}
function drawRun() {
  const run = activeRun(); if (!run) return;
  runGeo = layoutCanvas($('#runCanvas'), $('#runWrap'), run.map);
  drawMap(runGeo.ctx, run.map, ui.runFloor, runGeo.ts, runGeo.pad, { st: replay(run) });
}
function updateTimer() {
  const run = activeRun(), el = $('#timer'); if (!run || !el) return;
  const e = runElapsed(run), dur = run.duration * 60000, left = dur - e;
  el.textContent = fmtTime(Math.max(0, left));
  el.classList.toggle('low', left < 60000);
  $('#timerSub').textContent = `trascorsi ${fmtTime(e)} su ${fmtTime(dur)}`;
  if (run.clock.running && left <= 0) {
    setClock(run, false); saveRuns(); renderRun();
    toast('Tempo scaduto (5.7.2a)');
    setTimeout(() => { if (activeRun() === run && run.status !== 'ended' && confirm('Tempo di gara scaduto. Terminare la prova?')) endRun(); }, 50);
  }
}
function openRunPopover(ev, h) {
  const run = activeRun(), m = run.map, f = ui.runFloor, t = tileAt(m, f, h.x, h.y), st = replay(run), k = K(f, h.x, h.y);
  const vics = m.victims.filter(v => v.f === f && v.x === h.x && v.y === h.y);
  const flags = Object.keys(FLAGS).filter(x => t[x]).map(x => FLAGS[x]).join(', ');
  let html = `<h4>${tname(f, h.x, h.y)} · ${TILE[t.t].label}${flags ? ' · ' + flags : ''}</h4><div class="stack">`;
  html += `<button class="primary" data-pv="here">📍 Robot su questa casella</button>`;
  if (t.t === 'silver') html += `<button class="${st.cps.has(k) ? 'on' : ''}" data-pv="cp">Checkpoint visitato (+10)</button>`;
  if (t.t === 'blue') html += `<div class="row"><span>Visite blu: <b>${st.blue.get(k) || 0}</b></span><button data-pv="blue+">+1</button><button data-pv="blue-">−1</button></div>`;
  if (t.bump) html += `<button class="${st.bumps.has(k) ? 'on' : ''}" data-pv="bump">Dossi superati (+5)</button>`;
  if (t.t === 'ramp') html += `<button class="${st.ramps.has(k) ? 'on' : ''}" data-pv="ramp">Rampa superata (+10)</button>`;
  if (t.t === 'stairs') html += `<button class="${st.stairs.has(k) ? 'on' : ''}" data-pv="stairs">Scale superate (+10)</button>`;
  html += '</div>';
  for (const v of vics) {
    const s = st.vic[v.id] || { id: false, kits: 0 };
    html += `<div class="pv-item"><b>${esc(vname(m, v))}</b><div class="stack" style="margin-top:4px">`;
    if (v.kind === 'fake') html += `<button data-pv="fake">Il robot l'ha segnalata → misidentificazione −5</button>`;
    else {
      html += `<button class="${s.id ? 'on' : ''}" data-pv="vid" data-v="${v.id}">${s.id ? '✓ Identificata' : 'Segna identificata'}</button>`;
      html += `<div class="row"><span class="muted">Kit (servono ${KITS[v.status]}):</span>${[0, 1, 2].map(n => `<button class="${(s.kits || 0) === n ? 'on' : ''}" data-pv="kit" data-v="${v.id}" data-n="${n}">${n}</button>`).join('')}</div>`;
    }
    html += '</div></div>';
  }
  const pv = $('#popover');
  pv.innerHTML = html; pv.classList.remove('hidden');
  pv.dataset.k = k;
  const r = pv.getBoundingClientRect();
  pv.style.left = Math.min(ev.clientX + 8, innerWidth - r.width - 8) + 'px';
  pv.style.top = Math.min(ev.clientY + 8, innerHeight - r.height - 8) + 'px';
}
function closePopover() { $('#popover').classList.add('hidden'); }
function popoverAction(btn) {
  const run = activeRun(); if (!run) return;
  const k = $('#popover').dataset.k, [f, x, y] = unK(k), st = replay(run), a = btn.dataset.pv;
  switch (a) {
    case 'here': robotHere(f, x, y); break;
    case 'cp': addEvents([{ type: 'cp', k, on: !st.cps.has(k) }]); break;
    case 'blue+': addEvents([{ type: 'blue', k, d: 1 }]); break;
    case 'blue-': if (st.blue.get(k)) addEvents([{ type: 'blue', k, d: -1 }]); break;
    case 'bump': addEvents([{ type: 'bump', k, on: !st.bumps.has(k) }]); break;
    case 'ramp': addEvents([{ type: 'ramp', k, on: !st.ramps.has(k) }]); break;
    case 'stairs': addEvents([{ type: 'stairs', k, on: !st.stairs.has(k) }]); break;
    case 'fake': addEvents([{ type: 'misid', d: 1, why: 'falsa vittima' }]); break;
    case 'vid': { const s = st.vic[btn.dataset.v]; addEvents([{ type: 'vid', v: btn.dataset.v, on: !(s && s.id) }]); break; }
    case 'kit': {
      const s = st.vic[btn.dataset.v], n = +btn.dataset.n;
      if (n > 0 && !(s && s.id)) toast('Attenzione: i kit valgono solo se la vittima è stata identificata (5.6.4)');
      addEvents([{ type: 'kit', v: btn.dataset.v, n }]); break;
    }
  }
  closePopover();
}
function setupRunCanvas() {
  const c = $('#runCanvas');
  c.addEventListener('click', ev => {
    const run = activeRun(); if (!run || !runGeo) return;
    const h = hitTest(ev, c, runGeo, run.map); if (!h) return closePopover();
    ev.stopPropagation();
    openRunPopover(ev, h);
  });
}

// =============================================================== HISTORY
function filteredRuns() {
  return runs.filter(r => (!ui.histTeam || r.team === ui.histTeam) && (!ui.histMap || r.map.name === ui.histMap))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function ranking(list, drop) {
  const rounds = [...new Set(list.map(r => String(r.round)))].sort((a, b) => a - b || a.localeCompare(b));
  const best = {}, per = {};
  for (const r of list) {
    const rd = String(r.round), sc = r.score || 0;
    best[rd] = Math.max(best[rd] || 0, sc);
    per[r.team] ||= {};
    per[r.team][rd] = Math.max(per[r.team][rd] ?? 0, sc);
  }
  const rows = Object.entries(per).map(([team, rs]) => {
    const norms = rounds.map(rd => best[rd] ? (rs[rd] || 0) / best[rd] : 0);
    const kept = norms.slice().sort((a, b) => b - a).slice(0, Math.max(1, norms.length - drop));
    return { team, scores: rounds.map(rd => rs[rd]), norms, mean: kept.reduce((a, b) => a + b, 0) / kept.length };
  }).sort((a, b) => b.mean - a.mean);
  return { rounds, rows };
}
function teamStats(list) {
  const by = {};
  for (const r of list) (by[r.team] ||= []).push(r);
  return Object.entries(by).map(([team, rs]) => {
    const det = rs.map(r => scoreRun(r.map, replay(r)));
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    return { team, n: rs.length, best: Math.max(...rs.map(r => r.score || 0)), avg: avg(rs.map(r => r.score || 0)),
      svi: avg(det.map(d => d.svi)), lop: avg(det.map(d => d.lop)), exit: det.filter(d => d.exit).length / rs.length,
      time: avg(rs.map(r => r.clock.acc)) };
  }).sort((a, b) => b.best - a.best);
}
function renderHistory() {
  const list = filteredRuns(), teams = [...new Set(runs.map(r => r.team))], mapNames = [...new Set(runs.map(r => r.map.name))];
  const rk = ranking(list, ui.drop), ts = teamStats(list);
  $('#hist').innerHTML = `
    <div class="card"><h2>Storico prove</h2>
      <div class="row">
        <label>Squadra</label><select data-chg="histTeam"><option value="">Tutte</option>${teams.map(t => `<option ${t === ui.histTeam ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <label>Labirinto</label><select data-chg="histMap"><option value="">Tutti</option>${mapNames.map(t => `<option ${t === ui.histMap ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <label>Round peggiori da scartare</label><input type="number" min="0" max="5" value="${ui.drop}" data-chg="drop" style="width:56px">
        <span class="grow"></span>
        <label><input type="checkbox" data-chg="recapDetails" ${ui.recapDetails ? 'checked' : ''}> includi il dettaglio di ogni prova</label>
        <button class="primary big" data-act="recapPdf" ${list.length ? '' : 'disabled'}>⬇ PDF recap di fine gara</button>
      </div>
    </div>
    <div class="card"><h2>Classifica (punteggi normalizzati per round, regola 6.1)</h2>
      ${rk.rows.length ? `<table><tr><th>#</th><th>Squadra</th>${rk.rounds.map(r => `<th class="num">R${esc(r)}</th>`).join('')}<th class="num">Media normalizzata</th></tr>
      ${rk.rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.team)}</b></td>${r.scores.map((s, j) => `<td class="num">${s ?? '-'} <span class="muted">(${r.norms[j].toFixed(2)})</span></td>`).join('')}<td class="num"><b>${r.mean.toFixed(3)}</b></td></tr>`).join('')}</table>` : '<div class="muted">Nessuna prova registrata.</div>'}
    </div>
    <div class="card"><h2>Statistiche per squadra</h2>
      ${ts.length ? `<table><tr><th>Squadra</th><th class="num">Prove</th><th class="num">Migliore</th><th class="num">Media</th><th class="num">Vittime (media)</th><th class="num">LoP (media)</th><th class="num">Exit</th><th class="num">Tempo medio</th></tr>
      ${ts.map(s => `<tr><td><b>${esc(s.team)}</b></td><td class="num">${s.n}</td><td class="num">${s.best}</td><td class="num">${s.avg.toFixed(1)}</td><td class="num">${s.svi.toFixed(1)}</td><td class="num">${s.lop.toFixed(1)}</td><td class="num">${Math.round(s.exit * 100)}%</td><td class="num">${fmtTime(s.time)}</td></tr>`).join('')}</table>` : '<div class="muted">-</div>'}
    </div>
    <div class="card"><h2>Tutte le prove (${list.length})</h2>
      ${list.length ? `<table><tr><th>Data</th><th>Squadra</th><th>Round</th><th>Labirinto</th><th class="num">Punti</th><th class="num">Tempo</th><th>Stato</th><th></th></tr>
      ${list.slice().reverse().map(r => `<tr><td>${fmtDate(r.createdAt)}</td><td>${esc(r.team)}</td><td>${esc(r.round)}</td><td>${esc(r.map.name)}</td><td class="num"><b>${r.score ?? 0}</b></td><td class="num">${fmtTime(r.clock.acc)}</td>
        <td>${r.status === 'ended' ? 'terminata' : '<span class="badge live">aperta</span>'}</td>
        <td style="white-space:nowrap"><button data-act="openRun" data-v="${r.id}">Apri</button> <button data-act="pdfOf" data-v="${r.id}">PDF</button> <button class="danger" data-act="delRun" data-v="${r.id}">✕</button></td></tr>`).join('')}</table>` : '<div class="muted">Crea una prova nella scheda Gara.</div>'}
    </div>`;
}

// ==================================================================== PDF
const PW = 210, PH = 297, MX = 14;
const GREEK = { α: 'alfa', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega' };
const pt = s => String(s ?? '').replace(/[α-ω]/g, c => GREEK[c] || c).replace(/[−–—]/g, '-').replace(/·/g, '.').replace(/[^\x20-\x7E -ÿ]/g, '');
function pdfNew(orientation = 'portrait') {
  if (!window.jspdf) { alert('Libreria PDF non caricata (lib/jspdf.umd.min.js).'); return null; }
  return new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation });
}
function pdfHeader(doc, title, sub) {
  doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(17); doc.text(pt(title), MX, 13);
  doc.setFontSize(9.5); doc.setTextColor(90); doc.text(pt(sub), MX, 19);
  doc.setFontSize(8); doc.text('RoboCupJunior Rescue Maze - regole 2027', PW - MX, 13, { align: 'right' });
  doc.text('Generato il ' + new Date().toLocaleString('it-IT'), PW - MX, 19, { align: 'right' });
  doc.setDrawColor(...rgb('#47682c')); doc.setLineWidth(.6); doc.line(MX, 22, PW - MX, 22);
  doc.setTextColor(25); return 30;
}
function need(doc, y, h) { if (y + h > PH - 14) { doc.addPage('a4', 'portrait'); return 18; } return y; }
function pdfSection(doc, y, label, min = 16) {
  y = need(doc, y, min);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...rgb('#47682c')); doc.text(pt(label), MX, y);
  doc.setDrawColor(...rgb('#47682c')); doc.setLineWidth(.35); doc.line(MX, y + 1.6, PW - MX, y + 1.6); doc.setTextColor(25);
  return y + 7.5;
}
function fit(doc, s, w) { s = pt(s); if (doc.getTextWidth(s) <= w) return s; while (s.length > 1 && doc.getTextWidth(s + '...') > w) s = s.slice(0, -1); return s + '...'; }
function pdfTable(doc, y, cols, rows, o = {}) {
  const fs = o.fs || 8.5, rh = o.rh || 5.8, TW = PW - 2 * MX, sw = cols.reduce((a, c) => a + c.w, 0), ws = cols.map(c => c.w * TW / sw);
  const cell = (s, x, i) => {
    const c = cols[i], str = fit(doc, s, ws[i] - 3);
    if (c.a === 'r') doc.text(str, x + ws[i] - 1.5, y); else if (c.a === 'c') doc.text(str, x + ws[i] / 2, y, { align: 'center' }); else doc.text(str, x + 1.5, y);
  };
  const head = () => {
    doc.setFillColor(...rgb('#e0f4fc')); doc.rect(MX, y - 4.1, TW, rh, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(60, 70, 85);
    let x = MX; cols.forEach((c, i) => { if (c.a === 'r') doc.text(pt(c.h), x + ws[i] - 1.5, y, { align: 'right' }); else cell(c.h, x, i); x += ws[i]; });
    doc.setTextColor(25); doc.setFont('helvetica', 'normal'); y += rh;
  };
  y = need(doc, y, rh * 2 + 4); head();
  rows.forEach((r, ri) => {
    if (y + rh > PH - 14) { doc.addPage('a4', 'portrait'); y = 22; head(); }
    if (ri % 2) { doc.setFillColor(247, 249, 251); doc.rect(MX, y - 4.1, TW, rh, 'F'); }
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    let x = MX; cols.forEach((c, i) => {
      const s = String(r.cells[i] ?? '');
      if (c.a === 'r') doc.text(fit(doc, s, ws[i] - 3), x + ws[i] - 1.5, y, { align: 'right' }); else cell(s, x, i);
      x += ws[i];
    });
    y += rh;
  });
  doc.setFont('helvetica', 'normal');
  return y + 3;
}
function mapImage(m, f, st, o = {}) {
  const ts = o.ts || 44, pad = o.pad ?? 18, c = document.createElement('canvas');
  c.width = m.w * ts + pad * 2; c.height = m.h * ts + pad * 2;
  drawMap(c.getContext('2d'), m, f, ts, pad, { st, noCoords: o.noCoords, hideFake: o.hideFake });
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}
function mapH(m, maxH) { const TW = PW - 2 * MX, w = m.w * 44 + 36, h = m.h * 44 + 36; return Math.min(maxH, h * TW / w); }
function pdfMaps(doc, y, m, st, maxH = 115) {
  for (let f = 0; f < m.floors.length; f++) {
    const img = mapImage(m, f, st), TW = PW - 2 * MX;
    let w = TW, h = img.h * w / img.w;
    if (h > maxH) { h = maxH; w = img.w * h / img.h; }
    y = need(doc, y, h + 8);
    if (m.floors.length > 1) { doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Piano ' + (f + 1), MX, y); y += 2; }
    doc.addImage(img.url, 'PNG', MX + (TW - w) / 2, y, w, h); y += h + 3;
  }
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  const leg = st ? 'Legenda: R = posizione finale del robot; verde = caselle visitate; spunta = checkpoint/rampe/scale/dossi conteggiati; xN = visite casella blu; cerchio verde = vittima identificata; quadratini arancio = kit; riquadro verde = ultimo checkpoint.'
    : 'Legenda: badge blu = numero di checkpoint/casella blu/rampa/scale, cerchio blu = dossi, cerchio rosa = vittima (A, B... lineari; alfa, beta... flottanti), ? = falsa vittima.';
  const lines = doc.splitTextToSize(pt(leg), PW - 2 * MX); doc.text(lines, MX, y + 2); doc.setTextColor(25);
  return y + 4 + lines.length * 3.3;
}
function pdfRunPages(doc, run) {
  const m = run.map, st = replay(run), sc = scoreRun(m, st);
  let y = pdfHeader(doc, `Dettaglio prova - ${run.team}`, `Round ${run.round} . ${m.name} . ${fmtDate(run.startedAt || run.createdAt)}`);
  // box punteggio
  doc.setFillColor(...rgb('#fff8e1')); doc.setDrawColor(...rgb('#f2a2c4')); doc.setLineWidth(.5); doc.roundedRect(PW - MX - 48, y - 4, 48, 30, 3, 3, 'FD');
  doc.setFontSize(9); doc.setTextColor(90); doc.text('PUNTEGGIO', PW - MX - 24, y + 2, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(...rgb('#e8418f')); doc.text(String(sc.total), PW - MX - 24, y + 17, { align: 'center' });
  const mx = scoreRun(m, maxState(m)).total;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90); doc.text(`su ${mx} teorici`, PW - MX - 24, y + 23, { align: 'center' });
  doc.setTextColor(25);
  const info = [['Squadra', run.team], ['Round', run.round], ['Labirinto', m.name], ['Arbitro', run.referee || '-'],
    ['Inizio', fmtDate(run.startedAt)], ['Tempo di gara', `${fmtTime(run.clock.acc)} su ${fmtTime(run.duration * 60000)}`],
    ['Esito', st.exit ? 'Uscito dal labirinto (exit bonus)' : run.status === 'ended' ? 'Terminata' : 'Non terminata'], ['LoP / Misid.', `${st.lop} / ${st.misid}`]];
  doc.setFontSize(9.5);
  info.forEach(([k, v], i) => { const yy = y + i * 5.2; doc.setFont('helvetica', 'bold'); doc.text(pt(k), MX, yy); doc.setFont('helvetica', 'normal'); doc.text(fit(doc, v, 95), MX + 32, yy); });
  y += info.length * 5.2 + 4;
  y = pdfSection(doc, y, 'Calcolo del punteggio');
  y = pdfTable(doc, y, [{ h: 'Voce', w: 32 }, { h: 'Dettaglio', w: 50 }, { h: 'Punti', w: 12, a: 'r' }],
    [...sc.lines.map(l => ({ cells: [l[0], l[1], l[2]] })), { cells: ['TOTALE', '(mai sotto zero)', sc.total], bold: true }]);
  if (m.victims.length) {
    y = pdfSection(doc, y, 'Vittime');
    y = pdfTable(doc, y, [{ h: '#', w: 5 }, { h: 'Posizione', w: 18 }, { h: 'Tipo', w: 18 }, { h: 'Stato', w: 10 }, { h: 'Casella', w: 11 }, { h: 'Identificata', w: 12, a: 'c' }, { h: 'Kit', w: 9, a: 'c' }, { h: 'Punti', w: 9, a: 'r' }],
      sc.vrows.map(r => ({ cells: [vlabel(m, r.v), `${tname(r.v.f, r.v.x, r.v.y)} ${SIDE[r.v.side]}`, VKIND[r.v.kind], r.v.kind === 'fake' ? '-' : VSTAT[r.v.status], r.v.kind === 'fake' ? '-' : r.L ? 'lineare' : 'flottante',
        r.v.kind === 'fake' ? '-' : r.identified ? 'SI' : 'no', r.v.kind === 'fake' ? '-' : `${r.kits}/${KITS[r.v.status]}`, r.pts + r.kitPts] })));
  }
  y = pdfSection(doc, y, 'Mappa e percorso', mapH(m, 115) + 14);
  y = pdfMaps(doc, y, m, st);
  y = pdfSection(doc, y + 2, `Registro eventi (${run.events.length})`);
  y = run.events.length ? pdfTable(doc, y, [{ h: 'Tempo', w: 10 }, { h: 'Evento', w: 90 }], run.events.map(e => ({ cells: [fmtTime(e.t), descEvent(e, m)] })), { fs: 8, rh: 5 })
    : (doc.setFontSize(9), doc.text('Nessun evento registrato.', MX, y), y + 6);
  if (run.notes) {
    y = pdfSection(doc, y, 'Note');
    doc.setFontSize(9); const ls = doc.splitTextToSize(pt(run.notes), PW - 2 * MX);
    y = need(doc, y, ls.length * 4.2); doc.text(ls, MX, y); y += ls.length * 4.2 + 4;
  }
  y = need(doc, y + 6, 22);
  doc.setDrawColor(150); doc.setLineWidth(.2); doc.setFontSize(8.5); doc.setTextColor(90);
  doc.line(MX, y + 12, MX + 70, y + 12); doc.text('Firma arbitro', MX, y + 16);
  doc.line(PW - MX - 70, y + 12, PW - MX, y + 12); doc.text('Firma capitano', PW - MX - 70, y + 16);
  doc.setTextColor(25);
}
// ------------------------------------------------ scoresheet (A4 orizzontale)
const iconCache = {};
function iconURL(key, w, h, draw) {
  if (!iconCache[key]) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; draw(ctx, w, h); iconCache[key] = c.toDataURL('image/png'); }
  return iconCache[key];
}
function pdfIcon(doc, key, x, y, w, h, draw, pw = 200) { doc.addImage(iconURL(key, pw, Math.round(pw * h / w), draw), 'PNG', x, y, w, h, key); }
const ICON = {
  bulb: (c, w, h) => { c.fillStyle = COL.pink; c.beginPath(); c.arc(w / 2, h * .38, w * .3, 0, 7); c.fill(); c.fillRect(w * .36, h * .62, w * .28, h * .2); c.fillStyle = '#fff'; c.fillRect(w * .46, h * .2, w * .08, h * .3); },
  kit: on => (c, w, h) => { const col = on ? COL.pink : '#7a7a7a'; c.fillStyle = col; roundRect(c, w * .05, h * .25, w * .9, h * .7, h * .14); c.fill(); c.strokeStyle = col; c.lineWidth = h * .1; roundRect(c, w * .33, h * .06, w * .34, h * .3, h * .08); c.stroke(); c.fillStyle = '#fff'; c.fillRect(w * .44, h * .38, w * .12, h * .44); c.fillRect(w * .3, h * .54, w * .4, h * .12); },
  cp: (c, w, h) => { const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#f1f3f5'); g.addColorStop(.45, '#9aa3ad'); g.addColorStop(.55, '#b9c0c8'); g.addColorStop(1, '#eef0f3'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.strokeStyle = '#888'; c.lineWidth = 3; c.strokeRect(1, 1, w - 2, h - 2); },
  blue: (c, w, h) => { c.fillStyle = COL.blue; c.fillRect(0, 0, w, h); },
  bump: (c, w, h) => drawLogs(c, w * .05, h * .25, w * .9, h * .5),
  ramp: (c, w, h) => { c.fillStyle = COL.ramp; c.fillRect(0, 0, w, h); c.strokeStyle = '#8a6a10'; c.lineWidth = w * .07; for (const o of [.25, .55]) { c.beginPath(); c.moveTo(w * .2, h * (o + .2)); c.lineTo(w * .5, h * o); c.lineTo(w * .8, h * (o + .2)); c.stroke(); } },
  stairs: (c, w, h) => { c.fillStyle = COL.stairs; c.fillRect(0, 0, w, h); c.strokeStyle = '#8a5a2b'; c.lineWidth = w * .05; for (let j = 1; j < 5; j++) { c.beginPath(); c.moveTo(w * .1, h * j / 5); c.lineTo(w * .9, h * j / 5); c.stroke(); } },
  victim: (v, lb) => (c, w, h) => { drawVictim(c, v, h * .5, h * .5, h * .42); c.fillStyle = '#111'; c.font = `${h * (lb.length > 1 ? .62 : .8)}px Helvetica, Arial, sans-serif`; c.textAlign = 'left'; c.fillText(lb, h * 1.05, h * .54); },
};
function cbox(doc, x, y, s, on) {
  doc.setDrawColor(110); doc.setLineWidth(.2); doc.setFillColor(255, 255, 255); doc.rect(x, y, s, s, 'FD');
  if (on) { doc.setDrawColor(20, 120, 50); doc.setLineWidth(Math.max(.35, s * .16)); doc.line(x + s * .18, y + s * .55, x + s * .42, y + s * .8); doc.line(x + s * .42, y + s * .8, x + s * .86, y + s * .18); }
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function headerBar(doc, x, y, w, h, color, label) { doc.setFillColor(...rgb(color)); doc.rect(x, y, w, h, 'F'); doc.setTextColor(255); doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.text(pt(label), x + w / 2, y + h * .68, { align: 'center' }); doc.setTextColor(0); }
function countBoxes(doc, x, y, w, n, perRow, filled) {
  const s = Math.min(3, (w - 1) / perRow - .5), step = (w - 1) / perRow;
  for (let i = 0; i < n; i++) {
    const cx = x + (i % perRow) * step, cy = y + Math.floor(i / perRow) * (s + 2.6);
    doc.setFontSize(4.5); doc.setTextColor(60); doc.text(String(i + 1), cx + s / 2, cy + 1.3, { align: 'center' });
    cbox(doc, cx, cy + 1.7, s, i < filled);
  }
  doc.setTextColor(0);
}
function cell(doc, x, y, w, h, txt, o = {}) {
  if (o.fill) { doc.setFillColor(...rgb(o.fill)); doc.rect(x, y, w, h, 'F'); }
  doc.setDrawColor(...rgb(o.stroke || '#555555')); doc.setLineWidth(o.lw || .25); doc.rect(x, y, w, h);
  if (txt != null && txt !== '') { doc.setFontSize(o.fs || 10); doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setTextColor(...rgb(o.color || '#000000')); doc.text(fit(doc, txt, w - 2), o.left ? x + 1.5 : x + w / 2, y + h / 2 + (o.fs || 10) * .13, { align: o.left ? 'left' : 'center' }); doc.setTextColor(0); }
}

function pdfScoresheet(doc, m, run) {
  const W = 297, H = 210, A = analyze(m), st = run ? replay(run) : null, sc = run ? scoreRun(m, st) : null;
  const event = (run && run.event) || ui.eventName || 'RoboCupJunior Rescue Maze';
  // titolo + intestazione
  doc.setFont('helvetica', 'normal'); doc.setFontSize(19); doc.setTextColor(0);
  doc.text(fit(doc, event + '  Scoresheet', 200), 148.5, 11.5, { align: 'center' });
  const hx = 10, hy = 15;
  cell(doc, hx, hy, 18, 7, 'Squadra', { fs: 10 }); cell(doc, hx + 18, hy, 130, 7, run ? run.team : '', { fs: 12 });
  cell(doc, hx, hy + 7, 18, 7, 'Orario', { fs: 10 }); cell(doc, hx + 18, hy + 7, 32, 7, run && run.startedAt ? new Date(run.startedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '', { fs: 12 });
  cell(doc, hx + 50, hy + 7, 16, 7, 'Round', { fs: 10 }); cell(doc, hx + 66, hy + 7, 34, 7, run ? 'Round ' + run.round : '', { fs: 12 });
  cell(doc, hx + 100, hy + 7, 14, 7, 'Campo', { fs: 10 }); cell(doc, hx + 114, hy + 7, 34, 7, run ? (run.field || m.name) : m.name, { fs: 10 });
  // mappa
  const bx = 8, by = 32, bw = 150, bh = 172;
  doc.setDrawColor(80); doc.setLineWidth(.3); doc.rect(bx, by, bw, bh);
  const nf = m.floors.length, slot = (bh - 4) / nf;
  for (let f = 0; f < nf; f++) {
    const img = mapImage(m, f, null, { noCoords: true, hideFake: true, ts: 64, pad: 6 });
    const lab = nf > 1 ? 5 : 0, maxW = bw - 4, maxH = slot - lab - 2;
    let w = maxW, h = img.h * w / img.w; if (h > maxH) { h = maxH; w = img.w * h / img.h; }
    const y0 = by + 2 + f * slot;
    if (lab) { doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Piano ' + (f + 1), bx + 3, y0 + 3.5); doc.setFont('helvetica', 'normal'); }
    doc.addImage(img.url, 'PNG', bx + 2 + (maxW - w) / 2, y0 + lab, w, h);
  }
  // colonna destra: elementi
  const RX = 161, RW = 128;
  const real = m.victims.filter(v => v.kind !== 'fake').sort((a, b) => (isLinear(b, A.vicLin) - isLinear(a, A.vicLin)));
  const els = [];
  for (const [kind, src] of [['cp', A.num.cp], ['bump', A.num.bump], ['ramp', A.num.ramp], ['stairs', A.num.stairs]]) for (const k in src) els.push({ kind, k, n: src[k] });
  const blues = Object.entries(A.num.blue).map(([k, n]) => ({ k, n }));
  const rows = (n, per) => Math.ceil(n / per);
  let vh = 11, eh = 10, blh = 10;
  const needH = rows(real.length, 2) * (vh + 1.6) + (els.length ? 2.5 + rows(els.length, 5) * (eh + 1.4) : 0) + (blues.length ? 2.5 + rows(blues.length, 3) * (blh + 1.4) : 0);
  const avail = 124 - 15, k = Math.min(1, avail / Math.max(1, needH)); vh *= k; eh *= k; blh *= k;
  let y = 15;
  // vittime
  const vw = (RW - 2) / 2;
  real.forEach((v, i) => {
    const x = RX + (i % 2) * (vw + 2), yy = y + Math.floor(i / 2) * (vh + 1.6), L = isLinear(v, A.vicLin), lb = A.label[v.id];
    const s = st && st.vic[v.id], need = KITS[v.status];
    doc.setFillColor(...rgb(L ? '#fff8e1' : '#c9f6dd')); doc.setDrawColor(...rgb('#f2a2c4')); doc.setLineWidth(.5); doc.rect(x, yy, vw, vh, 'FD');
    pdfIcon(doc, `v_${v.kind}${v.status}_${lb}`, x + 1, yy + .6, (vh - 1.2) * 2.4, vh - 1.2, ICON.victim(v, lb), 260);
    const sx = x + (vh - 1.2) * 2.4 + 2.5;
    doc.setDrawColor(...rgb('#f2a2c4')); doc.setLineDashPattern([.6, .6], 0); doc.setLineWidth(.25); doc.line(sx - 1, yy + .8, sx - 1, yy + vh - .8); doc.line(sx + vh * .55, yy + .8, sx + vh * .55, yy + vh - .8); doc.setLineDashPattern([], 0);
    pdfIcon(doc, 'bulb', sx + vh * .05, yy + vh * .06, vh * .42, vh * .42, ICON.bulb, 80);
    cbox(doc, sx + vh * .1, yy + vh * .56, vh * .3, !!(s && s.id));
    const kx = sx + vh * .65;
    pdfIcon(doc, need ? 'kit1' : 'kit0', kx, yy + vh * .06, vh * .75, vh * .42, ICON.kit(!!need), 120);
    for (let j = 0; j < need; j++) cbox(doc, kx + j * vh * .4, yy + vh * .56, vh * .3, !!(s && s.id && (s.kits || 0) > j));
    doc.setFontSize(5.2 * Math.min(1, vh / 11)); doc.setTextColor(110);
    [tname(v.f, v.x, v.y), `${v.kind === 'cog' ? 'Target' : 'Smiley'} ${VSTAT[v.status].toLowerCase()}`, L ? 'lineare' : 'flottante']
      .forEach((t, j) => doc.text(pt(t), x + vw - 1, yy + vh * (.24 + j * .27), { align: 'right' }));
    doc.setTextColor(0);
  });
  y += rows(real.length, 2) * (vh + 1.6) + 2.5;
  // checkpoint, dossi, rampe, scale
  const ew = (RW - 4 * 1.5) / 5;
  els.forEach((e, i) => {
    const x = RX + (i % 5) * (ew + 1.5), yy = y + Math.floor(i / 5) * (eh + 1.4);
    doc.setFillColor(...rgb('#e0f4fc')); doc.setDrawColor(...rgb('#8fd0ef')); doc.setLineWidth(.4); doc.rect(x, yy, ew, eh, 'FD');
    pdfIcon(doc, 'el_' + e.kind, x + .8, yy + .8, eh - 1.6, eh - 1.6, ICON[e.kind], 100);
    doc.setFontSize(eh * 1.9); doc.text(String(e.n), x + eh + 2.6, yy + eh * .74, { align: 'center' });
    doc.setDrawColor(...rgb('#8fd0ef')); doc.setLineDashPattern([.6, .6], 0); doc.line(x + ew - 5.2, yy + .6, x + ew - 5.2, yy + eh - .6); doc.setLineDashPattern([], 0);
    doc.setFontSize(3.6); doc.setTextColor(90); doc.text('Successo', x + ew - 2.6, yy + 1.9, { align: 'center' }); doc.setTextColor(0);
    const done = st && (e.kind === 'cp' ? st.cps : e.kind === 'bump' ? st.bumps : e.kind === 'ramp' ? st.ramps : st.stairs).has(e.k);
    cbox(doc, x + ew - 4.1, yy + eh * .38, 3, !!done);
  });
  if (els.length) y += rows(els.length, 5) * (eh + 1.4) + 2.5;
  // caselle blu
  const bw3 = (RW - 2 * 1.5) / 3;
  blues.forEach((b, i) => {
    const x = RX + (i % 3) * (bw3 + 1.5), yy = y + Math.floor(i / 3) * (blh + 1.4), visits = st ? (st.blue.get(b.k) || 0) : 0;
    doc.setFillColor(...rgb('#e0f4fc')); doc.setDrawColor(...rgb('#8fd0ef')); doc.setLineWidth(.4); doc.rect(x, yy, bw3, blh, 'FD');
    pdfIcon(doc, 'el_blue', x + .8, yy + .8, blh - 1.6, blh - 1.6, ICON.blue, 60);
    doc.setFontSize(blh * 1.9); doc.text(String(b.n), x + blh + 2.4, yy + blh * .74, { align: 'center' });
    const cx = x + blh + 5.5, s = Math.min(2.3, blh * .24);
    for (let j = 0; j < 10; j++) {
      const xx = cx + (j % 5) * (s + .9), yy2 = yy + (j < 5 ? blh * .2 : blh * .62);
      doc.setFontSize(3.2); doc.setTextColor(90); doc.text(String(j + 1), xx + s / 2, yy2 - .3, { align: 'center' }); doc.setTextColor(0);
      cbox(doc, xx, yy2, s, j < visits);
    }
    const tx = x + bw3 - 8;
    doc.setFontSize(3.6); doc.setTextColor(90); doc.text('Visite totali', tx + 4, yy + 2, { align: 'center' }); doc.setTextColor(0);
    if (st) { doc.setFontSize(9); doc.text(String(visits), tx + 4, yy + blh * .75, { align: 'center' }); }
  });
  // misidentificazioni / LoP
  const yb = 127;
  doc.setDrawColor(60); doc.setLineWidth(.3); doc.rect(RX, yb, 63, 19);
  headerBar(doc, RX, yb, 63, 6, '#a8668a', 'Misidentificazioni');
  doc.setFontSize(5.5); doc.text('Conteggio', RX + 27, yb + 8.2, { align: 'center' });
  countBoxes(doc, RX + 1, yb + 9.2, 53, 15, 15, st ? st.misid : 0);
  cell(doc, RX + 54, yb + 6, 9, 13, null, { stroke: '#d9363e', lw: .5 }); doc.setFontSize(5); doc.text('Totale', RX + 58.5, yb + 8.2, { align: 'center' });
  if (st) { doc.setFontSize(11); doc.text(String(st.misid), RX + 58.5, yb + 15.5, { align: 'center' }); }
  const LX = RX + 65;
  doc.setDrawColor(60); doc.setLineWidth(.3); doc.rect(LX, yb, 63, 19);
  headerBar(doc, LX, yb, 63, 6, '#b59a2a', 'LoP');
  countBoxes(doc, LX + 1, yb + 6.4, 53, 30, 15, st ? st.lop : 0);
  cell(doc, LX + 54, yb + 6, 9, 13, null, { stroke: '#d9363e', lw: .5 }); doc.setFontSize(5); doc.text('Totale', LX + 58.5, yb + 8.2, { align: 'center' });
  if (st) { doc.setFontSize(11); doc.text(String(st.lop), LX + 58.5, yb + 15.5, { align: 'center' }); }
  // tempo / exit
  const ty = 149, acc = run ? run.clock.acc : null;
  cell(doc, RX, ty, 18, 7, 'Tempo', { fs: 10 });
  cell(doc, RX + 18, ty, 45, 7, null, { stroke: '#d9363e', lw: .5 });
  doc.setFontSize(10); doc.setTextColor(150); doc.text('min', RX + 34, ty + 4.8, { align: 'right' }); doc.text('sec', RX + 58, ty + 4.8, { align: 'right' }); doc.setTextColor(0);
  if (run) { doc.setFontSize(12); doc.text(String(Math.floor(acc / 60000)), RX + 27, ty + 5, { align: 'right' }); doc.text(String(Math.floor(acc / 1000) % 60).padStart(2, '0'), RX + 51, ty + 5, { align: 'right' }); }
  cell(doc, RX, ty + 7, 18, 7, 'Exit bonus', { fs: 9 });
  cell(doc, RX + 18, ty + 7, 9, 7, null); cbox(doc, RX + 20.5, ty + 8.6, 3.8, !!(st && st.exit));
  cell(doc, RX + 27, ty + 7, 36, 7, null, { fill: '#e6e6e6' });
  doc.setFontSize(4.6); doc.text(doc.splitTextToSize('Il robot torna alla partenza e accende la luce di identificazione per 5 s.', 34), RX + 45, ty + 9.4, { align: 'center' });
  // memo
  const my = 165;
  doc.setDrawColor(...rgb('#47682c')); doc.setLineWidth(.7); doc.rect(RX, my, 63, 31);
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...rgb('#47682c')); doc.text('Memo / Commenti', RX + 31.5, my + 4.5, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
  if (run && run.notes) { doc.setFontSize(7.5); doc.text(doc.splitTextToSize(pt(run.notes), 59).slice(0, 10), RX + 2, my + 9); }
  // firme
  const sy = 149;
  doc.setDrawColor(...rgb('#47682c')); doc.setLineWidth(.7); doc.rect(LX, sy, 63, 47);
  headerBar(doc, LX, sy, 63, 7, '#47682c', 'Firme');
  doc.setFontSize(4.8); doc.setTextColor(60); doc.text(doc.splitTextToSize('Firmando, la squadra accetta i dati registrati e rinuncia a contestarli in un secondo momento.', 60), LX + 31.5, sy + 9.3, { align: 'center' }); doc.setTextColor(0);
  doc.setLineWidth(.25); doc.setDrawColor(120);
  [['Capitano', run ? '' : ''], ['Segnapunti', ''], ['Arbitro', run ? run.referee || '' : '']].forEach(([l, v], i) => {
    const yy = sy + 13 + i * 11.3;
    doc.line(LX, yy, LX + 63, yy); doc.line(LX + 22, yy, LX + 22, yy + 11.3);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...rgb('#47682c')); doc.text(l, LX + 11, yy + 6.8, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
    if (v) { doc.setFontSize(7); doc.setTextColor(120); doc.text(fit(doc, v, 39), LX + 24, yy + 3); doc.setTextColor(0); }
  });
  // uso ufficio
  const oy = 196.5;
  cell(doc, RX, oy, 13, 8, 'Ufficio', { fs: 8 });
  [['Inserito da', run ? 'RCJ Maze Configurator' : ''], ['Verificato da', ''], ['Punteggio', sc ? String(sc.total) : '']].forEach(([l, v], i) => {
    const x = RX + 13 + i * 38.3;
    cell(doc, x, oy, 38.3, 3.4, l, { fs: 7 }); cell(doc, x, oy + 3.4, 38.3, 4.6, v, { fs: i === 2 ? 10 : 7, bold: i === 2 });
  });
  doc.setFontSize(6.5); doc.setTextColor(100);
  doc.text(pt(`Generato con RCJ Maze Configurator il ${new Date().toLocaleString('it-IT')} . punteggi secondo le regole RCJ Rescue Maze 2027 . Labirinto: ${m.name}`), 8, 207.5);
  doc.setTextColor(0);
}
function sheetPdf(m) {
  if (!window.jspdf) return alert('Libreria PDF non caricata (lib/jspdf.umd.min.js).');
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  pdfScoresheet(doc, m, null);
  doc.save(`scoresheet_${fileSafe(m.name)}.pdf`);
}

function pdfFooter(doc) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5); doc.setTextColor(130);
    if (w > h) doc.text(`Pagina ${i} di ${n}`, w - 8, h - 2.5, { align: 'right' });
    else { doc.text(`Pagina ${i} di ${n}`, w - MX, h - 7, { align: 'right' }); doc.text('RCJ Maze Configurator', MX, h - 7); }
  }
  doc.setTextColor(0);
}
const fileSafe = s => pt(s).replace(/[^\w.-]+/g, '_').slice(0, 40);
function runPdf(run) {
  const doc = pdfNew('landscape'); if (!doc) return;
  pdfScoresheet(doc, run.map, run); doc.addPage('a4', 'portrait'); pdfRunPages(doc, run); pdfFooter(doc);
  doc.save(`prova_${fileSafe(run.team)}_R${fileSafe(run.round)}_${new Date(run.createdAt).toISOString().slice(0, 10)}.pdf`);
}
function recapPdf() {
  const list = filteredRuns(); if (!list.length) return;
  const doc = pdfNew(); if (!doc) return;
  const rk = ranking(list, ui.drop), ts = teamStats(list);
  const sub = [ui.histTeam && 'Squadra: ' + ui.histTeam, ui.histMap && 'Labirinto: ' + ui.histMap].filter(Boolean).join(' . ') || 'Tutte le squadre e tutti i labirinti';
  let y = pdfHeader(doc, 'Recap di fine gara', `${list.length} prove . ${sub}`);
  const d0 = Math.min(...list.map(r => r.createdAt)), d1 = Math.max(...list.map(r => r.createdAt));
  doc.setFontSize(9.5); doc.text(pt(`Periodo: ${fmtDate(d0)} - ${fmtDate(d1)}   .   Squadre: ${ts.length}   .   Round: ${rk.rounds.length}   .   Round peggiori scartati: ${ui.drop}`), MX, y); y += 8;
  y = pdfSection(doc, y, 'Classifica');
  const rcols = Math.min(rk.rounds.length, 8);
  y = pdfTable(doc, y, [{ h: '#', w: 4 }, { h: 'Squadra', w: 24 }, ...rk.rounds.slice(0, rcols).map(r => ({ h: 'R' + r, w: 9, a: 'r' })), { h: 'Media norm.', w: 12, a: 'r' }],
    rk.rows.map((r, i) => ({ cells: [i + 1, r.team, ...r.scores.slice(0, rcols).map((s, j) => s == null ? '-' : `${s} (${r.norms[j].toFixed(2)})`), r.mean.toFixed(3)], bold: i === 0 })));
  doc.setFontSize(7.5); doc.setTextColor(100); y = need(doc, y, 8);
  doc.text(pt('Punteggio normalizzato = punteggio / miglior punteggio del round (6.1.2). La media esclude i round peggiori indicati (6.1.3).'), MX, y); doc.setTextColor(25); y += 7;
  y = pdfSection(doc, y, 'Statistiche per squadra');
  y = pdfTable(doc, y, [{ h: 'Squadra', w: 24 }, { h: 'Prove', w: 8, a: 'r' }, { h: 'Migliore', w: 10, a: 'r' }, { h: 'Media', w: 10, a: 'r' }, { h: 'Vittime', w: 10, a: 'r' }, { h: 'LoP', w: 8, a: 'r' }, { h: 'Exit', w: 8, a: 'r' }, { h: 'Tempo medio', w: 12, a: 'r' }],
    ts.map(s => ({ cells: [s.team, s.n, s.best, s.avg.toFixed(1), s.svi.toFixed(1), s.lop.toFixed(1), Math.round(s.exit * 100) + '%', fmtTime(s.time)] })));
  y = pdfSection(doc, y, 'Elenco prove');
  y = pdfTable(doc, y, [{ h: 'Data', w: 14 }, { h: 'Squadra', w: 20 }, { h: 'Rd', w: 5, a: 'c' }, { h: 'Labirinto', w: 22 }, { h: 'Vitt.', w: 6, a: 'r' }, { h: 'Kit', w: 5, a: 'r' }, { h: 'LoP', w: 5, a: 'r' }, { h: 'Exit', w: 6, a: 'c' }, { h: 'Tempo', w: 8, a: 'r' }, { h: 'Punti', w: 8, a: 'r' }],
    list.map(r => { const s = scoreRun(r.map, replay(r)); return { cells: [fmtDate(r.createdAt), r.team, r.round, r.map.name, s.svi, s.srd, s.lop, s.exit ? 'SI' : '-', fmtTime(r.clock.acc), s.total] }; }), { fs: 8 });
  const usedMaps = [...new Map(list.map(r => [r.map.id + r.map.updated, r.map])).values()];
  for (const m of usedMaps.slice(0, 6)) {
    y = pdfSection(doc, y + 2, 'Labirinto: ' + m.name, mapH(m, 95) + 14);
    y = pdfMaps(doc, y, m, null, 95);
  }
  if (ui.recapDetails) for (const r of list) { doc.addPage('a4', 'landscape'); pdfScoresheet(doc, r.map, r); doc.addPage('a4', 'portrait'); pdfRunPages(doc, r); }
  pdfFooter(doc);
  doc.save(`recap_gara_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ============================================================ wiring / UI
function setTab(t) {
  ui.tab = t; saveUI(); closePopover();
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  renderAll();
}
function renderAll() {
  if (ui.tab === 'editor') renderEditor();
  else if (ui.tab === 'run') renderRun();
  else renderHistory();
}
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const ACTIONS = {
  tool: v => { ui.tool = v; if (v === 'victim' || v === 'props') { } renderEditor(); saveUI(); },
  vkind: v => { ui.vkind = v; ui.tool = 'victim'; renderEditor(); saveUI(); },
  vstat: v => { ui.vstat = v; ui.tool = 'victim'; renderEditor(); saveUI(); },
  floor: v => { ui.floor = +v; ui.sel = null; renderEditor(); },
  addFloor: () => { const m = curMap(); m.floors.push(newFloor(m.w, m.h)); ui.floor = m.floors.length - 1; saveMaps(); renderEditor(); },
  delFloor: () => {
    const m = curMap(); if (m.floors.length < 2 || !confirm(`Eliminare il piano ${ui.floor + 1}?`)) return;
    const f = ui.floor; m.floors.splice(f, 1);
    m.victims = m.victims.filter(v => v.f !== f).map(v => (v.f > f ? { ...v, f: v.f - 1 } : v));
    ui.floor = 0; ui.sel = null; saveMaps(); renderEditor();
  },
  generate: () => {
    const m = curMap();
    if (!confirm(`Generare un nuovo labirinto sul piano ${ui.floor + 1}? Muri, caselle e vittime di questo piano verranno sostituiti.`)) return;
    ui.genLoops = +$('#genLoops').value; ui.genPop = $('#genPop').checked;
    generateMaze(m, ui.floor, ui.genLoops, ui.genPop); ui.sel = null; m.updated = Date.now(); saveMaps(); saveUI(); renderEditor();
  },
  resize: () => { const m = curMap(); resizeMap(m, +$('#mw').value, +$('#mh').value); ui.sel = null; m.updated = Date.now(); saveMaps(); renderEditor(); },
  newMap: () => {
    const name = prompt('Nome del nuovo labirinto:', 'Campo ' + (maps.length + 1)); if (name == null) return;
    const size = prompt('Dimensioni (larghezza x altezza, in caselle):', '8x6'); if (size == null) return;
    const [w, h] = size.toLowerCase().split(/[x×*, ]+/).map(n => Math.max(2, Math.min(MAXSIZE, parseInt(n) || 6)));
    const m = newMap(name || 'Senza nome', w, h || w); maps.push(m); ui.mapId = m.id; ui.floor = 0; ui.sel = null; saveMaps(); saveUI(); renderEditor();
  },
  dupMap: () => { const m = clone(curMap()); m.id = uid(); m.name += ' (copia)'; m.victims.forEach(v => v.id = uid()); maps.push(m); ui.mapId = m.id; saveMaps(); renderEditor(); },
  delMap: () => {
    if (maps.length < 2) return toast('Deve rimanere almeno un labirinto');
    if (!confirm(`Eliminare il labirinto "${curMap().name}"? Le prove già registrate restano nello storico.`)) return;
    maps = maps.filter(m => m.id !== ui.mapId); ui.mapId = maps[0].id; ui.sel = null; saveMaps(); saveUI(); renderEditor();
  },
  sheet: () => sheetPdf(curMap()),
  png: () => {
    const m = curMap(), img = mapImage(m, ui.floor, null), a = document.createElement('a');
    a.href = img.url; a.download = fileSafe(m.name) + `_piano${ui.floor + 1}.png`; a.click();
  },
  delVictim: () => { const m = curMap(); m.victims = m.victims.filter(v => v.id !== ui.sel?.id); ui.sel = null; saveMaps(); renderEditor(); },
  // gara
  startRun: () => {
    const team = $('#suTeam').value.trim(); if (!team) { toast('Inserisci il nome della squadra'); $('#suTeam').focus(); return; }
    const sm = maps.find(x => x.id === ui.setupMap) || curMap();
    ui.eventName = $('#suEvent').value.trim(); ui.lastField = $('#suField').value.trim();
    const run = { id: uid(), event: ui.eventName, field: ui.lastField, team, round: $('#suRound').value || '1', referee: $('#suRef').value.trim(), duration: Math.max(1, +$('#suDur').value || 8),
      map: clone(sm), events: [], notes: '', status: 'open', createdAt: Date.now(), startedAt: null, endedAt: null, clock: { running: false, since: 0, acc: 0 }, score: 0 };
    ui.lastTeam = team; ui.lastRef = run.referee; ui.lastDur = run.duration;
    runs.push(run); ui.activeRun = run.id; ui.runFloor = startPos(run.map).f; saveRuns(); saveUI(); renderRun();
  },
  clock: () => { const run = activeRun(); setClock(run, !run.clock.running); saveRuns(); renderRun(); },
  lop: doLoP, misid: doMisid, exit: doExit, undo,
  endRun: () => { if (confirm('Terminare la prova? Potrai comunque correggerla dallo storico.')) endRun(); },
  runPdf: () => runPdf(activeRun()),
  closeRun: () => { const run = activeRun(); if (run && run.clock.running) setClock(run, false); saveRuns(); ui.activeRun = null; saveUI(); renderRun(); },
  runFloor: v => { ui.runFloor = +v; drawRun(); renderRun(); },
  // storico
  openRun: id => { const cur = activeRun(); if (cur && cur.clock.running) setClock(cur, false); ui.activeRun = id; ui.runFloor = 0; saveRuns(); setTab('run'); },
  pdfOf: id => runPdf(runs.find(r => r.id === id)),
  delRun: id => { const r = runs.find(x => x.id === id); if (!confirm(`Eliminare la prova di ${r.team} (round ${r.round})?`)) return; runs = runs.filter(x => x.id !== id); if (ui.activeRun === id) ui.activeRun = null; saveRuns(); saveUI(); renderHistory(); },
  recapPdf,
  exportAll: () => download(`rcj_maze_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'rcj-maze-configurator', version: 1, maps, runs }, null, 1)),
};
const CHANGES = {
  pickMap: v => { ui.mapId = v; ui.floor = 0; ui.sel = null; saveUI(); renderEditor(); },
  mapName: v => { curMap().name = v.trim() || 'Senza nome'; saveMaps(); renderEditor(); },
  vKind: v => { const m = curMap(), x = m.victims.find(q => q.id === ui.sel.id); x.kind = v; saveMaps(); renderEditor(); },
  vStat: v => { const m = curMap(), x = m.victims.find(q => q.id === ui.sel.id); x.status = v; saveMaps(); renderEditor(); },
  vLin: v => { const m = curMap(), x = m.victims.find(q => q.id === ui.sel.id); x.lin = v || null; saveMaps(); renderEditor(); },
  tType: v => { const m = curMap(), s = ui.sel; if (v === 'start') m.floors.forEach(fl => fl.tiles.forEach(t => { if (t.t === 'start') t.t = 'normal'; })); tileAt(m, s.f, s.x, s.y).t = v; saveMaps(); renderEditor(); },
  tFlag: (v, el) => { const m = curMap(), s = ui.sel; tileAt(m, s.f, s.x, s.y)[el.dataset.v] = el.checked; saveMaps(); renderEditor(); },
  setupMap: v => { ui.setupMap = v; saveUI(); renderRun(); },
  runNotes: v => { const r = activeRun(); r.notes = v; saveRuns(); },
  histTeam: v => { ui.histTeam = v; saveUI(); renderHistory(); },
  histMap: v => { ui.histMap = v; saveUI(); renderHistory(); },
  drop: v => { ui.drop = Math.max(0, +v || 0); saveUI(); renderHistory(); },
  recapDetails: (v, el) => { ui.recapDetails = el.checked; saveUI(); },
};

document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-tab]'); if (tab) return setTab(tab.dataset.tab);
  const pv = ev.target.closest('[data-pv]'); if (pv) return popoverAction(pv);
  const a = ev.target.closest('[data-act]');
  if (a && !a.disabled && ACTIONS[a.dataset.act]) { ACTIONS[a.dataset.act](a.dataset.v); return; }
  if (!ev.target.closest('#popover')) closePopover();
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-chg]'); if (el && CHANGES[el.dataset.chg]) CHANGES[el.dataset.chg](el.value, el);
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') return closePopover();
  if (ui.tab !== 'run' || !activeRun() || ev.target.matches('input,textarea,select')) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); return undo(); }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key.startsWith('Arrow')) { ev.preventDefault(); closePopover(); return moveRobot(ev.key); }
  if (ev.key === 'l' || ev.key === 'L') return doLoP();
  if (ev.key === 'm' || ev.key === 'M') return doMisid();
  if (ev.key === ' ' && activeRun().status !== 'ended') { ev.preventDefault(); return ACTIONS.clock(); }
});
$('#fileImport').addEventListener('change', async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.maps) || !Array.isArray(data.runs)) throw new Error('formato non riconosciuto');
    let nm = 0, nr = 0;
    for (const m of data.maps) { const i = maps.findIndex(x => x.id === m.id); if (i >= 0) maps[i] = m; else { maps.push(m); nm++; } }
    for (const r of data.runs) { const i = runs.findIndex(x => x.id === r.id); if (i >= 0) runs[i] = r; else { runs.push(r); nr++; } }
    saveMaps(); saveRuns(); renderAll();
    toast(`Importati ${nm} labirinti e ${nr} prove nuove (gli esistenti sono stati aggiornati)`);
  } catch (e) { alert('Importazione non riuscita: ' + e.message); }
});
window.addEventListener('resize', () => { if (ui.tab === 'editor') drawEditor(); else if (ui.tab === 'run') activeRun() ? drawRun() : renderRunSetup(); });
window.addEventListener('beforeunload', () => { saveMaps(); saveRuns(); saveUI(); });
setInterval(() => { if (ui.tab === 'run' && activeRun()?.clock.running) updateTimer(); }, 250);

setupEditorCanvas();
setupRunCanvas();
saveMaps();
setTab(ui.tab || 'editor');
