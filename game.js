(() => {
'use strict';

/* =====================================================================
   VÔLEI ARCADE — vista de cima, 2x2.
   Mundo em metros: x (comprimento 0..16), y (largura 0..8), z (altura).
   A rede fica em x = 8. A bola cresce com a altura (z) e a sombra
   fica no chão, marcando onde ela está de verdade.
   ===================================================================== */

const W = 1280, H = 720, PPM = 56;
const COURT_W = 16, COURT_H = 8, NET_X = 8, NET_H = 2.43;
const OX = (W - COURT_W * PPM) / 2, OY = 154;
const CX = OX + COURT_W * PPM / 2, CY = OY + COURT_H * PPM / 2;
const G = 13, PAR = 0.011, BR = 0.2, TAU = Math.PI * 2;
const DT = 1 / 120;
const DIVE_T = 0.36;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const sx = (x, z = 0) => { const p = OX + x * PPM; return p + (p - CX) * z * PAR; };
const sy = (y, z = 0) => { const p = OY + y * PPM; return p + (p - CY) * z * PAR; };
const zs = z => 1 + z * 0.2;                       // escala por altura

/* ============================== ESTADO ============================== */
const DIFF = {
  facil:   { spd: 0.78, react: 0.45, scat: 2.3, blk: 0.1, dive: 0.4, smart: 0.15 },
  normal:  { spd: 0.92, react: 0.27, scat: 1.35, blk: 0.3, dive: 0.7, smart: 0.5 },
  dificil: { spd: 1.05, react: 0.14, scat: 0.9, blk: 0.5, dive: 1.0, smart: 0.9 },
};
const S = {
  ui: 'menu',            // menu | play | over
  state: 'serve',        // serve | rally | point
  mode: 0,               // 0 demo, 1 solo, 2 dois jogadores
  diff: 'normal', target: 11, theme: 'praia', size: 2,
  score: [0, 0], serving: 0, serverP: null,
  t: 0, hitstop: 0, shake: 0, pointT: 0, serveWait: 1, netWob: 0,
  toast: null, over: false, paused: false, rally: 0, winner: -1,
};
// Online: o anfitrião simula tudo e manda "fotos" do jogo; o convidado só desenha e manda os comandos.
const ON = {
  on: false, host: false, guest: false, lobby: false, peer: null, conn: null, code: '', ev: [], tick: 0,
  conns: new Map(), roster: [], myId: 0, myTeam: 0, nextId: 1, inputs: {}, cfg: null,
};
const emit = (...a) => { if (ON.on && ON.host) ON.ev.push(a); };
let teams = [];
let allPlayers = [];
const plans = [{ t: 0, seq: -1, roles: [null, null] }, { t: 0, seq: -1, roles: [null, null] }];

const ball = {
  x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, rot: 0, state: 'held',
  lastTeam: -1, lastPlayer: null, touches: 0, cool: 0, seq: 0,
  wob: 0, phase: 0, fromServe: false, lastKind: '', blocked: false, trail: [],
};

/* ============================== ENTRADA ============================= */
const keys = new Set(), edgeDown = new Set(), edgeUp = new Set();
// Celular: joystick virtual (analógico) + botões que viram "teclas" T* nas listas de controles
let IS_TOUCH = false;
try { IS_TOUCH = matchMedia('(pointer: coarse)').matches || /[?&]touch=1/.test(location.search); } catch (e) { /* ok */ }
const touchMove = { on: false, x: 0, y: 0 };
const TOUCH_LABEL = { pochete: 'P', set: 'L', spike: 'C' };
const GAMEKEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'NumpadEnter', 'NumpadDecimal', 'ShiftLeft', 'ShiftRight',
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => 'Numpad' + n)]);
const held = a => a.some(k => keys.has(k));
const edge = a => a.some(k => edgeDown.has(k));

// Ações no teclado numérico; WASD/setas continuam valendo para andar.
const CTRL_SOLO = {
  up: ['Numpad8', 'KeyW', 'ArrowUp'], down: ['Numpad5', 'KeyS', 'ArrowDown'], left: ['Numpad4', 'KeyA', 'ArrowLeft'], right: ['Numpad6', 'KeyD', 'ArrowRight'],
  pochete: ['Numpad1', 'KeyJ', 'TP'], set: ['Numpad2', 'KeyK', 'TL'], spike: ['Numpad3', 'KeyL', 'TC'],
  jump: ['Numpad0', 'Space', 'TJ'], dive: ['NumpadDecimal', 'NumpadEnter', 'ShiftLeft', 'ShiftRight', 'KeyV', 'TD'], label: { pochete: '1', set: '2', spike: '3' }, touch: true,
};
const CTRL_P1 = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  pochete: ['KeyF', 'TP'], set: ['KeyG', 'TL'], spike: ['KeyH', 'TC'],
  jump: ['Space', 'TJ'], dive: ['ShiftLeft', 'TD'], label: { pochete: 'F', set: 'G', spike: 'H' }, touch: true,
};
const CTRL_P2 = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  pochete: ['Numpad1'], set: ['Numpad2'], spike: ['Numpad3'],
  jump: ['Numpad0'], dive: ['NumpadDecimal', 'NumpadEnter', 'ShiftRight'], label: { pochete: '1', set: '2', spike: '3' },
};

addEventListener('keydown', e => {
  if (GAMEKEYS.has(e.code) && S.ui === 'play') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code); edgeDown.add(e.code);
  audioInit();
  globalKey(e);
});
addEventListener('keyup', e => { keys.delete(e.code); edgeUp.add(e.code); });
addEventListener('blur', () => { keys.clear(); touchMove.on = false; });
addEventListener('pointerdown', audioInit);

function globalKey(e) {
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (!$('online').classList.contains('hidden')) return;
  if (S.ui === 'menu' && !$('help').classList.contains('hidden')) { if (e.code === 'Escape' || e.code === 'Enter') toggleHelp(false); return; }
  if (S.ui === 'menu' && (e.code === 'Enter' || e.code === 'NumpadEnter')) { beginGame(); return; }
  if (S.ui === 'play' && !ON.on && (e.code === 'Escape' || e.code === 'KeyP')) setPause(!S.paused);
  if (S.ui === 'over' && e.code === 'KeyR') beginGame();
}

function blankInput() { return { mx: 0, my: 0, pochete: false, set: false, spike: false, jump: false, dive: false, hold: null, holds: {}, aim: null }; }

function readHuman(p) {
  const c = p.ctrl, i = p.input;
  i.mx = (held(c.right) ? 1 : 0) - (held(c.left) ? 1 : 0);
  i.my = (held(c.down) ? 1 : 0) - (held(c.up) ? 1 : 0);
  if (i.mx && i.my) { i.mx *= 0.7071; i.my *= 0.7071; }
  if (c.touch && touchMove.on) { i.mx = touchMove.x; i.my = touchMove.y; }
  i.pochete = edge(c.pochete); i.set = edge(c.set); i.spike = edge(c.spike);
  i.jump = edge(c.jump); i.dive = edge(c.dive);
  i.holds = { pochete: held(c.pochete), set: held(c.set), spike: held(c.spike) };
  i.hold = i.holds.spike ? 'spike' : i.holds.set ? 'set' : i.holds.pochete ? 'pochete' : null;
  i.aim = null;
}

/* ============================== ÁUDIO =============================== */
let AC = null, master = null, noiseBuf = null, muted = false;
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => {}); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.45; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol = 0.3, lp = 2000, delay = 0) {
  if (!AC || muted) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = lp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5, dur + 0.05);
}
function sfx(n) {
  emit('s', n);
  switch (n) {
    case 'bump':  tone(190, 70, 0.14, 'sine', 0.55); noise(0.07, 0.25, 900); break;
    case 'set':   tone(520, 330, 0.09, 'triangle', 0.3); noise(0.04, 0.12, 3500); break;
    case 'spike': tone(260, 55, 0.22, 'sine', 0.6); noise(0.13, 0.5, 5000); break;
    case 'block': tone(320, 140, 0.16, 'square', 0.25); noise(0.1, 0.4, 2500); break;
    case 'net':   noise(0.18, 0.3, 700); tone(90, 60, 0.12, 'sine', 0.3); break;
    case 'bounce': tone(130, 90, 0.09, 'sine', 0.35); break;
    case 'jump':  tone(220, 440, 0.12, 'sine', 0.12); break;
    case 'dive':  noise(0.22, 0.3, 1500); break;
    case 'toss':  tone(300, 700, 0.18, 'sine', 0.15); break;
    case 'whistle': tone(2300, 2300, 0.4, 'square', 0.1); tone(2650, 2650, 0.35, 'square', 0.08, 0.05); break;
    case 'point': [523, 659, 784].forEach((f, k) => tone(f, f, 0.16, 'square', 0.12, k * 0.09)); break;
    case 'fault': tone(220, 140, 0.3, 'sawtooth', 0.15); break;
  }
}

/* ============================== EFEITOS ============================= */
const parts = [], rings = [], floats = [];
function puff(x, y, n, col = 'rgba(230,205,150,', spd = 1.4) {
  if (parts.length > 260) return;
  if (n >= 3) emit('p', x, y, n);
  for (let k = 0; k < n; k++) {
    const a = rand(0, TAU), v = rand(0.3, 1) * spd;
    parts.push({ x, y, z: 0.05, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(0.5, 2), life: rand(0.35, 0.7), max: 0.7, col, size: rand(2, 5) });
  }
}
function ring(x, y, z, col, max = 40) { emit('r', x, y, z, col, max); rings.push({ x, y, z, r: 6, max, life: 0.3, t: 0, col }); }
function floatText(x, y, z, text, col = '#fff', size = 20) { emit('f', x, y, z, text, col, size); floats.push({ x, y, z, text, col, size, t: 0, life: 0.9 }); }
function toast(text, sub, col = '#ffd23f') { emit('t', text, sub, col); S.toast = { text, sub, col, t: 0 }; }

/* ============================== JOGADORES =========================== */
const PALS = [
  { shirt: '#ff6a1f', trim: '#fff1d6', short: '#22305c', skin: '#e8b48a', hair: '#2b1a10' },
  { shirt: '#ff6a1f', trim: '#fff1d6', short: '#22305c', skin: '#b97c52', hair: '#111111' },
  { shirt: '#1f8bff', trim: '#e6f4ff', short: '#f4f4f4', skin: '#f1c9a5', hair: '#d9a441' },
  { shirt: '#1f8bff', trim: '#e6f4ff', short: '#f4f4f4', skin: '#8a5a3a', hair: '#1a1209' },
];

const SKINS = ['#e8b48a', '#b97c52', '#f1c9a5', '#8a5a3a', '#d49a6a'], HAIRS = ['#2b1a10', '#111111', '#d9a441', '#1a1209', '#6b3a1e'];
const palFor = (team, idx) => idx < 2 ? PALS[team * 2 + idx] : { ...PALS[team * 2 + (idx % 2)], skin: SKINS[(idx + team * 2) % 5], hair: HAIRS[(idx * 2 + team) % 5] };

function mkPlayer(team, idx) {
  return {
    team, idx, pal: palFor(team, idx),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: team ? -1 : 1, fy: 0,
    state: 'idle', diveT: 0, dvx: 1, dvy: 0, recT: 0, jumpCd: 0, diveCd: 0, diveHit: false,
    intent: null, human: false, local: false, remote: false, ctrl: null, input: blankInput(),
    anim: Math.random() * 6, hitT: 0, hitKind: '', lockCd: 0, serve: null, errx: 0, erry: 0,
  };
}
const teammates = p => teams[p.team].players.filter(q => q !== p);
// quem recebe o passe: companheiro mais perto da posição de levantador
function setterOf(p) {
  const T = teammates(p); if (!T.length) return p;
  const sx0 = NET_X - (p.team ? -1 : 1) * 2.2;
  return T.reduce((a, q) => Math.hypot(q.x - sx0, q.y - 4) < Math.hypot(a.x - sx0, a.y - 4) ? q : a);
}
// quem ataca: companheiro da rede mais distante de quem levanta
function attackerFor(p) {
  const T = teammates(p); if (!T.length) return p;
  const front = T.filter(q => Math.abs(q.x - NET_X) < 3.8), pool = front.length ? front : T;
  return pool.reduce((a, q) => Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(a.x - p.x, a.y - p.y) ? q : a);
}
// posições-base (distância da rede, y) para equipes de 3 a 6 jogadores
const SLOTS = {
  3: [[1.3, 4], [5.5, 2], [5.5, 6]],
  4: [[1.3, 2.4], [1.3, 5.6], [5.5, 2.4], [5.5, 5.6]],
  5: [[1.3, 1.4], [1.3, 4], [1.3, 6.6], [5.5, 2.6], [5.5, 5.4]],
  6: [[1.3, 1.4], [1.3, 4], [1.3, 6.6], [5.5, 1.4], [5.5, 4], [5.5, 6.6]],
};
// Rodízio (P1..P6): quem está na posição 0 saca; a cada side-out todos avançam uma posição.
// Cada item lista os índices de SLOTS na ordem P1, P2, P3, P4, P5, P6 (P1 = fundo à direita).
const CYC = { 3: [2, 0, 1], 4: [3, 1, 0, 2], 5: [4, 2, 1, 0, 3], 6: [5, 2, 1, 0, 3, 4] };
const slotIdx = (tm, k) => CYC[S.size][(k + teams[tm].rot) % S.size];
const isFrontP = p => S.size >= 3 && SLOTS[S.size][slotIdx(p.team, p.idx)][0] < 3;
const slotPos = (tm, k, N, dy = 0) => {
  const [d, y] = SLOTS[N][slotIdx(tm, k)], yy = tm ? COURT_H - y : y;
  return { x: NET_X - (tm ? -1 : 1) * d, y: clamp(yy + dy, 0.6, 7.4) };
};
const pickServer = tm => { const T = teams[tm], N = S.size; if (N >= 3) T.serverIdx = (N - T.rot) % N; };
const maxT = () => S.size === 1 ? 2 : 3;     // toques por time: 2 com 1 jogador, 3 com 2 a 6
const sideOf = x => x < NET_X ? 0 : 1;
const teamName = tm => ON.on ? (tm === ON.myTeam ? 'SEU TIME' : (teams[tm] && teams[tm].players.some(q => q.human) ? 'RIVAIS' : 'CPU')) : S.mode === 1 ? (tm ? 'CPU' : 'VOCÊ') : S.mode === 2 ? (tm ? 'JOGADOR 2' : 'JOGADOR 1') : (tm ? 'TIME B' : 'TIME A');

function startMatch(mode, humans) {
  S.mode = mode; S.score = [0, 0]; S.over = false; S.winner = -1; S.serving = 0; S.rally = 0;
  teams = [0, 1].map(tm => ({ players: Array.from({ length: S.size }, (_, k) => mkPlayer(tm, k)), serverIdx: 0, rot: 0 }));
  allPlayers = teams.flatMap(t => t.players);
  if (humans) {                       // online: cada pessoa ocupa uma vaga numa equipe
    for (const h of humans) {
      const q = teams[h.team] && teams[h.team].players[h.idx]; if (!q) continue;
      q.human = true; q.netId = h.id; q.name = h.name; q.ctrl = CTRL_SOLO;
      q.local = h.id === ON.myId; q.remote = !q.local;
    }
  } else {
    if (mode >= 1) { const h = teams[0].players[0]; h.human = h.local = true; h.ctrl = mode === 1 ? CTRL_SOLO : CTRL_P1; }
    if (mode === 2) { const h = teams[1].players[0]; h.human = h.local = true; h.ctrl = CTRL_P2; }
  }
  S.rotated = false;
  parts.length = 0; rings.length = 0; floats.length = 0; S.toast = null;
  startServe();
}

// onde cada jogador deve estar para o próximo saque
function homeFor(p) {
  const tm = p.team, s = tm ? -1 : 1, T = teams[tm], N = S.size;
  if (S.serving === tm && p.idx === T.serverIdx) return { x: tm ? 16.9 : -0.9, y: 4 };
  if (N >= 3) return slotPos(tm, p.idx, N);
  if (S.serving === tm) return { x: NET_X - s * 2.3, y: 5.6 };
  return { x: NET_X - s * 5, y: N === 1 ? 4 : p.idx ? 5.6 : 2.4 };
}

function startServe() {
  const sv = S.serving;
  for (const p of allPlayers) {
    const h = homeFor(p);
    p.z = 0; p.vx = p.vy = p.vz = 0; p.state = 'idle'; p.recT = 0; p.diveT = 0; p.intent = null; p.serve = null;
    p.fx = p.team ? -1 : 1; p.fy = 0; p.hitT = 0; p.x = h.x; p.y = h.y;
  }
  S.serverP = teams[sv].players[teams[sv].serverIdx];
  S.serverP.serve = { key: null, power: 0, ty: 4, stage: 'idle', mode: null, jumpT: 0, aiWait: 0 };
  const aw = S.mode === 0 ? rand(0.7, 1.3) : rand(0.9, 1.8);
  S.serveWait = aw;
  Object.assign(ball, { state: 'held', z: 1, lastTeam: -1, lastPlayer: null, touches: 0, cool: 0, wob: 0, fromServe: false, lastKind: '', blocked: false, vx: 0, vy: 0, vz: 0, trail: [] });
  ball.seq++;
  S.state = 'serve';
  plans.forEach(pl => { pl.t = 0; pl.roles = []; });
  if (S.mode > 0) toast('SAQUE', teamName(sv) + (S.rotated ? ' · RODÍZIO ↻' : ''), '#7fd6ff');
  S.rotated = false;
}

/* ============================== FÍSICA DA BOLA ====================== */
function clearsNet(b, v, m = 0.14) {
  if (Math.abs(v.vx) < 1e-3) return true;
  const tc = (NET_X - b.x) / v.vx;
  if (tc <= 0 || tc >= v.T) return true;
  return b.z + v.vz * tc - 0.5 * G * tc * tc > NET_H + m;
}
function solveLob(b, tx, ty, apex, zt) {
  let v, a = apex;
  for (let k = 0; k < 14; k++) {
    const top = Math.max(b.z, zt) + a, vz = Math.sqrt(2 * G * (top - b.z));
    const T = (vz + Math.sqrt(vz * vz + 2 * G * (b.z - zt))) / G;
    v = { vx: (tx - b.x) / T, vy: (ty - b.y) / T, vz, T };
    if (clearsNet(b, v, 0.3)) return v;
    a += 0.45;
  }
  return v;
}
function solveFast(b, tx, ty, sh, zt) {
  const dist = Math.hypot(tx - b.x, ty - b.y) || 0.01;
  let v;
  for (let s = sh; s >= 6.5; s -= 0.7) {
    const T = Math.max(0.12, dist / s), vz = (zt - b.z + 0.5 * G * T * T) / T;
    v = { vx: (tx - b.x) / T, vy: (ty - b.y) / T, vz, T };
    if (clearsNet(b, v, 0.14)) return v;
  }
  return v;
}
function predictAt(h) {
  const b = ball, disc = b.vz * b.vz + 2 * G * (b.z - h);
  if (disc < 0) return null;
  let t = (b.vz + Math.sqrt(disc)) / G;
  if (t < 0) return null;
  let x = b.x + b.vx * t, y = b.y + b.vy * t;
  if (b.vx !== 0) {
    const tc = (NET_X - b.x) / b.vx;
    if (tc > 0 && tc < t && b.z + b.vz * tc - 0.5 * G * tc * tc < NET_H) { x = NET_X - Math.sign(b.vx) * 0.5; y = b.y + b.vy * tc; t = tc + 0.3; }
  }
  return { x, y, t };
}
const speedAt = pr => Math.hypot(ball.vx, ball.vy, ball.vz - G * pr.t);

function updateBall(dt) {
  const b = ball;
  b.cool = Math.max(0, b.cool - dt);
  if (b.state === 'held') {
    const p = S.serverP;
    b.x = p.x + p.fx * 0.32; b.y = p.y + p.fy * 0.32; b.z = 1.0; b.vx = b.vy = b.vz = 0;
    return;
  }
  if (b.wob > 0) {
    const sp = Math.hypot(b.vx, b.vy) || 1, a = Math.sin(S.t * 13 + b.phase) * b.wob;
    b.vx += (-b.vy / sp) * a * dt; b.vy += (b.vx / sp) * a * dt;
  }
  const px = b.x;
  b.x += b.vx * dt; b.y += b.vy * dt; b.vz -= G * dt; b.z += b.vz * dt;
  b.rot += (b.vx * 0.6 + b.vy * 0.35) * dt;

  if (b.state === 'live' && (px - NET_X) * (b.x - NET_X) < 0) {
    if (b.y < -0.1 || b.y > 8.1) {
      if (b.lastTeam >= 0) { b.state = 'dead'; pointWon(1 - b.lastTeam, 'ANTENA!'); sfx('fault'); }
    } else if (b.z < NET_H) {
      const side = px < NET_X ? -1 : 1;
      S.netWob = Math.min(1, S.netWob + Math.abs(b.vx) / 12);
      b.x = NET_X + side * 0.07; b.vx = -b.vx * 0.22; b.vy *= 0.6; b.vz = Math.max(b.vz * 0.4, -1.5);
      b.seq++; sfx('net'); ring(NET_X, b.y, b.z, '#fff', 30);
    }
  }
  if (b.z <= 0) {
    b.z = 0;
    if (b.state === 'live') onLand();
    if (Math.abs(b.vz) > 1.3) {
      b.vz = -b.vz * 0.52; b.vx *= 0.78; b.vy *= 0.78; sfx('bounce');
      if (S.theme === 'praia') puff(b.x, b.y, 4, 'rgba(230,205,150,', 1);
    } else {
      b.vz = 0; const f = Math.pow(0.12, dt); b.vx *= f; b.vy *= f;
    }
  }
  if (Math.hypot(b.vx, b.vy, b.vz) > 12) { b.trail.push({ x: b.x, y: b.y, z: b.z }); if (b.trail.length > 7) b.trail.shift(); }
  else if (b.trail.length) b.trail.shift();
}

function onLand() {
  const b = ball;
  const inC = b.x >= -0.1 && b.x <= 16.1 && b.y >= -0.1 && b.y <= 8.1;
  let loser, tag = '';
  if (!inC) { loser = b.lastTeam >= 0 ? b.lastTeam : S.serving; tag = 'FORA!'; }
  else loser = b.x < NET_X ? 0 : 1;
  const w = 1 - loser;
  if (inC) {
    if (b.fromServe && b.lastTeam === w && b.touches === 1) tag = 'ACE!';
    else if (b.blocked && b.lastTeam === w && b.touches === 0) tag = 'BLOQUEIO!';
    else if (b.lastKind === 'spike' && b.lastTeam === w) tag = 'CORTADA!';
    else tag = 'PONTO!';
  }
  ring(b.x, b.y, 0, inC ? '#ffffff' : '#ff5a5a', 60);
  puff(b.x, b.y, 10, 'rgba(240,215,160,', 2.2);
  b.state = 'dead';
  pointWon(w, tag);
}

/* ============================== PLACAR / FLUXO ====================== */
function pointWon(w, tag) {
  if (S.state === 'point') return;
  S.score[w]++;
  S.state = 'point';
  const [a, c] = S.score, T = S.target;
  S.over = S.mode > 0 && (((a >= T || c >= T) && Math.abs(a - c) >= 2) || a >= T + 4 || c >= T + 4);
  S.pointT = S.over ? 2.6 : 2.0;
  if (S.over) S.winner = a > c ? 0 : 1;
  if (w !== S.serving) {
    S.serving = w;
    const T2 = teams[w], N = S.size;
    if (N >= 3) { T2.rot = (T2.rot - 1 + N) % N; pickServer(w); S.rotated = true; }
    else if (N === 2) T2.serverIdx = 1 - T2.serverIdx;
  }
  if (S.mode > 0) {
    toast(tag, teamName(w) + ' marca', w === 0 ? '#ffb15a' : '#6cc4ff');
    sfx(tag === 'FORA!' || tag === 'ANTENA!' || tag === '4 TOQUES!' ? 'fault' : 'point'); sfx('whistle');
  }
}

function registerTouch(p, isBlock) {
  const b = ball;
  b.seq++; S.rally++;
  if (isBlock) { b.lastTeam = p.team; b.touches = 0; b.lastPlayer = null; b.blocked = true; b.fromServe = false; return; }
  b.blocked = false; b.fromServe = false;
  if (b.lastTeam !== p.team) b.touches = 1; else b.touches++;
  b.lastTeam = p.team; b.lastPlayer = p;
  if (b.touches > maxT()) { b.state = 'dead'; pointWon(1 - p.team, '4 TOQUES!'); }
}

/* ============================== GOLPES ============================== */
const HIT = {
  pochete: { apex: 2.2, zt: 2.4, sc: 0.6, name: 'POCHETE' },
  set:     { apex: 1.8, zt: 2.6, sc: 0.25, name: 'LEVANTADA' },
  tip:     { apex: 0.9, zt: 0,   sc: 0.45, name: 'LARGADA' },
  dive:    { apex: 3.0, zt: 2.4, sc: 1.2,  name: 'PEIXINHO!' },
  spike:   { fast: 1, sc: 0.55, name: 'CORTADA!' },
};
const passSpot = p => ({ x: NET_X - (p.team ? -1 : 1) * (S.size === 1 ? 1.9 : 2.5), y: clamp(setterOf(p).y, 0.8, 7.2) });
const setSpot  = p => ({ x: NET_X - (p.team ? -1 : 1) * 1.4, y: clamp(attackerFor(p).y, 0.6, 7.4) });

function reach(p, kind) {
  const b = ball, d = Math.hypot(b.x - p.x, b.y - p.y), rz = b.z - p.z;
  switch (kind) {
    case 'pochete': return d < 1.2 && rz > -0.15 && rz < 1.6;
    case 'set':     return d < 1.05 && rz > 0.9 && rz < 2.6;
    case 'tip':     return d < 1.2 && rz > 1.5 && rz < 3.0;
    case 'spike':   return p.z > 0.15 && d < 1.35 && rz > 1.5 && rz < 3.0;
    case 'dive':    return d < 1.9 && rz < 1.1 && rz > -0.2;
  }
  return false;
}
function canTouch(p) {
  const b = ball;
  if (b.state !== 'live') return false;
  if (S.size >= 2 && b.lastPlayer === p && b.lastTeam === p.team && b.touches > 0) return 'lock';
  if (b.cool > 0 && b.lastTeam === p.team) return false;
  return true;
}

function tryIntent(p) {
  const t = p.intent.type;
  let kind = null;
  if (t === 'pochete' && reach(p, 'pochete')) kind = 'pochete';
  else if (t === 'set') { if (p.z > 0.3 ? reach(p, 'tip') : reach(p, 'set')) kind = p.z > 0.3 ? 'tip' : 'set'; }
  else if (t === 'spike' && reach(p, 'spike')) kind = 'spike';
  if (!kind) return;
  const ok = canTouch(p);
  if (ok === 'lock') { if (p.lockCd <= 0) { p.lockCd = 0.8; floatText(p.x, p.y, 1.8, 'JÁ TOCOU', '#ff8a8a', 15); } return; }
  if (!ok) return;
  doHit(p, kind); p.intent = null;
}
function tryDive(p) {
  if (p.diveHit || !reach(p, 'dive')) return;
  const ok = canTouch(p);
  if (ok !== true) return;
  p.diveHit = true; doHit(p, 'dive');
}

function doHit(p, kind) {
  const b = ball, s = p.team ? -1 : 1, i = p.input, cfg = HIT[kind];
  const d = Math.hypot(b.x - p.x, b.y - p.y), R = kind === 'dive' ? 1.9 : 1.25;
  let sc = cfg.sc + (d / R) * 0.9;
  if (!p.human) {                       // bola rápida é mais difícil de controlar para a IA
    const inSp = b.lastTeam !== p.team ? Math.hypot(b.vx, b.vy, b.vz) : 0;
    sc = (sc + Math.max(0, inSp - 10) * 0.14) * DIFF[S.diff].scat * (1 + S.rally * 0.04);   // rallies longos cansam a IA
  }
  const ah = Math.hypot(i.mx, i.my) > 0.25, fwd = i.mx * s;
  let tgt;
  if (i.aim) tgt = { x: i.aim.x, y: i.aim.y };
  else if (kind === 'spike') tgt = { x: NET_X + s * (4.8 + 3.0 * (ah ? fwd : 0)), y: clamp(p.y + (ah ? i.my * 4.5 : 0), 0.5, 7.5) };
  else if (kind === 'tip') tgt = { x: NET_X + s * (1.5 + (ah ? fwd * 0.9 : 0)), y: clamp(p.y + (ah ? i.my * 3 : 0), 0.6, 7.4) };
  else if (ah) { const L = kind === 'set' ? 4.5 : 6.8; tgt = { x: p.x + i.mx * L, y: p.y + i.my * L }; }
  else tgt = kind === 'set' ? setSpot(p) : passSpot(p);

  const a = rand(0, TAU), r = Math.sqrt(Math.random()) * sc;
  tgt.x = clamp(tgt.x + Math.cos(a) * r, -2.5, 18.5); tgt.y = clamp(tgt.y + Math.sin(a) * r, -1.8, 9.8);

  let v;
  if (cfg.fast) v = solveFast(b, tgt.x, tgt.y, 15 + clamp(p.z / 0.95, 0, 1) * 5, 0);
  else {
    const across = (tgt.x - NET_X) * (b.x - NET_X) < 0;
    v = solveLob(b, tgt.x, tgt.y, cfg.apex, across ? 0 : cfg.zt);
  }
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.wob = 0; b.cool = 0.12; b.lastKind = kind;
  registerTouch(p, false);
  p.hitT = 0.3; p.hitKind = kind;
  ring(b.x, b.y, b.z, kind === 'spike' ? '#ff6a3d' : kind === 'set' ? '#ffd23f' : '#7fd6ff', kind === 'spike' ? 60 : 40);
  if (kind === 'spike') { S.hitstop = 0.05; S.shake = 7; sfx('spike'); }
  else if (kind === 'set' || kind === 'tip') sfx('set'); else sfx('bump');
  if (kind === 'dive') { puff(p.x, p.y, 8, 'rgba(230,205,150,', 2); }
  if (p.human || kind === 'spike' || kind === 'dive') floatText(p.x, p.y, 2.4, cfg.name, kind === 'spike' ? '#ff9a6a' : '#fff', kind === 'spike' ? 24 : 17);
}

function tryBlock(p) {
  const b = ball, s = p.team ? -1 : 1;
  if (b.lastTeam === p.team || b.lastTeam < 0 || b.state !== 'live') return;
  if (b.fromServe) return;
  if (Math.abs(p.x - NET_X) > 1.7) return;
  if (Math.hypot(b.x - p.x, b.y - p.y) > 1.1) return;
  const rz = b.z - p.z;
  if (rz < 1.5 || rz > 3.1) return;
  if (b.vx * s > -3) return;                         // só bloqueia bola vindo forte
  if (b.lastKind === 'block') return;                // bola já bloqueada não é bloqueada de novo
  const sp = Math.hypot(b.vx, b.vy, b.vz), onMine = (b.x - NET_X) * s < 0;
  b.vx = s * (4.5 + sp * 0.2); b.vy = b.vy * 0.3 + rand(-1, 1);
  b.vz = onMine ? -(1.0 + sp * 0.07) : -(3.5 + sp * 0.12);
  b.wob = 0; b.cool = 0.05; b.lastKind = 'block';
  registerTouch(p, true);
  p.hitT = 0.3; p.hitKind = 'block';
  S.hitstop = 0.05; S.shake = 6; sfx('block'); ring(b.x, b.y, b.z, '#ffffff', 55);
  floatText(p.x, p.y, 3.2, 'BLOQUEIO!', '#ffffff', 24);
}

/* ============================== SAQUE =============================== */
function serverLogic(p) {
  const i = p.input, sv = p.serve;
  if (sv.stage === 'toss') {
    if (sv.jumpT > 0) { sv.jumpT -= DT; if (sv.jumpT <= 0) startJump(p, true); }
    if (ball.vz <= 0) serveHit(p);
    return;
  }
  if (p.human) {
    if (!sv.key) {
      if (i.hold) { sv.key = i.hold; sv.power = 0; sv.ty = clamp(p.y, 0.5, 7.5); }
    } else {
      sv.power = Math.min(1.15, sv.power + DT / 1.1);
      sv.ty = clamp(sv.ty + i.my * 3.4 * DT, 0.5, 7.5);
      if (!i.holds[sv.key]) performServe(p, sv.key, sv.power, sv.ty);
    }
  } else {
    sv.aiWait += DT;
    if (sv.aiWait >= S.serveWait) {
      const D = DIFF[S.diff], r = Math.random();
      const mode = S.diff === 'facil' ? (r < 0.7 ? 'pochete' : 'set') : S.diff === 'normal' ? (r < 0.2 ? 'pochete' : r < 0.75 ? 'set' : 'spike') : (r < 0.1 ? 'pochete' : r < 0.45 ? 'set' : 'spike');
      let pw = mode === 'pochete' ? rand(0.55, 0.95) : rand(0.6, 0.97);
      if (S.diff === 'facil') pw += rand(-0.15, 0.2);
      performServe(p, mode, pw, rand(0.8, 7.2));
    }
  }
}
function performServe(p, key, power, ty) {
  const sv = p.serve, s = p.team ? -1 : 1;
  sv.mode = key === 'pochete' ? 'under' : key === 'set' ? 'float' : 'jump';
  sv.power = power;
  const scat = sv.mode === 'under' ? 0.3 : 0.45 + Math.max(0, power - 0.9) * 2.5;
  const a = rand(0, TAU), r = Math.sqrt(Math.random()) * scat * (p.human ? 1 : DIFF[S.diff].scat);
  sv.tx = NET_X + s * (0.9 + clamp(power, 0, 1.15) * 6.9) + Math.cos(a) * r;
  sv.ty2 = ty + Math.sin(a) * r;
  if (sv.mode === 'under') { ball.z = 0.9; serveHit(p); return; }
  sv.stage = 'toss';
  ball.state = 'toss'; ball.vx = ball.vy = 0; ball.vz = sv.mode === 'float' ? 6.0 : 7.2;
  sv.jumpT = sv.mode === 'jump' ? 0.12 : 0;
  sfx('toss');
}
function serveHit(p) {
  const sv = p.serve, b = ball, s = p.team ? -1 : 1;
  let v;
  if (sv.mode === 'under') v = solveLob(b, sv.tx, sv.ty2, 3.4, 0);
  else if (sv.mode === 'float') v = solveFast(b, sv.tx, sv.ty2, 8.5 + sv.power * 5.5, 0);
  else v = solveFast(b, sv.tx, sv.ty2, 13 + sv.power * 8, 0);
  b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
  b.wob = sv.mode === 'float' ? 4.5 : 0; b.phase = rand(0, TAU);
  b.state = 'live'; b.cool = 0.15; b.lastKind = 'serve';
  registerTouch(p, false);
  b.fromServe = true;
  S.state = 'rally'; S.rally = 1;
  sv.stage = 'done';
  p.hitT = 0.3; p.hitKind = sv.mode === 'under' ? 'pochete' : 'spike';
  sfx(sv.mode === 'under' ? 'bump' : 'spike'); ring(b.x, b.y, b.z, '#ffffff', 45);
  if (sv.mode === 'jump') S.shake = 4;
}

/* ============================== PULO / MERGULHO ===================== */
function startJump(p, force) {
  if (p.z > 0.001 || p.vz > 0) return;
  if (!force && (p.state === 'dive' || p.recT > 0 || p.jumpCd > 0)) return;
  p.vz = 6.1; p.state = 'jump'; sfx('jump');
}
function startDive(p) {
  if (p.z > 0.001 || p.state === 'dive' || p.recT > 0 || p.diveCd > 0) return;
  const i = p.input;
  let dx = i.mx, dy = i.my, d = Math.hypot(dx, dy);
  if (d < 0.2) { dx = p.fx; dy = p.fy; d = Math.hypot(dx, dy) || 1; }
  p.dvx = dx / d; p.dvy = dy / d;
  p.state = 'dive'; p.diveT = DIVE_T; p.diveHit = false; p.intent = null;
  sfx('dive'); puff(p.x, p.y, 6, 'rgba(230,205,150,', 1.5);
}

/* ============================== ATUALIZA JOGADOR ==================== */
function updatePlayer(p, dt) {
  const i = p.input, s = p.team ? -1 : 1, D = DIFF[S.diff];
  const isServer = S.state === 'serve' && p === S.serverP;
  p.hitT = Math.max(0, p.hitT - dt); p.jumpCd = Math.max(0, p.jumpCd - dt); p.diveCd = Math.max(0, p.diveCd - dt);
  p.lockCd = Math.max(0, p.lockCd - dt); p.recT = Math.max(0, p.recT - dt);
  if (p.intent) { p.intent.t -= dt; if (p.intent.t <= 0) p.intent = null; }

  if (isServer) serverLogic(p);
  else if (p.state !== 'dive' && p.recT <= 0) {
    if (i.pochete) p.intent = { type: 'pochete', t: 0.2 };
    if (i.set) p.intent = { type: 'set', t: 0.22 };
    if (i.spike) { p.intent = { type: 'spike', t: 0.55 }; startJump(p); }
    if (i.jump) startJump(p);
    if (i.dive) startDive(p);
  }

  if (S.state === 'rally' && ball.state === 'live') {
    if (p.state === 'dive') tryDive(p);
    else if (p.intent && p.recT <= 0) tryIntent(p);
    if (p.z > 0.2) tryBlock(p);
  }

  const air = p.z > 0, base = 5.5 * (p.human ? 1 : D.spd);
  const frozen = isServer && (p.serve.key || p.serve.stage !== 'idle');
  if (p.state === 'dive') {
    p.diveT -= dt;
    const k = Math.max(0, p.diveT / DIVE_T), v = 4 + 7 * k;
    p.vx = p.dvx * v; p.vy = p.dvy * v;
    if (p.diveT <= 0) { p.state = 'idle'; p.recT = 0.55; p.diveCd = 1.0; }
  } else if (p.recT > 0 || frozen) {
    const f = Math.pow(0.02, dt); p.vx *= f; p.vy *= f;
  } else {
    const tvx = (isServer ? 0 : i.mx) * base * (air ? 0.5 : 1), tvy = i.my * base * (air ? 0.5 : 1);
    const acc = (air ? 10 : 55) * dt;
    p.vx += clamp(tvx - p.vx, -acc, acc); p.vy += clamp(tvy - p.vy, -acc, acc);
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = clamp(p.x, p.team ? NET_X + 0.45 : -3.1, p.team ? 19.1 : NET_X - 0.45);
  p.y = clamp(p.y, -2.1, 9.9);
  if (isServer) p.x = p.team ? 16.9 : -0.9;

  if (p.z > 0 || p.vz > 0) {
    p.z += p.vz * dt; p.vz -= 18 * dt;
    if (p.z <= 0) { p.z = 0; p.vz = 0; if (p.state === 'jump') p.state = 'idle'; p.jumpCd = 0.1; if (S.theme === 'praia') puff(p.x, p.y, 4, 'rgba(230,205,150,', 1); }
  }

  const sp = Math.hypot(p.vx, p.vy);
  let ftx = p.fx, fty = p.fy;
  if (p.state === 'dive') { ftx = p.dvx; fty = p.dvy; }
  else if (sp > 1.2) { ftx = p.vx / sp; fty = p.vy / sp; }
  else if (ball.state === 'live') { const bx = ball.x - p.x, by = ball.y - p.y, bd = Math.hypot(bx, by); if (bd > 0.1) { ftx = bx / bd; fty = by / bd; } }
  else { ftx = s; fty = 0; }
  const k = Math.min(1, 16 * dt);
  p.fx += (ftx - p.fx) * k; p.fy += (fty - p.fy) * k;
  const fl = Math.hypot(p.fx, p.fy) || 1; p.fx /= fl; p.fy /= fl;
  p.anim += sp * dt * 2.2;
  if (S.theme === 'praia' && p.z === 0 && sp > 3.5 && Math.random() < dt * 5) puff(p.x - p.fx * 0.3, p.y - p.fy * 0.3, 1, 'rgba(230,205,150,', 0.6);
}

/* ============================== IA ================================== */
const outOfCourt = (l, m) => l.x < -m || l.x > 16 + m || l.y < -m || l.y > 8 + m;
const clampSideX = (tm, x) => tm ? clamp(x, NET_X + 0.5, 19) : clamp(x, -3, NET_X - 0.5);

function steer(p, tx, ty, stop) {
  const i = p.input, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < stop) { i.mx = i.my = 0; return d; }
  const k = Math.min(1, d / 0.7);
  i.mx = dx / d * k; i.my = dy / d * k;
  return d;
}

function bestSpot(tm, hitter) {
  const s = tm ? -1 : 1, opps = teams[1 - tm].players, D = DIFF[S.diff];
  let best = null, bs = -1;
  for (const dx of [2.2, 5, 7.4]) for (const y of [0.9, 2.4, 4, 5.6, 7.1]) {
    const c = { x: NET_X + s * dx, y };
    let md = 99; for (const o of opps) md = Math.min(md, Math.hypot(o.x - c.x, o.y - c.y));
    const sc = md + rand(0, 1) * (1 - D.smart) * 5;
    if (sc > bs) { bs = sc; best = c; }
  }
  return best;
}

function blockRoll(pl) {
  if (pl.blkSeq !== ball.seq) { pl.blkSeq = ball.seq; pl.blkRoll = Math.random() < DIFF[S.diff].blk; }
  return pl.blkRoll;
}

// defesa com 3 a 6 jogadores: bloqueadores na rede, o resto cobre a quadra
function formationN(tm, ty) {
  const pl = plans[tm], P = teams[tm].players, s = tm ? -1 : 1, N = P.length, wb = blockRoll(pl);
  const fronts = P.filter(q => isFrontP(q)).sort((a, c) => Math.abs(a.y - ty) - Math.abs(c.y - ty));
  const nb = N >= 5 ? 2 : 1, blockers = new Set(fronts.slice(0, nb));
  let k = 0;
  blockers.forEach(q => {
    const off = nb === 2 && k ? (fronts[1].y > fronts[0].y ? 0.9 : -0.9) : 0;
    k++;
    if (q.human) return;
    pl.roles[q.idx] = { mode: 'pos', tx: NET_X - s * 0.9, ty: clamp(ty + off, 0.9, 7.1), off, block: true, willBlock: wb };
  });
  for (const q of P) {
    if (q.human || blockers.has(q)) continue;
    const h = slotPos(tm, q.idx, N, (ty - 4) * (isFrontP(q) ? 0.15 : 0.3));
    pl.roles[q.idx] = { mode: 'pos', tx: h.x, ty: h.y };
  }
}

function formation(tm) {
  const pl = plans[tm], P = teams[tm].players, s = tm ? -1 : 1, opp = 1 - tm, b = ball;
  const ballTheirs = sideOf(b.x) === opp;
  const air = teams[opp].players.find(q => q.z > 0.25 && Math.abs(q.x - NET_X) < 4.5);
  let ty = 4;
  if (air) ty = air.y; else if (ballTheirs && b.lastTeam === opp) ty = clamp(b.y, 0.8, 7.2);
  if (P.length >= 3) { formationN(tm, ty); return; }
  if (P.length === 1) { pl.roles[0] = { mode: 'pos', tx: NET_X - s * 4.2, ty: clamp(ty, 1, 7), block: false }; return; }
  const order = [...P].sort((a, c) => Math.abs(a.x - NET_X) - Math.abs(c.x - NET_X));
  const front = order[0], back = order[1];
  const fy = clamp(ty, 0.9, 7.1);
  const roleFront = { mode: 'pos', tx: NET_X - s * 0.9, ty: fy, block: true, willBlock: blockRoll(pl) };
  const roleBack = { mode: 'pos', tx: NET_X - s * 4.8, ty: fy < 4 ? 5.4 : 2.6, block: false };
  pl.roles[front.idx] = roleFront; pl.roles[back.idx] = roleBack;
}

// equipes de 3 a 6: levantador na rede, atacantes nas pontas, o resto nas posições-base
function supportRoles(tm, n, hitter, atkN) {
  const pl = plans[tm], P = teams[tm].players, s = tm ? -1 : 1, N = P.length, used = new Set([hitter]);
  if (!atkN) {
    if (n === 1) {
      const st = setterOf(hitter); used.add(st);
      if (!st.human) pl.roles[st.idx] = { mode: 'pos', tx: NET_X - s * 2.2, ty: 3.8 };
    }
    let w = 0;
    for (const q of P) {
      if (used.has(q) || q.human || !isFrontP(q) || w >= 2 || pl.roles[q.idx]) continue;
      pl.roles[q.idx] = { mode: 'pos', tx: NET_X - s * 1.9, ty: w++ ? 6.6 : 1.4 }; used.add(q);
    }
  }
  for (const q of P) {
    if (q.human || pl.roles[q.idx]) continue;
    const h = slotPos(tm, q.idx, N);
    pl.roles[q.idx] = { mode: 'pos', tx: h.x, ty: h.y };
  }
}

function planTeam(tm) {
  const pl = plans[tm], T = teams[tm], P = T.players, s = tm ? -1 : 1, b = ball, Dd = DIFF[S.diff];
  pl.roles = [];
  if (S.state !== 'rally' || b.state !== 'live') return;
  const land = predictAt(0);
  const landsMine = land && sideOf(land.x) === tm;
  const done = b.lastTeam === tm ? b.touches : 0;
  const MT = maxT(), mine = landsMine && (b.lastTeam !== tm || done < MT);
  if (!mine) { formation(tm); return; }
  if (b.lastTeam !== tm && outOfCourt(land, 0.3 + (1 - Dd.smart) * 0.3)) { formation(tm); return; }

  const n = done + 1, cands = [];
  for (const p of P) {
    if (P.length >= 2 && b.lastTeam === tm && b.lastPlayer === p && b.touches > 0) continue;
    const atk = n === MT;
    let h = atk ? 3.2 : n === 1 ? 1.0 : 1.9;
    let pr = predictAt(h);
    if (n === 1 && !atk && pr && speedAt(pr) < 10.5) { const pr2 = predictAt(1.9); if (pr2) { h = 1.9; pr = pr2; } }
    if (!pr && atk) { h = 1.0; pr = predictAt(h); }
    if (!pr) { h = 0.6; pr = predictAt(0.6) || land; }
    if (!pr) continue;
    const px = clampSideX(tm, pr.x), py = clamp(pr.y, -2, 9.8);
    const dist = Math.hypot(px - p.x, py - p.y);
    cands.push({ p, h, pr, dist, key: dist / (5.5 * (p.human ? 1 : Dd.spd)) - (p.human ? 0.35 : 0) });
  }
  if (!cands.length) { formation(tm); return; }
  cands.sort((a, c) => a.key - c.key);
  const best = cands[0];
  const other = P.length === 2 ? P[1 - best.p.idx] : null, atkN = n === MT;
  const sc = Dd.scat * 0.3;
  if (!best.p.human) {
    const kind = atkN ? (best.h > 2 ? 'spike' : 'pochete') : n === 1 ? (best.h < 1.5 ? 'pochete' : 'set') : (best.h > 1.5 ? 'set' : 'pochete');
    pl.roles[best.p.idx] = {
      mode: 'hit', n, atk: atkN, h: best.h, kind, ex: rand(-sc, sc), ey: rand(-sc, sc),
      aim: atkN ? bestSpot(tm, best.p) : null, willDive: Math.random() < Dd.dive,
    };
  }
  if (P.length >= 3) supportRoles(tm, n, best.p, atkN);
  if (other && !other.human && !(pl.roles[other.idx])) {
    if (n === 1) pl.roles[other.idx] = { mode: 'pos', tx: NET_X - s * 2.4, ty: best.pr.y < 4 ? 5.2 : 2.8 };
    else if (!atkN) pl.roles[other.idx] = { mode: 'pos', tx: NET_X - s * 1.9, ty: best.pr.y < 4 ? 5.4 : 2.6 };
    else pl.roles[other.idx] = { mode: 'pos', tx: NET_X - s * 4.5, ty: 4 };
  }
}

function hitExec(p, r) {
  const i = p.input, b = ball, s = p.team ? -1 : 1;
  const pr = predictAt(r.h);
  let tx = pr ? pr.x : b.x, ty = pr ? pr.y : b.y;
  tx = clampSideX(p.team, tx + r.ex - (r.kind === 'spike' ? s * 0.1 : 0)); ty = clamp(ty + r.ey, -2, 9.8);
  const dist = steer(p, tx, ty, 0.07);
  if (r.atk) i.aim = r.aim;
  else if (r.n === 1) i.aim = passSpot(p);
  else i.aim = setSpot(p);
  const db = Math.hypot(b.x - p.x, b.y - p.y), rz = b.z - p.z;

  if (r.kind === 'spike') {
    if (db < 1.3 && pr && pr.t < 0.42 && p.z <= 0.001) i.spike = true;
  } else {
    if (reach(p, 'pochete') && (r.kind === 'pochete' || rz < 1.0)) i.pochete = true;
    else if (r.kind === 'set' && reach(p, 'set')) i.set = true;
  }
  if (r.willDive && !r.atk && pr && dist > 1.5 && dist < 3.2 && pr.t < 0.4 && pr.t > 0.1 && dist / (5.5 * DIFF[S.diff].spd) > pr.t - 0.05 && b.z - p.z < 1.8) {
    i.mx = (tx - p.x) / dist; i.my = (ty - p.y) / dist; i.dive = true;
  }
}

function execRole(p, r) {
  if (!r) { p.input.mx = p.input.my = 0; return; }
  const i = p.input, s = p.team ? -1 : 1;
  if (r.mode === 'pos') {
    let ty = r.ty;
    if (r.block) {
      const opp = teams[1 - p.team].players;
      const atk = opp.find(q => q.z > 0.25 && Math.abs(q.x - NET_X) < 4.5);
      if (atk) ty = clamp(atk.y + (r.off || 0), 0.9, 7.1);
      if (r.willBlock && ball.state === 'live' && ball.lastTeam === 1 - p.team && sideOf(ball.x) === 1 - p.team) {
        const nearNet = Math.abs(ball.x - NET_X) < 3.4;
        if (nearNet && atk && p.z === 0 && Math.abs(p.y - ty) < 1.1) i.jump = true;
      }
    }
    steer(p, r.tx, ty, 0.15);
  } else if (r.mode === 'hit') hitExec(p, r);
}

function aiTeam(tm) {
  const pl = plans[tm];
  pl.t -= DT;
  if (ball.seq !== pl.seq) { pl.seq = ball.seq; pl.t = Math.max(pl.t, DIFF[S.diff].react * rand(0.6, 1.2)); }
  if (pl.t <= 0) { pl.t = 0.06; planTeam(tm); }
  for (const p of teams[tm].players) if (!p.human) execRole(p, pl.roles[p.idx]);
}

/* ============================== PASSO DA SIMULAÇÃO ================== */
function separate() {
  for (const T of teams) {
    const P = T.players;
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
      const p = P[a], q = P[b];
      if (p.state === 'dive' || q.state === 'dive') continue;
      let dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d >= 0.75) continue;
      if (d < 0.01) { dx = 1; dy = 0; d = 1; }
      const k = (0.75 - d) * 0.5 / d;
      if (S.state === 'serve' && (p === S.serverP || q === S.serverP)) continue;
      p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k;
    }
  }
}

function step(dt) {
  if (S.hitstop > 0) { S.hitstop -= dt; return; }
  S.t += dt;
  for (const p of allPlayers) {
    if (p.remote) readRemote(p);
    else if (p.human) readHuman(p);
    else { const o = p.input; o.mx = o.my = 0; o.pochete = o.set = o.spike = o.jump = o.dive = false; o.aim = null; o.hold = null; }
  }
  if (S.state === 'point' && !S.over) for (const p of allPlayers) if (!p.human) { const h = homeFor(p); steer(p, h.x, h.y, 0.1); }
  if (S.state === 'rally') { aiTeam(0); aiTeam(1); }
  for (const p of allPlayers) updatePlayer(p, dt);
  separate();
  updateBall(dt);
  updateFX(dt);

  if (S.state === 'point') {
    S.pointT -= dt;
    if (S.pointT <= 0) {
      if (S.over) { if (S.ui === 'play') showOver(); }
      else startServe();
    }
  }
  if (S.mode === 0 && S.score[0] + S.score[1] > 40) startMatch(0);
  if (ON.on && ON.host && ++ON.tick % (ON.conns.size > 4 ? 4 : 3) === 0) sendSnap();
  edgeDown.clear(); edgeUp.clear();
}

function updateFX(dt) {
  S.netWob *= Math.pow(0.05, dt);
  S.shake *= Math.pow(0.002, dt);
  if (S.toast) S.toast.t += dt;
  for (let k = parts.length - 1; k >= 0; k--) {
    const q = parts[k]; q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z = Math.max(0, q.z + q.vz * dt); q.vz -= 7 * dt; q.vx *= 0.97; q.vy *= 0.97;
    if (q.life <= 0) parts.splice(k, 1);
  }
  for (let k = rings.length - 1; k >= 0; k--) { const q = rings[k]; q.t += dt; if (q.t > q.life) rings.splice(k, 1); }
  for (let k = floats.length - 1; k >= 0; k--) { const q = floats[k]; q.t += dt; if (q.t > q.life) floats.splice(k, 1); }
}

/* ============================== RENDER ============================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let bgCanvas = null, kScale = 1;

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function ell(c, x, y, rx, ry, fill) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fillStyle = fill; c.fill(); }

function umbrella(c, x, y, r, a, b) {
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x + 8, y + 10, r, r * 0.95, 0, 0, TAU); c.fill();
  for (let k = 0; k < 8; k++) { c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, k * TAU / 8, (k + 1) * TAU / 8); c.closePath(); c.fillStyle = k % 2 ? a : b; c.fill(); }
  c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  ell(c, x, y, 4, 4, '#555');
}
function palm(c, x, y, rnd) {
  c.fillStyle = 'rgba(0,0,0,.16)'; c.beginPath(); c.ellipse(x + 10, y + 12, 52, 44, 0, 0, TAU); c.fill();
  for (let k = 0; k < 9; k++) {
    const a = k * TAU / 9 + rnd() * 0.2;
    c.save(); c.translate(x, y); c.rotate(a);
    c.beginPath(); c.ellipse(34, 0, 36, 9, 0, 0, TAU); c.fillStyle = k % 2 ? '#2f8f3a' : '#3aa545'; c.fill();
    c.strokeStyle = '#1f6b2a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(68, 0); c.stroke();
    c.restore();
  }
  ell(c, x, y, 8, 8, '#6b4a2a'); ell(c, x - 3, y - 3, 3, 3, '#8a6238');
}

function drawBG(c, theme) {
  const rnd = mulberry(11);
  if (theme === 'praia') {
    c.fillStyle = '#ecd29a'; c.fillRect(0, 0, W, H);
    const wy = x => 88 + Math.sin(x / 40) * 6 + Math.sin(x / 17) * 2.5;
    let g = c.createLinearGradient(0, 0, 0, 100); g.addColorStop(0, '#07407e'); g.addColorStop(1, '#35c0d8');
    c.fillStyle = g; c.beginPath(); c.moveTo(0, 0);
    for (let x = 0; x <= W; x += 8) c.lineTo(x, wy(x));
    c.lineTo(W, 0); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.12)';
    for (let k = 0; k < 26; k++) { const x = rnd() * W, y = rnd() * 70; c.fillRect(x, y, 30 + rnd() * 40, 2); }
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 5; c.beginPath();
    for (let x = 0; x <= W; x += 8) { const y = wy(x) + 2; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    c.strokeStyle = 'rgba(120,90,50,.28)'; c.lineWidth = 14; c.beginPath();
    for (let x = 0; x <= W; x += 8) { const y = wy(x) + 14; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    for (let k = 0; k < 6500; k++) {
      c.fillStyle = rnd() < 0.5 ? 'rgba(140,100,45,.13)' : 'rgba(255,255,255,.17)';
      c.fillRect(rnd() * W, 110 + rnd() * (H - 110), 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
    c.fillStyle = 'rgba(255,240,200,.35)'; c.fillRect(OX - 40, OY - 40, COURT_W * PPM + 80, COURT_H * PPM + 80);
    c.fillStyle = '#f7e3ad'; c.fillRect(OX, OY, COURT_W * PPM, COURT_H * PPM);
    c.fillStyle = 'rgba(150,110,50,.07)';
    for (let y = OY + 6; y < OY + COURT_H * PPM; y += 14) c.fillRect(OX, y, COURT_W * PPM, 2);
    c.strokeStyle = '#1b5cd6'; c.lineWidth = 5; c.strokeRect(OX, OY, COURT_W * PPM, COURT_H * PPM);
    umbrella(c, 64, 330, 40, '#e63946', '#fff');
    umbrella(c, 66, 545, 38, '#1d78d6', '#fff');
    umbrella(c, 1218, 320, 40, '#ffb703', '#fff');
    umbrella(c, 1214, 540, 38, '#2fb36b', '#fff');
    c.fillStyle = '#e63946'; c.fillRect(28, 380, 22, 70); c.fillStyle = '#fff'; c.fillRect(28, 394, 22, 8);
    c.fillStyle = '#1d78d6'; c.fillRect(1236, 380, 22, 70); c.fillStyle = '#fff'; c.fillRect(1236, 394, 22, 8);
    palm(c, 70, 672, rnd); palm(c, 1212, 672, rnd);
  } else {
    c.fillStyle = '#7b4a24'; c.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 42) { c.fillStyle = (x / 42) % 2 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.04)'; c.fillRect(x, 0, 42, H); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x, 0, 1.5, H); }
    for (let k = 0; k < 90; k++) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 26, 1.5); }
    c.fillStyle = '#c28a52'; c.fillRect(OX - 70, OY - 60, COURT_W * PPM + 140, COURT_H * PPM + 120);
    for (let x = OX - 70; x < OX + COURT_W * PPM + 70; x += 28) { c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(x, OY - 60, 1.5, COURT_H * PPM + 120); }
    c.fillStyle = '#2f79cf'; c.fillRect(OX, OY, COURT_W * PPM, COURT_H * PPM);
    c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(OX, OY, 3 * PPM + (NET_X - 3) * PPM, COURT_H * PPM);
    c.fillStyle = 'rgba(0,0,0,.08)'; c.fillRect(CX, OY, COURT_W * PPM / 2, COURT_H * PPM);
    c.strokeStyle = '#fff'; c.lineWidth = 5; c.strokeRect(OX, OY, COURT_W * PPM, COURT_H * PPM);
    c.lineWidth = 3; c.beginPath(); c.moveTo(CX - 3 * PPM, OY); c.lineTo(CX - 3 * PPM, OY + COURT_H * PPM); c.moveTo(CX + 3 * PPM, OY); c.lineTo(CX + 3 * PPM, OY + COURT_H * PPM); c.stroke();
    const crowd = (y0, y1) => {
      const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#1b1230'); g.addColorStop(1, '#2d1f4d'); c.fillStyle = g; c.fillRect(0, y0, W, y1 - y0);
      for (let y = y0 + 12; y < y1 - 6; y += 17) for (let x = 8 + ((y / 17) % 2) * 9; x < W; x += 18) {
        const col = ['#e63946', '#ffb703', '#2fb36b', '#4aa3ff', '#ff7fb0', '#eee'][Math.floor(rnd() * 6)];
        ell(c, x, y + 5, 6, 5, col); ell(c, x, y - 1, 3.6, 3.6, ['#f1c9a5', '#b97c52', '#8a5a3a', '#e8b48a'][Math.floor(rnd() * 4)]);
      }
    };
    crowd(0, 104); crowd(660, H);
    c.fillStyle = '#e63946'; c.fillRect(0, 100, W, 6); c.fillStyle = '#fff'; c.fillRect(0, 106, W, 3);
    c.fillStyle = '#ffd23f'; c.fillRect(0, 654, W, 6);
    c.fillStyle = 'rgba(255,255,255,.1)'; c.font = 'bold 54px Impact, Arial Black'; c.textAlign = 'center';
    c.fillText('VÔLEI', OX + 4 * PPM, OY + 4 * PPM + 18); c.fillText('ARCADE', OX + 12 * PPM, OY + 4 * PPM + 18);
  }
}

function buildBG() {
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = canvas.width; bgCanvas.height = canvas.height;
  const c = bgCanvas.getContext('2d');
  c.setTransform(kScale, 0, 0, kScale, 0, 0);
  drawBG(c, S.theme);
}

function fit() {
  const st = document.getElementById('stage');
  const w = st.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * 9 / 16);
  kScale = canvas.width / W;
  const compact = innerHeight < 560;                          // celular na horizontal: menus mais compactos
  document.body.classList.toggle('compact', compact);
  document.body.classList.toggle('portrait', IS_TOUCH && innerHeight > innerWidth);
  st.style.setProperty('--u', (w / (compact ? 900 : 1280)) + 'px');
  document.documentElement.style.setProperty('--vh1', (innerHeight / 100) + 'px');
  buildBG();
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 250));

/* ---- desenho de personagem (vista de cima) ---- */
function drawShadow(x, y, rx, ry, a) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(sx(x), sy(y), rx, ry, 0, 0, TAU); ctx.fill(); }

function drawPlayer(p) {
  const px = sx(p.x, p.z), py = sy(p.y, p.z), sc = 1 + p.z * 0.16;
  const ang = Math.atan2(p.fy, p.fx), pal = p.pal;
  const dive = p.state === 'dive', lying = p.recT > 0, hit = p.hitT > 0 ? p.hitKind : '';
  const sp = Math.hypot(p.vx, p.vy), sw = Math.sin(p.anim * 2.4) * Math.min(1, sp / 4);
  ctx.save(); ctx.translate(px, py); ctx.scale(sc, sc); ctx.rotate(ang);
  if (dive) { ctx.translate(8, 0); ctx.scale(1.28, 0.88); }
  if (lying) { ctx.scale(1.12, 0.9); }

  // pernas / pés
  ell(ctx, -9 + sw * 6, -6, 7, 4.2, pal.skin); ell(ctx, -9 - sw * 6, 6, 7, 4.2, pal.skin);
  ell(ctx, -3 + sw * 3, -5.5, 8, 5, pal.short); ell(ctx, -3 - sw * 3, 5.5, 8, 5, pal.short);
  // tronco
  ell(ctx, 0, 0, 9.5, 15.5, pal.shirt);
  ctx.fillStyle = pal.trim; ctx.fillRect(-3, -2, 7, 4);
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(0, 0, 9.5, 15.5, 0, 0, TAU); ctx.stroke();

  // braços
  const arm = (ax, ay, hx, hy, r) => {
    ctx.strokeStyle = pal.skin; ctx.lineWidth = 5.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.stroke();
    ell(ctx, hx, hy, r, r, pal.skin);
  };
  if (hit === 'pochete' || hit === 'dive' || (p.intent && p.intent.type === 'pochete') || dive) {
    arm(1, -13, 17, -2, 4); arm(1, 13, 17, 2, 4);
  } else if (hit === 'set' || (p.intent && p.intent.type === 'set' && p.z === 0)) {
    arm(1, -13, 13, -6, 5); arm(1, 13, 13, 6, 5);
  } else if (hit === 'spike' || (p.intent && p.intent.type === 'spike')) {
    arm(1, -13, 11, -9, 5.5); arm(1, 13, 16, 7, 6.5);
  } else if (hit === 'block' || hit === 'tip' || (p.z > 0.2)) {
    arm(1, -13, 11, -8, 6); arm(1, 13, 11, 8, 6);
  } else {
    arm(1, -13, 8 + sw * 4, -17, 3.6); arm(1, 13, 8 - sw * 4, 17, 3.6);
  }
  // cabeça
  ell(ctx, 3, 0, 8.2, 8.2, pal.skin);
  ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(3, 0, 8.6, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  ctx.fillStyle = pal.hair; ctx.beginPath(); ctx.arc(3, 0, 6, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  ctx.strokeStyle = pal.trim; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(3, 0, 8, -0.9, 0.9); ctx.stroke();
  ell(ctx, 10.5, 0, 1.8, 1.4, 'rgba(0,0,0,.25)');
  ctx.restore();

  if (p.human) {
    const col = p.team ? '#6cc4ff' : '#ffb15a';
    ctx.save(); ctx.translate(px, py - 34 * sc); ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(8, -4); ctx.lineTo(0, 7); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = 'bold 13px Trebuchet MS, Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    const lbl = ON.on ? (p.local ? 'VOCÊ' : (p.name || 'JOGADOR')) : S.mode === 2 ? (p.team ? 'J2' : 'J1') : 'VOCÊ'; ctx.strokeText(lbl, 0, -9); ctx.fillStyle = '#fff'; ctx.fillText(lbl, 0, -9);
    ctx.restore();
    if (lying) { ctx.save(); ctx.font = 'bold 12px Arial'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'center'; ctx.fillText('•••', px, py + 28); ctx.restore(); }
  }
}

function zoneColor(rz) { return rz < 1.35 ? ['#4aa3ff', 'pochete'] : rz < 2.05 ? ['#ffd23f', 'set'] : ['#ff5a4a', 'spike']; }

function drawBall() {
  const b = ball;
  if (b.state === 'held' && !S.serverP) return;
  const r = BR * PPM * 1.05 * zs(b.z), x = sx(b.x, b.z), y = sy(b.y, b.z);
  // trilha de velocidade
  for (let k = 0; k < b.trail.length; k++) {
    const t = b.trail[k], a = (k + 1) / (b.trail.length + 1) * 0.28;
    ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.arc(sx(t.x, t.z), sy(t.y, t.z), BR * PPM * zs(t.z) * 0.9, 0, TAU); ctx.fill();
  }
  // sombra no chão
  const sr = BR * PPM * 1.05, sa = clamp(0.38 - b.z * 0.03, 0.14, 0.38);
  ctx.fillStyle = `rgba(0,0,0,${sa})`; ctx.beginPath(); ctx.ellipse(sx(b.x), sy(b.y), sr * (1 + b.z * 0.03), sr * (1 + b.z * 0.03) * 0.85, 0, 0, TAU); ctx.fill();
  // corpo
  ctx.save(); ctx.translate(x, y); ctx.rotate(b.rot);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  const cols = ['#ffd23f', '#2f6fed', '#ffffff'];
  for (let k = 0; k < 3; k++) { ctx.save(); ctx.rotate(k * Math.PI / 3); ctx.fillStyle = cols[k]; ctx.fillRect(-r * 1.2, -r * 0.3, r * 2.4, r * 0.6); ctx.restore(); }
  const gr = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,40,.32)');
  ctx.fillStyle = gr; ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,25,60,.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

function drawNet() {
  const x = sx(NET_X), w = Math.sin(S.t * 22) * S.netWob * 3;
  const y0 = sy(0), y1 = sy(COURT_H), t0 = sy(0, NET_H), t1 = sy(COURT_H, NET_H);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x + 8 + w, y0); ctx.lineTo(x + 8 + w, y1); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x + w, t0); ctx.lineTo(x + w, t1); ctx.stroke();
  ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(20,20,30,.6)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x + w, t0); ctx.lineTo(x + w, t1); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w, t0); ctx.lineTo(x + w, t1); ctx.stroke();
  for (const [yy, ty] of [[y0, t0], [y1, t1]]) {
    ctx.strokeStyle = '#444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, ty); ctx.stroke();
    ell(ctx, x, ty, 6, 6, '#e8e8e8'); ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, ty, 6, 0, TAU); ctx.stroke();
    ell(ctx, x, ty, 2.5, 2.5, '#d33');
  }
  ctx.restore();
}

function drawMarkers() {
  const b = ball;
  if (S.state !== 'rally' || b.state !== 'live') return;
  const pr = predictAt(1.2) || predictAt(0);
  if (pr && b.z > 0.6) {
    const x = sx(pr.x), y = sy(pr.y), pulse = 1 + Math.sin(S.t * 8) * 0.1;
    const oursSide = S.mode > 0 && sideOf(pr.x) === 0;
    ctx.strokeStyle = oursSide ? 'rgba(255,230,120,.9)' : 'rgba(255,255,255,.5)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 15 * pulse, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
  }
  // anéis de zona + tecla sugerida para humanos
  for (const p of allPlayers) {
    if (!p.human || !p.local) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > 3.2) continue;
    const [col, kind] = zoneColor(b.z - p.z), near = d < 1.3;
    ctx.strokeStyle = col; ctx.globalAlpha = near ? 0.95 : 0.45; ctx.lineWidth = near ? 4 : 2.5;
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 1.2 * PPM, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    const lab = (IS_TOUCH ? TOUCH_LABEL : p.ctrl.label)[kind], tk = IS_TOUCH ? 1.45 : 1;
    const bx = sx(b.x, b.z) + 16 * zs(b.z), by = sy(b.y, b.z) - 16 * zs(b.z);
    ctx.font = `bold ${15 * tk}px Trebuchet MS, Arial`; ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by, 11 * tk, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = kind === 'set' ? '#000' : '#fff'; ctx.fillText(lab, bx, by + 5 * tk);
  }
}

function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function outlineText(t, x, y, fill, stroke = 'rgba(0,0,0,.75)', lw = 5) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(t, x, y); ctx.fillStyle = fill; ctx.fillText(t, x, y); }

function drawHUD() {
  // placar
  const cx = W / 2, y = 14;
  ctx.save();
  roundRect(ctx, cx - 250, y, 500, 76, 16); ctx.fillStyle = 'rgba(8,16,40,.82)'; ctx.fill(); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3; ctx.stroke();
  const cols = ['#ff8a2a', '#2f9bff'];
  for (const tm of [0, 1]) {
    const bx = tm ? cx + 8 : cx - 142;
    roundRect(ctx, bx, y + 8, 134, 60, 10); ctx.fillStyle = cols[tm]; ctx.fill();
    ctx.textAlign = 'center'; ctx.font = 'bold 13px Trebuchet MS, Arial'; ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillText(teamName(tm), bx + 67, y + 24);
    ctx.font = '44px Impact, Arial Black'; outlineText(String(S.score[tm]), bx + 67, y + 62, '#fff', 'rgba(0,0,0,.45)', 4);
    // toques
    for (let k = 0; k < maxT(); k++) {
      const on = S.state === 'rally' && ball.lastTeam === tm && ball.touches > k;
      ctx.beginPath(); ctx.arc(bx + 67 + (k - (maxT() - 1) / 2) * 20, y + 90, 6, 0, TAU); ctx.fillStyle = on ? '#ffd23f' : 'rgba(255,255,255,.22)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (S.serving === tm) { ctx.beginPath(); ctx.arc(bx + (tm ? 120 : 14), y + 16, 6, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#1b5cd6'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.font = '30px Impact, Arial Black'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd23f'; ctx.fillText(':', cx, y + 52);
  ctx.restore();
  ctx.font = 'bold 12px Trebuchet MS, Arial'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.75)';
  if (S.mode > 0) ctx.fillText(`${S.size} x ${S.size} · ${S.target} PONTOS · ${DIFF_LABEL[S.diff]}`, cx, y + 106);

  // dica de controles
  if (S.mode > 0 && !IS_TOUCH) {
    const c = S.mode === 2 ? null : CTRL_SOLO;
    ctx.font = 'bold 13px Trebuchet MS, Arial'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.72)';
    const txt = S.mode === 2 && !ON.on ? 'J1: WASD · F pochete · G levantar · H cortar · Espaço pular · Shift esq. mergulho      J2: Setas · Num1 pochete · Num2 levantar · Num3 cortar · Num0 pular · Num. mergulho'
      : 'Num 8/4/5/6 mover · Num1 pochete · Num2 levantar · Num3 cortar · Num0 pular/bloquear · Num. (ponto) mergulho · segure direção para mirar';
    const tw = ctx.measureText(txt).width + 24;
    roundRect(ctx, W / 2 - tw / 2, H - 31, tw, 22, 11); ctx.fillStyle = 'rgba(5,10,30,.6)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(txt, W / 2, H - 15);
  }

  // saque
  if (S.state === 'serve' && S.mode > 0 && S.serverP) {
    const p = S.serverP;
    if (p.human && p.local) {
      const L = IS_TOUCH ? TOUCH_LABEL : p.ctrl.label, sv = p.serve, tk = IS_TOUCH ? 1.35 : 1;
      if (!sv.key) {
        ctx.font = `bold ${17 * tk}px Trebuchet MS, Arial`; ctx.textAlign = 'center';
        outlineText(`SEGURE ${L.pochete} (por baixo) · ${L.set} (flutuante) · ${L.spike} (viagem)  —  mova para ajustar`, W / 2, H - 40, '#fff');
      } else {
        const s = p.team ? -1 : 1, tx = NET_X + s * (0.9 + clamp(sv.power, 0, 1.15) * 6.9), x = sx(tx), y = sy(sv.ty);
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(sx(p.x), sy(p.y)); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
        const bad = sv.power > 1.0; ctx.strokeStyle = bad ? '#ff4a4a' : '#7dff9a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 16 + Math.sin(S.t * 10) * 2, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 24, y); ctx.lineTo(x + 24, y); ctx.moveTo(x, y - 24); ctx.lineTo(x, y + 24); ctx.stroke();
        // barra
        const bx = sx(p.x) - 45, by = sy(p.y) + 36;
        roundRect(ctx, bx, by, 90, 12, 6); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
        const gw = 90 * clamp(sv.power / 1.15, 0, 1);
        const gg = ctx.createLinearGradient(bx, 0, bx + 90, 0); gg.addColorStop(0, '#4ade80'); gg.addColorStop(0.85, '#facc15'); gg.addColorStop(1, '#ef4444');
        roundRect(ctx, bx, by, Math.max(2, gw), 12, 6); ctx.fillStyle = gg; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(bx + 90 * (1.0 / 1.15), by - 2, 2, 16);
        ctx.restore();
        ctx.font = `bold ${16 * tk}px Trebuchet MS, Arial`; ctx.textAlign = 'center';
        outlineText('Solte para sacar · cima/baixo mira o lado', W / 2, H - 40, '#fff');
      }
    }
  }
}
const DIFF_LABEL = { facil: 'FÁCIL', normal: 'NORMAL', dificil: 'DIFÍCIL' };

function drawToast() {
  const t = S.toast; if (!t) return;
  const life = S.state === 'point' ? 2.0 : 1.3;
  if (t.t > life) return;
  const a = t.t < 0.15 ? t.t / 0.15 : t.t > life - 0.3 ? (life - t.t) / 0.3 : 1;
  const sc = 1 + Math.max(0, 0.35 - t.t * 1.6);
  ctx.save(); ctx.globalAlpha = clamp(a, 0, 1); ctx.translate(W / 2, 340); ctx.scale(sc, sc);
  ctx.textAlign = 'center'; ctx.font = '86px Impact, Arial Black';
  outlineText(t.text, 0, 0, t.col, 'rgba(0,0,0,.8)', 10);
  ctx.font = 'bold 24px Trebuchet MS, Arial'; outlineText(t.sub, 0, 40, '#fff', 'rgba(0,0,0,.8)', 6);
  ctx.restore();
}

function render() {
  ctx.setTransform(kScale, 0, 0, kScale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (bgCanvas) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bgCanvas, 0, 0); ctx.setTransform(kScale, 0, 0, kScale, 0, 0); }
  ctx.save();
  if (S.shake > 0.3) ctx.translate(rand(-1, 1) * S.shake, rand(-1, 1) * S.shake);

  // sombras
  for (const p of allPlayers) drawShadow(p.x, p.y, 20 * (1 - p.z * 0.12), 16 * (1 - p.z * 0.12), 0.25 - p.z * 0.08);
  // partículas rasteiras
  for (const q of parts) { ctx.globalAlpha = clamp(q.life / q.max, 0, 1) * 0.8; ctx.fillStyle = q.col + '1)'; ctx.beginPath(); ctx.arc(sx(q.x, q.z), sy(q.y, q.z), q.size, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  drawMarkers();
  for (const p of [...allPlayers].sort((a, c) => a.y - c.y)) drawPlayer(p);
  drawNet();
  drawBall();
  // anéis de impacto
  for (const q of rings) {
    const k = q.t / q.life; ctx.globalAlpha = 1 - k; ctx.strokeStyle = q.col; ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(sx(q.x, q.z), sy(q.y, q.z), 6 + q.max * k, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const q of floats) {
    const k = q.t / q.life; ctx.globalAlpha = 1 - k * k; ctx.font = `bold ${q.size * (IS_TOUCH ? 1.4 : 1)}px Trebuchet MS, Arial`; ctx.textAlign = 'center';
    outlineText(q.text, sx(q.x, q.z), sy(q.y, q.z) - 20 - k * 30, q.col, 'rgba(0,0,0,.8)', 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (S.ui === 'play' || S.mode > 0) drawHUD();
  if (S.ui === 'play') drawToast();
}

/* ============================== UI ================================== */
const $ = id => document.getElementById(id);
const opts = { mode: 1, size: 2, diff: 'normal', target: 11, theme: 'praia' };
try { Object.assign(opts, JSON.parse(localStorage.getItem('volei_opts') || '{}')); } catch (e) { /* sem storage */ }

function refreshSeg() {
  document.querySelectorAll('.seg').forEach(sg => {
    const k = sg.dataset.key;
    sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(opts[k]) === b.dataset.val));
  });
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  const k = b.parentElement.dataset.key, v = b.dataset.val;
  opts[k] = (k === 'mode' || k === 'target' || k === 'size') ? Number(v) : v;
  try { localStorage.setItem('volei_opts', JSON.stringify(opts)); } catch (e) { /* ok */ }
  if (k === 'theme') { S.theme = opts.theme; buildBG(); }
  if (k === 'size' && S.ui === 'menu') { S.size = opts.size; startMatch(0); }
  refreshSeg();
  if (ON.host && ON.lobby && !ON.on) broadcastLobby();
}));

function show(id, on) { $(id).classList.toggle('hidden', !on); }
function toggleHelp(on) { show('help', on); show('menu', !on); }
function setPause(on) { S.paused = on; show('pause', on); if (!on) { edgeDown.clear(); edgeUp.clear(); } }
function showMenu() {
  if (ON.on || ON.lobby || ON.peer) onlineClose();
  S.ui = 'menu'; S.paused = false; show('online', false); show('menu', true); show('help', false); show('pause', false); show('over', false);
  S.theme = opts.theme; S.size = opts.size; buildBG(); S.diff = 'normal'; startMatch(0);
}
function beginGame() {
  audioInit();
  S.ui = 'play'; S.paused = false; S.size = opts.size; S.diff = opts.diff; S.target = opts.target; S.theme = opts.theme;
  show('menu', false); show('help', false); show('pause', false); show('over', false);
  buildBG(); startMatch(opts.mode);
  edgeDown.clear(); edgeUp.clear();
}
function showOver() {
  S.ui = 'over';
  const you = S.mode === 1 || ON.on;
  const mine = ON.on ? ON.myTeam : 0;
  $('overTitle').textContent = you ? (S.winner === mine ? 'VITÓRIA!' : 'DERROTA') : `${teamName(S.winner)} VENCEU!`;
  $('btnAgain').classList.toggle('hidden', ON.on && !ON.host);
  $('overScore').textContent = `${S.score[0]} x ${S.score[1]}`;
  show('over', true);
}
$('btnPlay').onclick = beginGame;
$('btnHelp').onclick = () => toggleHelp(true);
$('btnHelpBack').onclick = () => toggleHelp(false);
$('btnResume').onclick = () => setPause(false);
$('btnRestart').onclick = beginGame;
$('btnQuit').onclick = showMenu;
$('btnAgain').onclick = () => (ON.on && ON.host ? startOnlineHost() : beginGame());
$('btnMenu').onclick = showMenu;

/* ============================== ONLINE ============================== */
// Várias pessoas por sala (até 12), cada uma em uma equipe (A ou B); o resto das vagas é do computador.
// O anfitrião simula tudo e manda "fotos" do jogo; os convidados só desenham e mandam os comandos.
const ONLINE_PREFIX = 'volei-arcade-', MAX_HUMANS = 12, MAX_TEAM = 6;
const randCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let t = ''; for (let i = 0; i < 5; i++) t += a[(Math.random() * a.length) | 0]; return t; };
const onStatus = t => { $('onStatus').textContent = t || ''; };
const NO_NET = 'Não foi possível carregar o serviço de salas (PeerJS). Confira a internet.';
const cleanName = t => String(t || '').replace(/[^A-Za-zÀ-ÿ0-9 _-]/g, '').trim().slice(0, 10) || 'JOGADOR';
let myName = 'JOGADOR';
try { myName = cleanName(localStorage.getItem('volei_name') || 'JOGADOR'); } catch (e) { /* ok */ }
$('onName').value = myName;
function readName() { myName = cleanName($('onName').value); $('onName').value = myName; try { localStorage.setItem('volei_name', myName); } catch (e) { /* ok */ } }

function onView(v) {
  show('onHome', v === 'home'); show('onLobby', v === 'lobby');
  show('btnOnStart', v === 'lobby' && ON.host); show('onCfg', v === 'lobby' && ON.host);
  $('onPanel').classList.toggle('lobby', v === 'lobby');
}
const teamCounts = () => [0, 1].map(t => ON.roster.filter(r => r.team === t).length);
const effSize = () => { const c = teamCounts(); return clamp(Math.max(opts.size, c[0], c[1]), 1, MAX_TEAM); };

function renderLobby() {
  const box = $('onList'); box.innerHTML = '';
  for (const r of ON.roster) {
    const bt = document.createElement('button');
    bt.className = 'rrow t' + r.team;
    bt.textContent = `${r.name}${r.id === 0 ? ' (anfitrião)' : ''}${r.id === ON.myId ? ' · você' : ''} — EQUIPE ${r.team ? 'B' : 'A'}`;
    bt.disabled = !(ON.host || r.id === ON.myId);
    bt.onclick = () => changeTeam(r.id);
    box.appendChild(bt);
  }
  const c = teamCounts(), cfg = ON.host ? { size: effSize(), diff: opts.diff, target: opts.target, theme: opts.theme } : (ON.cfg || {});
  const dn = { facil: 'fácil', normal: 'normal', dificil: 'difícil' }[cfg.diff] || '';
  $('onInfo').textContent = `Equipe A: ${c[0]} · Equipe B: ${c[1]}. Vagas sem pessoa ficam com o computador.`;
  $('onSummary').textContent = `${cfg.size || '?'} por equipe · ${dn} · ${cfg.target || '?'} pontos · ${cfg.theme === 'ginasio' ? 'ginásio' : 'praia'}`;
  if (ON.host) {
    const n = ON.conns.size;
    $('onWho').textContent = n ? `${n + 1} jogadores na sala. Toque numa linha para trocar a pessoa de equipe.` : 'Aguardando outros jogadores entrarem...';
    $('btnOnStart').disabled = !n;
  } else $('onWho').textContent = 'Conectado! Aguardando o anfitrião começar a partida...';
}
function changeTeam(id) {
  const r = ON.roster.find(x => x.id === id); if (!r) return;
  const nt = 1 - r.team;
  if (teamCounts()[nt] >= MAX_TEAM) return onStatus('Equipe cheia (máximo 6).');
  onStatus('');
  if (ON.host) { r.team = nt; broadcastLobby(); }
  else if (id === ON.myId && ON.conn && ON.conn.open) ON.conn.send({ t: 'team', team: nt });
}
function broadcastLobby() {
  const m = { t: 'lobby', roster: ON.roster, cfg: { size: effSize(), diff: opts.diff, target: opts.target, theme: opts.theme } };
  for (const c of ON.conns.values()) if (c.open) { try { c.send(m); } catch (e) { /* ok */ } }
  renderLobby();
}

function onlineClose() {
  ON.on = ON.host = ON.guest = ON.lobby = false;
  const cs = [...ON.conns.values()], c = ON.conn, pr = ON.peer;
  ON.conns.clear(); ON.conn = ON.peer = null; ON.code = ''; ON.ev.length = 0; ON.roster = []; ON.inputs = {}; ON.myId = 0; ON.myTeam = 0; ON.nextId = 1;
  for (const x of cs) { try { x.close(); } catch (e) { /* ok */ } }
  try { if (c) c.close(); } catch (e) { /* ok */ }
  try { if (pr) pr.destroy(); } catch (e) { /* ok */ }
}
function onlineLost(msg) {
  const was = ON.on || ON.lobby;
  onlineClose();
  if (!was) return;
  showMenu(); show('menu', false); show('online', true); onView('home'); onStatus(msg || 'Conexão perdida.');
}

function onlineCreate() {
  if (typeof Peer === 'undefined') return onStatus(NO_NET);
  readName(); onlineClose(); ON.host = true; onStatus('Criando sala...');
  const attempt = n => {
    const code = randCode(), peer = new Peer(ONLINE_PREFIX + code);
    ON.peer = peer;
    peer.on('open', () => {
      ON.code = code; ON.lobby = true; ON.myId = 0; ON.myTeam = 0; ON.roster = [{ id: 0, name: myName, team: 0 }];
      onStatus(''); onView('lobby');
      $('onCodeShow').textContent = code;
      $('onLink').textContent = location.origin + location.pathname + '?sala=' + code;
      renderLobby();
    });
    peer.on('connection', conn => {
      conn.on('open', () => {
        if (ON.on) { conn.send({ t: 'full', why: 'A partida já começou.' }); setTimeout(() => { try { conn.close(); } catch (e) { /* ok */ } }, 300); }
        else if (ON.roster.length >= MAX_HUMANS) { conn.send({ t: 'full', why: 'Sala cheia.' }); setTimeout(() => { try { conn.close(); } catch (e) { /* ok */ } }, 300); }
      });
      conn._seen = performance.now();
      conn.on('data', m => hostRecv(conn, m));
      conn.on('close', () => hostDrop(conn)); conn.on('error', () => {});
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && n < 6) { try { peer.destroy(); } catch (x) { /* ok */ } attempt(n + 1); return; }
      if (ON.lobby || ON.on) onlineLost('Erro de rede: ' + e.type);
      else { onlineClose(); onStatus('Erro de rede: ' + e.type); }
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (x) { /* ok */ } });
  };
  attempt(0);
}

function onlineJoin(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) return onStatus('Digite o código da sala.');
  if (typeof Peer === 'undefined') return onStatus(NO_NET);
  readName(); onlineClose(); ON.code = code; onStatus('Conectando à sala ' + code + '...');
  const peer = new Peer(); ON.peer = peer;
  const timer = setTimeout(() => { if (!ON.lobby) { onlineClose(); onStatus('Tempo esgotado. Confira o código e a internet.'); } }, 15000);
  peer.on('open', () => {
    const conn = peer.connect(ONLINE_PREFIX + code, { reliable: true });
    ON.conn = conn;
    conn.on('open', () => { ON.seen = performance.now(); conn.send({ t: 'hello', name: myName }); });
    conn.on('data', guestRecv);
    conn.on('close', () => { clearTimeout(timer); if (ON.conn === conn) onlineLost('O anfitrião saiu.'); });
    conn.on('error', () => {});
    ON.pendingTimer = timer;
  });
  peer.on('error', e => {
    clearTimeout(timer);
    const msg = e.type === 'peer-unavailable' ? 'Sala não encontrada. Confira o código.' : 'Erro de rede: ' + e.type;
    if (ON.on || ON.lobby) onlineLost(msg); else { onlineClose(); onStatus(msg); }
  });
}

function hostRecv(conn, m) {
  if (!m || typeof m !== 'object') return;
  conn._seen = performance.now();
  if (m.t === 'hello') {
    if (conn._id != null || ON.on || ON.roster.length >= MAX_HUMANS) return;
    const c = teamCounts(), team = c[0] <= c[1] ? 0 : 1, id = ON.nextId++;
    conn._id = id; ON.conns.set(id, conn);
    ON.roster.push({ id, name: cleanName(m.name), team: c[team] >= MAX_TEAM ? 1 - team : team });
    conn.send({ t: 'welcome', id });
    broadcastLobby();
  } else if (m.t === 'team') {
    const r = ON.roster.find(x => x.id === conn._id); if (!r || ON.on) return;
    const nt = m.team ? 1 : 0;
    if (nt !== r.team && teamCounts()[nt] < MAX_TEAM) { r.team = nt; broadcastLobby(); }
  } else if (m.t === 'in' && conn._id != null) {
    const r = ON.inputs[conn._id] || (ON.inputs[conn._id] = { mx: 0, my: 0, holds: {}, e: {} });
    r.mx = clamp(+m.mx || 0, -1, 1); r.my = clamp(+m.my || 0, -1, 1);
    r.holds = { pochete: !!(m.holds && m.holds.pochete), set: !!(m.holds && m.holds.set), spike: !!(m.holds && m.holds.spike) };
    if (m.e) for (const k of ['pochete', 'set', 'spike', 'jump', 'dive']) if (m.e[k]) r.e[k] = true;
  }
}
function hostDrop(conn) {
  const id = conn._id; if (id == null) return;
  conn._id = null; ON.conns.delete(id); delete ON.inputs[id];
  const r = ON.roster.find(x => x.id === id); ON.roster = ON.roster.filter(x => x.id !== id);
  if (ON.on) {
    for (const q of allPlayers) if (q.netId === id) { q.human = false; q.remote = false; q.local = false; }
    if (r) { toast('SAIU', r.name, '#ff9a9a'); }
  } else if (ON.lobby) broadcastLobby();
}
function guestRecv(m) {
  if (!m || typeof m !== 'object') return;
  ON.seen = performance.now();
  switch (m.t) {
    case 'welcome': ON.myId = m.id | 0; ON.guest = true; ON.lobby = true; clearTimeout(ON.pendingTimer); onStatus(''); onView('lobby'); break;
    case 'lobby':
      if (!Array.isArray(m.roster)) return;
      ON.roster = m.roster.map(r => ({ id: r.id | 0, name: cleanName(r.name), team: r.team ? 1 : 0 })); ON.cfg = m.cfg || null;
      { const me = ON.roster.find(r => r.id === ON.myId); if (me) ON.myTeam = me.team; }
      $('onCodeShow').textContent = ON.code || ''; $('onLink').textContent = '';
      renderLobby(); break;
    case 'start': if (Array.isArray(m.humans) && m.cfg) { ON.on = true; applyOnlineMatch(m.cfg, m.humans); } break;
    case 's': if (ON.on) applySnap(m); break;
    case 'full': onlineLost(m.why || 'Sala indisponível.'); break;
  }
}

function applyOnlineMatch(cfg, humans) {
  audioInit();
  S.ui = 'play'; S.paused = false;
  S.size = clamp(cfg.size | 0, 1, 6); S.diff = DIFF[cfg.diff] ? cfg.diff : 'normal';
  S.target = [7, 11, 15].includes(cfg.target) ? cfg.target : 11; S.theme = cfg.theme === 'ginasio' ? 'ginasio' : 'praia';
  const me = humans.find(h => h.id === ON.myId); ON.myTeam = me ? me.team : 0;
  show('menu', false); show('help', false); show('pause', false); show('over', false); show('online', false);
  buildBG();
  startMatch(2, humans.map(h => ({ id: h.id | 0, name: cleanName(h.name), team: h.team ? 1 : 0, idx: h.idx | 0 })));
  ON.inputs = {};
  edgeDown.clear(); edgeUp.clear();
}
function startOnlineHost() {
  if (!ON.host || !ON.conns.size || ON.on) { if (!(ON.host && ON.on)) return; }
  const cfg = { size: effSize(), diff: opts.diff, target: opts.target, theme: opts.theme };
  const next = [0, 0], humans = ON.roster.map(r => ({ id: r.id, name: r.name, team: r.team, idx: next[r.team]++ }));
  ON.on = true; ON.tick = 0; ON.ev.length = 0;
  applyOnlineMatch(cfg, humans);
  const m = { t: 'start', cfg, humans };
  for (const c of ON.conns.values()) if (c.open) { try { c.send(m); } catch (e) { /* ok */ } }
}

function readRemote(p) {
  const r = ON.inputs[p.netId], i = p.input;
  if (!r) { i.mx = i.my = 0; i.pochete = i.set = i.spike = i.jump = i.dive = false; i.holds = {}; i.hold = null; i.aim = null; return; }
  const e = r.e;
  i.mx = r.mx; i.my = r.my;
  i.pochete = !!e.pochete; i.set = !!e.set; i.spike = !!e.spike; i.jump = !!e.jump; i.dive = !!e.dive;
  e.pochete = e.set = e.spike = e.jump = e.dive = false;
  i.holds = r.holds || {}; i.hold = i.holds.spike ? 'spike' : i.holds.set ? 'set' : i.holds.pochete ? 'pochete' : null;
  i.aim = null;
}

const r2 = v => Math.round(v * 100) / 100;
function sendSnap() {
  const b = ball, m = {
    t: 's', sc: S.score, st: S.state, sv: S.serving, ra: S.rally, nw: r2(S.netWob), ov: S.over ? 1 : 0, wi: S.winner, ui: S.ui === 'over' ? 1 : 0, sh: r2(S.shake), pt: r2(S.pointT),
    b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.state, b.lastTeam, b.touches, r2(b.rot)],
    p: allPlayers.map(q => [r2(q.x), r2(q.y), r2(q.z), r2(q.vx), r2(q.vy), r2(q.vz), r2(q.fx), r2(q.fy), q.state, r2(q.hitT), q.hitKind, r2(q.recT), q.intent ? q.intent.type : '']),
    ev: ON.ev.splice(0),
  };
  if (S.state === 'serve' && S.serverP && S.serverP.serve) { const q = S.serverP.serve; m.sp = [S.serverP.team, S.serverP.idx, q.key || '', r2(q.power), r2(q.ty), q.stage]; }
  for (const c of ON.conns.values()) if (c.open) { try { c.send(m); } catch (e) { /* ok */ } }
}
function applySnap(m) {
  if (!Array.isArray(m.b) || !Array.isArray(m.p)) return;
  S.score = m.sc; S.state = m.st; S.serving = m.sv; S.rally = m.ra; S.netWob = m.nw; S.over = !!m.ov; S.winner = m.wi; S.shake = m.sh; S.pointT = m.pt;
  const b = ball;
  [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.state, b.lastTeam, b.touches, b.rot] = m.b;
  m.p.forEach((a, k) => {
    const q = allPlayers[k]; if (!q) return;
    [q.x, q.y, q.z, q.vx, q.vy, q.vz, q.fx, q.fy, q.state, q.hitT, q.hitKind, q.recT] = a;
    q.intent = a[12] ? { type: a[12], t: 0.1 } : null;
  });
  if (m.sp && teams[m.sp[0]] && teams[m.sp[0]].players[m.sp[1]]) {
    const q = teams[m.sp[0]].players[m.sp[1]]; S.serverP = q;
    q.serve = { key: m.sp[2] || null, power: m.sp[3], ty: m.sp[4], stage: m.sp[5] };
  }
  if (Array.isArray(m.ev)) for (const e of m.ev) replay(e);
  if (m.ui && S.ui !== 'over') showOver();
}
function replay(e) {
  switch (e[0]) {
    case 's': sfx(e[1]); break;
    case 'p': puff(e[1], e[2], e[3]); break;
    case 'r': ring(e[1], e[2], e[3], e[4], e[5]); break;
    case 'f': floatText(e[1], e[2], e[3], e[4], e[5], e[6]); break;
    case 't': toast(e[1], e[2], e[3]); break;
  }
}
// entre uma foto e outra o convidado só move as coisas pela velocidade
function guestFrame(dt) {
  S.t += dt;
  const b = ball;
  if (b.state !== 'held') {
    b.x += b.vx * dt; b.y += b.vy * dt; b.vz -= G * dt; b.z += b.vz * dt;
    if (b.z < 0) { b.z = 0; b.vz = 0; }
    b.rot += (b.vx * 0.6 + b.vy * 0.35) * dt;
  }
  if (Math.hypot(b.vx, b.vy, b.vz) > 12) { b.trail.push({ x: b.x, y: b.y, z: b.z }); if (b.trail.length > 7) b.trail.shift(); }
  else if (b.trail.length) b.trail.shift();
  for (const p of allPlayers) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.z > 0 || p.vz > 0) { p.z += p.vz * dt; p.vz -= 18 * dt; if (p.z < 0) { p.z = 0; p.vz = 0; } }
    p.hitT = Math.max(0, p.hitT - dt); p.recT = Math.max(0, p.recT - dt);
    p.anim += Math.hypot(p.vx, p.vy) * dt * 2.2;
  }
  updateFX(dt);
}
// o convidado manda seus comandos ~30 vezes por segundo
setInterval(() => {
  if (!ON.on || !ON.guest || !ON.conn || !ON.conn.open) return;
  const p = allPlayers.find(q => q.local); if (!p) return;
  readHuman(p);
  const i = p.input;
  try { ON.conn.send({ t: 'in', mx: i.mx, my: i.my, holds: i.holds, e: { pochete: i.pochete, set: i.set, spike: i.spike, jump: i.jump, dive: i.dive } }); } catch (e) { /* ok */ }
  edgeDown.clear(); edgeUp.clear();
}, 33);

// "estou vivo": quem fica calado por muito tempo (aba fechada, sem internet) é tirado da sala
setInterval(() => {
  const now = performance.now();
  if (ON.host) {
    for (const c of [...ON.conns.values()]) if (c._seen && now - c._seen > 9000) { hostDrop(c); try { c.close(); } catch (e) { /* ok */ } }
    if (!ON.on) for (const c of ON.conns.values()) if (c.open) { try { c.send({ t: 'ping' }); } catch (e) { /* ok */ } }
  } else if (ON.guest && ON.conn && ON.conn.open) {
    try { ON.conn.send({ t: 'ping' }); } catch (e) { /* ok */ }
    if (ON.seen && now - ON.seen > 12000) onlineLost('Conexão com o anfitrião perdida.');
  }
}, 2000);

$('btnOnline').onclick = () => { show('menu', false); show('online', true); onView('home'); onStatus(''); };
$('btnOnCreate').onclick = onlineCreate;
$('btnOnJoin').onclick = () => onlineJoin($('onCode').value);
$('btnOnStart').onclick = startOnlineHost;
$('btnOnCopy').onclick = () => { const t = $('onLink').textContent; try { navigator.clipboard.writeText(t); onStatus('Link copiado!'); } catch (e) { onStatus(t); } };
$('btnOnBack').onclick = () => { onlineClose(); show('online', false); show('menu', true); onStatus(''); };
for (const id of ['onCode', 'onName']) {
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && id === 'onCode') onlineJoin($('onCode').value); e.stopPropagation(); });
  $(id).addEventListener('keyup', e => e.stopPropagation());
}
$('onName').addEventListener('change', readName);

/* ============================== TOQUE ============================== */
(function touchUI() {
  const body = document.body, zone = $('joyzone'), base = $('joybase'), knob = $('joyknob');
  let jid = null, ox = 0, oy = 0;
  const radius = () => Math.max(46, innerHeight * 0.13);
  function joyMove(e) {
    const R = radius(), dx = e.clientX - ox, dy = e.clientY - oy, len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, R);
    knob.style.transform = `translate(${dx / len * k}px, ${dy / len * k}px)`;
    const m = clamp((len / R - 0.15) / 0.55, 0, 1);            // zona morta e velocidade total a ~70%
    touchMove.on = true; touchMove.x = dx / len * m; touchMove.y = dy / len * m;
  }
  function joyEnd() { jid = null; touchMove.on = false; touchMove.x = touchMove.y = 0; base.classList.remove('on'); knob.style.transform = ''; }
  zone.addEventListener('pointerdown', e => {
    if (jid !== null) return;
    jid = e.pointerId; ox = e.clientX; oy = e.clientY;
    try { zone.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
    base.style.left = ox + 'px'; base.style.top = oy + 'px'; base.classList.add('on');
    joyMove(e); e.preventDefault();
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === jid) joyMove(e); });
  for (const t of ['pointerup', 'pointercancel']) zone.addEventListener(t, e => { if (e.pointerId === jid) joyEnd(); });

  document.querySelectorAll('.tb').forEach(btn => {
    const code = btn.dataset.code;
    const down = e => { e.preventDefault(); if (!keys.has(code)) { keys.add(code); edgeDown.add(code); } btn.classList.add('on'); try { btn.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } };
    const up = e => { e.preventDefault(); if (keys.has(code)) { keys.delete(code); edgeUp.add(code); } btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
  });
  $('btnPauseT').onclick = () => { if (S.ui === 'play' && !ON.on) setPause(!S.paused); };
  const fs = $('btnFull'), root = document.documentElement;
  if (!(root.requestFullscreen || root.webkitRequestFullscreen)) fs.classList.add('hidden');
  fs.onclick = () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        const p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (x) { /* ok */ } }).catch(() => {});
      }
    } catch (x) { /* ok */ }
  };
  document.addEventListener('contextmenu', e => { if (IS_TOUCH) e.preventDefault(); });
  addEventListener('touchstart', () => { if (!IS_TOUCH) { IS_TOUCH = true; fit(); } }, { passive: true });
  // classes no body para o CSS mostrar/esconder os controles
  let lastKey = '';
  setInterval(() => {
    const k = [IS_TOUCH, S.ui, ON.on, S.paused].join();
    if (k === lastKey) return; lastKey = k;
    body.classList.toggle('touch', IS_TOUCH); body.dataset.ui = S.ui;
    body.classList.toggle('online', ON.on); body.classList.toggle('paused', S.paused);
    if (!(IS_TOUCH && S.ui === 'play')) joyEnd();
  }, 150);
})();

/* ============================== LOOP ================================ */
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (ON.on && ON.guest) guestFrame(dt);
  else if (!S.paused) {
    acc += dt; let n = 0;
    while (acc >= DT && n < 12) { step(DT); acc -= DT; n++; }
    if (n >= 12) acc = 0;
  }
  render();
  requestAnimationFrame(frame);
}

/* depuração / teste automático: IA contra IA sem desenhar */
function sim(seconds, diff) {
  const saved = [S.ui, S.diff]; if (diff) S.diff = diff;
  const startScore = S.score.slice();
  let points = 0, lastSum = S.score[0] + S.score[1], longest = 0, rallyStart = S.t, stuck = 0, serves = 0, lastState = S.state;
  for (let k = 0; k < seconds / DT; k++) {
    step(DT);
    if (S.state === 'serve' && lastState !== 'serve') serves++;
    lastState = S.state;
    const sum = S.score[0] + S.score[1];
    if (sum !== lastSum) { points++; longest = Math.max(longest, S.t - rallyStart); lastSum = sum; rallyStart = S.t; }
    if (S.state === 'rally' && S.t - rallyStart > 60) { stuck++; startServe(); rallyStart = S.t; }
  }
  S.ui = saved[0];
  return { points, longestRally: +longest.toFixed(1), stuck, serves, score: S.score.slice() };
}
window.Volei = { S, ball, ON, hostRecv, guestRecv, renderLobby, keys, edgeDown, touchMove, get teams() { return teams; }, step, sim, startMatch, startServe, applySnap, guestFrame };

fit();
S.theme = opts.theme; S.size = opts.size;
refreshSeg();
buildBG();
startMatch(0);
requestAnimationFrame(frame);
{
  const room = new URLSearchParams(location.search).get('sala');
  if (room) { show('menu', false); show('online', true); onView('home'); $('onCode').value = room.toUpperCase(); onlineJoin(room); }
}
})();
