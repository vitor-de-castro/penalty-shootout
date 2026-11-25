import { useEffect, useRef, useState } from "react";
import "./App.css";

const W = 800;
const H = 500;
const TOTAL_SHOTS = 5;
const GOAL = { x: 200, y: 90, w: 400, h: 150 };
const SPOT = { x: 400, y: 410 };

const RUNUP_MS = 600;
const KICK_MS = 160;
const RESULT_MS = 1500;
const DIVE_DELAY = 120;
const DIVE_MS = 520;
const POWER_PERIOD = 1000; // ms for the meter to go 0 -> 1 (normal difficulty)
let powerPeriod = POWER_PERIOD;
const SAVE_MS = 3000; // time you get to pick a dive when you are the keeper
const SLEEVE = 0.55; // 1 = long sleeves

type Mode = "shots" | "survival" | "vs" | "worldcup";
type DiffId = "easy" | "normal" | "hard";
interface InstallEvent extends Event { prompt: () => Promise<void> }
type Phase = "aim" | "power" | "save" | "runup" | "flight" | "result" | "done";
type Outcome = "goal" | "saved" | "missed" | "post" | "bar";
type Point = { x: number; y: number };

interface Team { squad: Player[]; name: string; shirt: string; shorts: string; socks: string; num: string; keeper: string; stripe?: string }
interface Dive { x: number; y: number; rot: number; wide: boolean }
interface Player { n: number; skin: string; hair: string; style: "short" | "long" | "afro" | "buzz" | "bald"; boots: string; h: number }
interface Particle { x: number; y: number; vx: number; vy: number; rot: number; vr: number; c: string; life: number }
interface Score { s: number; t: string; d: string }
interface Scores { shots: Score[]; survival: Score[]; vs: { w: number; l: number }; cup: { t: number; r: number } }
interface Hud { you: number; cpu: number; yourHist: Outcome[]; cpuHist: Outcome[] }
interface Banner { text: string; tone: "good" | "bad" | "neutral" }
interface Finish { title: string; detail: string; newBest: boolean; next?: string; trophy?: boolean }

interface Game {
  mode: Mode;
  phase: Phase;
  t0: number;
  turn: "you" | "cpu";
  hover: Point;
  locked: Point;
  target: Point;
  dive: Dive;
  outcome: Outcome;
  power: number;
  curve: -1 | 0 | 1;      // what the player picked with the buttons
  shotCurve: -1 | 0 | 1;  // the curve of the shot being taken (player or computer)
  flightMs: number;
  you: number;
  cpu: number;
  yourHist: Outcome[];
  cpuHist: Outcome[];
  cheerT: number;
  cheerPower: number;
  cpuTeam: Team;
  takerIdx: number; // which of PLAYERS is taking the current kick
}

// Takers come off the bench in this order: #10 first, then 7, 9, 8, 11, 6...
const NUMBERS = [10, 7, 9, 8, 11, 6];
const SK = { fair: "#ffdbac", light: "#f1c27d", tan: "#e0ac69", olive: "#d09a62", asian: "#f0cfa0", arab: "#c9915c", latino: "#b9803f", brown: "#8d5524", dark: "#6b4220" };
const HAIR = { black: "#14100c", dark: "#2b1b12", brown: "#4a2c17", chestnut: "#7c3f1d", blond: "#d6a84f", ginger: "#b5532a" };
type Look = [string, string, Player["style"], string, number]; // skin, hair, style, boots, height
const squad = (looks: Look[]): Player[] =>
  looks.map(([skin, hair, style, boots, h], i) => ({ n: NUMBERS[i], skin, hair, style, boots, h }));

// Each national team gets a squad that fits it
const SQUADS: Record<string, Player[]> = {
  Brazil: squad([
    [SK.tan, HAIR.black, "short", "#111827", 1.15], [SK.dark, HAIR.black, "buzz", "#f97316", 1.17],
    [SK.light, HAIR.chestnut, "short", "#e5e7eb", 1.2], [SK.brown, HAIR.black, "afro", "#2563eb", 1.13],
    [SK.tan, HAIR.dark, "buzz", "#111827", 1.15], [SK.dark, HAIR.black, "bald", "#22c55e", 1.18],
  ]),
  Argentina: squad([
    [SK.olive, HAIR.black, "short", "#111827", 1.15], [SK.light, HAIR.brown, "long", "#f97316", 1.17],
    [SK.fair, HAIR.chestnut, "short", "#e5e7eb", 1.2], [SK.tan, HAIR.black, "buzz", "#2563eb", 1.13],
    [SK.light, HAIR.dark, "short", "#111827", 1.15], [SK.olive, HAIR.black, "bald", "#22c55e", 1.18],
  ]),
  France: squad([
    [SK.light, HAIR.brown, "short", "#111827", 1.15], [SK.dark, HAIR.black, "buzz", "#f97316", 1.17],
    [SK.tan, HAIR.dark, "short", "#e5e7eb", 1.2], [SK.brown, HAIR.black, "bald", "#2563eb", 1.13],
    [SK.fair, HAIR.chestnut, "short", "#111827", 1.15], [SK.light, HAIR.dark, "short", "#22c55e", 1.18],
  ]),
  England: squad([
    [SK.fair, HAIR.blond, "short", "#111827", 1.15], [SK.light, HAIR.dark, "buzz", "#f97316", 1.17],
    [SK.light, HAIR.brown, "short", "#e5e7eb", 1.2], [SK.brown, HAIR.black, "buzz", "#2563eb", 1.13],
    [SK.fair, HAIR.ginger, "short", "#111827", 1.15], [SK.light, HAIR.black, "bald", "#22c55e", 1.18],
  ]),
  Germany: squad([
    [SK.fair, HAIR.blond, "short", "#111827", 1.15], [SK.tan, HAIR.black, "short", "#f97316", 1.17],
    [SK.light, HAIR.brown, "buzz", "#e5e7eb", 1.2], [SK.fair, HAIR.dark, "short", "#2563eb", 1.13],
    [SK.fair, HAIR.chestnut, "long", "#111827", 1.15], [SK.light, HAIR.dark, "bald", "#22c55e", 1.18],
  ]),
  Netherlands: squad([
    [SK.fair, HAIR.blond, "short", "#111827", 1.15], [SK.light, HAIR.dark, "buzz", "#f97316", 1.17],
    [SK.light, HAIR.brown, "short", "#e5e7eb", 1.2], [SK.dark, HAIR.black, "short", "#2563eb", 1.13],
    [SK.fair, HAIR.chestnut, "short", "#111827", 1.15], [SK.light, HAIR.black, "short", "#22c55e", 1.18],
  ]),
  Portugal: squad([
    [SK.tan, HAIR.black, "short", "#111827", 1.15], [SK.tan, HAIR.black, "buzz", "#f97316", 1.17],
    [SK.light, HAIR.dark, "short", "#e5e7eb", 1.2], [SK.olive, HAIR.brown, "long", "#2563eb", 1.13],
    [SK.tan, HAIR.black, "buzz", "#111827", 1.15], [SK.light, HAIR.brown, "bald", "#22c55e", 1.18],
  ]),
  Italy: squad([
    [SK.olive, HAIR.black, "short", "#111827", 1.15], [SK.light, HAIR.dark, "short", "#f97316", 1.17],
    [SK.fair, HAIR.brown, "long", "#e5e7eb", 1.2], [SK.olive, HAIR.black, "buzz", "#2563eb", 1.13],
    [SK.light, HAIR.chestnut, "short", "#111827", 1.15], [SK.fair, HAIR.dark, "bald", "#22c55e", 1.18],
  ]),
  Japan: squad([
    [SK.asian, HAIR.black, "short", "#111827", 1.1], [SK.asian, HAIR.black, "buzz", "#f97316", 1.12],
    [SK.asian, HAIR.dark, "short", "#e5e7eb", 1.14], [SK.asian, HAIR.black, "long", "#2563eb", 1.09],
    [SK.asian, HAIR.black, "short", "#111827", 1.1], [SK.asian, HAIR.dark, "buzz", "#22c55e", 1.12],
  ]),
  Morocco: squad([
    [SK.arab, HAIR.black, "short", "#111827", 1.15], [SK.arab, HAIR.black, "buzz", "#f97316", 1.17],
    [SK.arab, HAIR.dark, "short", "#e5e7eb", 1.2], [SK.arab, HAIR.black, "short", "#2563eb", 1.13],
    [SK.arab, HAIR.black, "buzz", "#111827", 1.15], [SK.arab, HAIR.dark, "bald", "#22c55e", 1.18],
  ]),
  Mexico: squad([
    [SK.latino, HAIR.black, "short", "#111827", 1.12], [SK.latino, HAIR.dark, "buzz", "#f97316", 1.14],
    [SK.latino, HAIR.black, "long", "#e5e7eb", 1.17], [SK.latino, HAIR.black, "short", "#2563eb", 1.1],
    [SK.latino, HAIR.dark, "short", "#111827", 1.12], [SK.latino, HAIR.black, "buzz", "#22c55e", 1.15],
  ]),
  Spain: squad([
    [SK.olive, HAIR.black, "short", "#111827", 1.15], [SK.light, HAIR.brown, "short", "#f97316", 1.17],
    [SK.olive, HAIR.black, "buzz", "#e5e7eb", 1.2], [SK.tan, HAIR.dark, "long", "#2563eb", 1.13],
    [SK.fair, HAIR.chestnut, "short", "#111827", 1.15], [SK.olive, HAIR.black, "buzz", "#22c55e", 1.18],
  ]),
};

// Plain colour kits (no club crests)
const TEAMS: Team[] = [
  { name: "Brazil", squad: SQUADS.Brazil, shirt: "#facc15", shorts: "#1d4ed8", socks: "#f8fafc", num: "#166534", keeper: "#f97316" },
  { name: "France", squad: SQUADS.France, shirt: "#1e3a8a", shorts: "#f8fafc", socks: "#dc2626", num: "#f8fafc", keeper: "#f97316" },
  { name: "Argentina", squad: SQUADS.Argentina, shirt: "#7dd3fc", stripe: "#f8fafc", shorts: "#111827", socks: "#f8fafc", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Portugal", squad: SQUADS.Portugal, shirt: "#b91c1c", shorts: "#166534", socks: "#b91c1c", num: "#fde047", keeper: "#f97316" },
  { name: "England", squad: SQUADS.England, shirt: "#f8fafc", shorts: "#1e3a8a", socks: "#f8fafc", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Germany", squad: SQUADS.Germany, shirt: "#f1f5f9", shorts: "#111827", socks: "#111827", num: "#111827", keeper: "#f97316" },
  { name: "Netherlands", squad: SQUADS.Netherlands, shirt: "#f97316", shorts: "#f97316", socks: "#f97316", num: "#ffffff", keeper: "#7c3aed" },
  { name: "Spain", squad: SQUADS.Spain, shirt: "#dc2626", shorts: "#1e3a8a", socks: "#1e3a8a", num: "#fde047", keeper: "#f97316" },
  { name: "Italy", squad: SQUADS.Italy, shirt: "#2563eb", shorts: "#f8fafc", socks: "#2563eb", num: "#f8fafc", keeper: "#f97316" },
  { name: "Japan", squad: SQUADS.Japan, shirt: "#172554", shorts: "#172554", socks: "#172554", num: "#f8fafc", keeper: "#f97316" },
  { name: "Morocco", squad: SQUADS.Morocco, shirt: "#c1272d", shorts: "#14532d", socks: "#c1272d", num: "#f8fafc", keeper: "#f97316" },
  { name: "Mexico", squad: SQUADS.Mexico, shirt: "#15803d", shorts: "#f8fafc", socks: "#dc2626", num: "#f8fafc", keeper: "#f97316" },
];

/* ---------- kits that never clash ---------- */

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const colourDist = (a: string, b: string) => {
  const p = rgb(a), q = rgb(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const KEEPER_COLOURS = ["#f97316", "#7c3aed", "#ec4899", "#eab308", "#06b6d4", "#111827"];

// The keeper wears the first colour that is clearly different from the shooter's kit
const keeperMemo = new Map<string, string>();
function keeperKit(def: Team, att: Team): string {
  const key = `${def.name}|${att.name}|${att.shirt}`;
  const hit = keeperMemo.get(key);
  if (hit) return hit;
  const score = (c: string) => Math.min(colourDist(c, att.shirt), colourDist(c, att.stripe ?? att.shirt), colourDist(c, att.shorts) + 40);
  const options = [def.keeper, ...KEEPER_COLOURS];
  const best = options.find((c) => score(c) >= 115) ?? options.reduce((a, b) => (score(b) > score(a) ? b : a));
  keeperMemo.set(key, best);
  return best;
}

// If two outfield shirts look alike, the computer team plays in an away kit
function awayKit(t: Team, vs: Team): Team {
  if (colourDist(t.shirt, vs.shirt) >= 105) return t;
  const away: Team[] = [
    { ...t, stripe: undefined, shirt: "#f8fafc", shorts: t.shirt, socks: t.shirt, num: "#111827" },
    { ...t, stripe: undefined, shirt: "#111827", shorts: "#f8fafc", socks: "#111827", num: "#f8fafc" },
  ];
  return away.find((a) => colourDist(a.shirt, vs.shirt) >= 130) ?? away[1];
}

/* ---------- difficulty ---------- */

const DIFFS: Record<DiffId, { name: string; desc: string; read: number; reach: number; period: number; cpuMin: number; cpuRange: number }> = {
  easy: { name: "Easy", desc: "Slow meter, sleepy keeper", read: 0.08, reach: 0.88, period: 1250, cpuMin: 0.4, cpuRange: 0.55 },
  normal: { name: "Normal", desc: "A fair fight", read: 0.2, reach: 1, period: 1000, cpuMin: 0.55, cpuRange: 0.4 },
  hard: { name: "Hard", desc: "Fast meter, sharp keeper", read: 0.38, reach: 1.12, period: 780, cpuMin: 0.68, cpuRange: 0.22 },
};
let cfg = DIFFS.normal;
const ROUNDS = ["Round of 16", "Quarter-final", "Semi-final", "Final"];
const versus = (m: Mode): m is "vs" | "worldcup" => m === "vs" || m === "worldcup";
const shuffle = <T,>(a: T[]) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
};

let vibOn = true;
const buzz = (p: number | number[]) => {
  if (!vibOn) return;
  try { navigator.vibrate?.(p); } catch { /* not supported */ }
};

const MODES: { id: Mode; name: string; desc: string; icon: string }[] = [
  { id: "worldcup", name: "World Cup", desc: "Win four shootouts to lift the trophy", icon: "🏆" },
  { id: "vs", name: "vs Computer", desc: "Take turns: you shoot, then you keep", icon: "🆚" },
  { id: "shots", name: "5 Shots", desc: "Score as many as you can", icon: "🎯" },
  { id: "survival", name: "Survival", desc: "Keep scoring until you miss", icon: "🔥" },
];

const DEG = Math.PI / 180;
// Where the keeper's body centre ends up for each dive option
const DIVES: Dive[] = [
  { x: 290, y: 218, rot: -80 * DEG, wide: true },  // left low
  { x: 285, y: 162, rot: -62 * DEG, wide: true },  // left high
  { x: 400, y: 195, rot: 0, wide: false },         // stay
  { x: 400, y: 148, rot: 0, wide: false },         // jump
  { x: 510, y: 218, rot: 80 * DEG, wide: true },   // right low
  { x: 515, y: 162, rot: 62 * DEG, wide: true },   // right high
];

// Where the computer likes to shoot
const CPU_AIMS: Point[] = [
  { x: 255, y: 215 }, { x: 255, y: 135 }, { x: 400, y: 125 },
  { x: 400, y: 215 }, { x: 545, y: 215 }, { x: 545, y: 135 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const nearestDive = (p: Point) =>
  DIVES.reduce((best, d) => (Math.hypot(d.x - p.x, d.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? d : best));

function newGame(mode: Mode, cpuTeam: Team): Game {
  return {
    mode, phase: "aim", t0: 0, turn: "you",
    hover: { x: 400, y: 150 }, locked: { x: 400, y: 150 }, target: { x: 400, y: 150 },
    dive: DIVES[2], outcome: "goal", power: 0.8, curve: 0, shotCurve: 0, flightMs: 700,
    you: 0, cpu: 0, yourHist: [], cpuHist: [], cheerT: -1e9, cheerPower: 0, cpuTeam, takerIdx: 0,
  };
}

// keeper progress (0..1) after `ms` since the kick
const diveProgress = (ms: number) => ease(clamp((ms - DIVE_DELAY) / DIVE_MS));

function keeperPose(d: Dive, dp: number) {
  return {
    x: lerp(400, d.x, dp),
    y: lerp(195, d.y, dp) - Math.sin(Math.PI * dp) * (d.wide ? 14 : 26),
    rot: d.rot * dp,
    raise: d.wide || d.y < 190 ? dp : dp * 0.6,
  };
}

const powerAt = (now: number, t0: number) => {
  const x = ((now - t0) / powerPeriod) % 2;
  return x < 1 ? x : 2 - x;
};

/* ---------- storage ---------- */

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function loadScores(): Scores {
  const list = (key: string): Score[] => {
    try {
      const v = JSON.parse(load(key) ?? "[]");
      return Array.isArray(v) ? (v as Score[]) : [];
    } catch { return []; }
  };
  let vs = { w: 0, l: 0 };
  try {
    const v = JSON.parse(load("ps-vs") ?? "null");
    if (v && typeof v.w === "number" && typeof v.l === "number") vs = v;
  } catch { /* ignore */ }
  let cup = { t: 0, r: -1 };
  try {
    const v = JSON.parse(load("ps-cup") ?? "null");
    if (v && typeof v.t === "number" && typeof v.r === "number") cup = v;
  } catch { /* ignore */ }
  return { shots: list("ps-hs-shots"), survival: list("ps-hs-survival"), vs, cup };
}

/* ---------- sound (synthesised, no files) ---------- */

let actx: AudioContext | null = null;
let muted = false;
let ambient: GainNode | null = null;

function ac(): AudioContext | null {
  if (!actx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    actx = new Ctor();
  }
  if (actx.state === "suspended") void actx.resume();
  return actx;
}

function noiseBuffer(c: AudioContext, dur: number) {
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, attack = 0.01, delay = 0) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(gain).connect(c.destination);
  src.start(t);
}

// Soft crowd murmur that runs under the game
function applyAmbient() {
  const c = ac();
  if (!c) return;
  if (!ambient) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 3);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 520;
    f.Q.value = 0.5;
    ambient = c.createGain();
    ambient.gain.value = 0;
    src.connect(f).connect(ambient).connect(c.destination);
    src.start();
  }
  ambient.gain.setTargetAtTime(muted ? 0 : 0.04, c.currentTime, 0.2);
}

// A stadium roar made only of crowd-like noise (no synth tones): voices gliding
// upward, a low rumble, scattered shouts and applause
function roar(strength: number) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime;
  const dur = 1.0 + strength * 1.4;
  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.exponentialRampToValueAtTime(0.55 * strength, t + 0.14);
  master.gain.setValueAtTime(0.55 * strength, t + dur * 0.45);
  master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  master.connect(c.destination);

  const layer = (from: number, to: number, q: number, vol: number) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
    bp.Q.value = q;
    const wobble = c.createGain();
    const curve = new Float32Array(60);
    for (let i = 0; i < curve.length; i++) curve[i] = (0.55 + Math.random() * 0.45) * vol;
    wobble.gain.setValueCurveAtTime(curve, t, dur);
    src.connect(bp).connect(wobble).connect(master);
    src.start(t);
  };
  layer(500, 780, 3, 0.55);   // "aaah"
  layer(1000, 1500, 3, 0.4);
  layer(1900, 2600, 2, 0.2);  // brightness

  // low rumble of stamping feet
  const rumble = c.createBufferSource();
  rumble.buffer = noiseBuffer(c, dur);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 170;
  const rg = c.createGain();
  rg.gain.value = 0.5;
  rumble.connect(lp).connect(rg).connect(master);
  rumble.start(t);

  // individual shouts
  for (let i = 0; i < 6; i++) noise(0.2 + Math.random() * 0.15, 0.16 * strength, "bandpass", 700 + Math.random() * 900, 0.03, Math.random() * dur * 0.6);
  // applause
  const claps = Math.round(26 * strength);
  for (let i = 0; i < claps; i++) noise(0.035, 0.09 * strength, "highpass", 1800, 0.002, 0.4 + Math.random() * dur);
}

const sfx = {
  // Referee's pea whistle: ~2.9 kHz with the fast trill of the pea and some breath
  whistle() {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const dur = 0.55;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
    out.gain.setValueAtTime(0.2, t + dur - 0.1);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const trill = c.createGain();
    trill.gain.value = 0.7;
    const lfo = c.createOscillator();
    lfo.frequency.value = 38;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(trill.gain);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 5;
    for (const f of [2880, 2915]) {
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(2600, t);
      osc.frequency.linearRampToValueAtTime(f, t + 0.06);
      osc.frequency.linearRampToValueAtTime(f * 0.985, t + dur);
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    bp.connect(trill).connect(out).connect(c.destination);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    noise(dur, 0.05, "bandpass", 3300, 0.03);
  },
  kick() { noise(0.09, 0.5, "lowpass", 500); tone(160, 0.14, "sine", 0.5, 45); },
  net() { noise(0.35, 0.12, "bandpass", 1800, 0.01); tone(95, 0.14, "sine", 0.4, 55); },
  slap() { noise(0.07, 0.4, "bandpass", 1500); },
  bar() { tone(520, 0.6, "sine", 0.3, 420); tone(1040, 0.35, "triangle", 0.12); noise(0.06, 0.35, "bandpass", 1800); },
  post() { tone(1300, 0.5, "sine", 0.25, 1100); tone(2600, 0.3, "sine", 0.1); noise(0.05, 0.3, "bandpass", 3000); },
  // Disappointment: the crowd's sinking "awww"
  sad() {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime;
    const dur = 1.5;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(950, t);
    bp.frequency.exponentialRampToValueAtTime(330, t + dur);
    bp.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.15);
    g.gain.setValueAtTime(0.45, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t);
  },
  // A very short happy jingle for your goals
  jingle() {
    const notes: [number, number][] = [[659.25, 0.08], [783.99, 0.08], [1046.5, 0.08], [1318.5, 0.3]];
    let at = 0.05;
    for (const [f, d] of notes) {
      tone(f, d * 1.8, "triangle", 0.16, undefined, at);
      tone(f, d * 1.8, "square", 0.035, undefined, at);
      at += d;
    }
  },
  // Victory: a bright, bouncy little fanfare
  fanfare() {
    const melody: [number, number][] = [
      [523.25, 0.14], [659.25, 0.14], [783.99, 0.14], [1046.5, 0.28],
      [783.99, 0.14], [1046.5, 0.14], [1318.5, 0.8],
    ];
    let at = 0.5;
    let last = at;
    for (const [f, d] of melody) {
      tone(f, d * 1.7, "triangle", 0.18, undefined, at);
      tone(f, d * 1.7, "square", 0.04, undefined, at);
      last = at;
      at += d;
    }
    for (const f of [523.25, 659.25, 783.99, 1046.5]) tone(f, 1.1, "triangle", 0.09, undefined, last);
    tone(130.81, 1.2, "triangle", 0.2, undefined, last);
  },
  end(win: boolean) {
    sfx.whistle();
    if (win) { roar(1); sfx.fanfare(); } else sfx.sad();
  },
};

/* ---------- crowd ---------- */

const PALETTE = ["#ef4444", "#3b82f6", "#f59e0b", "#22c55e", "#e5e7eb", "#a855f7", "#14b8a6"];
const SKINS = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
interface Fan { x: number; y: number; c: number; k: number; s: number; ph: number; arm: boolean }

const FANS: Fan[] = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const fans: Fan[] = [];
  for (let row = 0; row < 3; row++) {
    for (let x = (row % 2) * 7; x < W + 10; x += 15) {
      fans.push({
        x: x + rnd() * 4, y: 12 + row * 17, c: rnd(),
        k: Math.floor(rnd() * PALETTE.length), s: Math.floor(rnd() * SKINS.length),
        ph: rnd() * 6.28, arm: rnd() < 0.6,
      });
    }
  }
  return fans;
})();

function drawCrowd(ctx: CanvasRenderingContext2D, now: number, level: number, mine: Team, other: Team) {
  ctx.fillStyle = "#08200f";
  ctx.fillRect(0, 0, W, 62);
  for (const f of FANS) {
    const bob = Math.sin(now / 260 + f.ph) * 1.2 + level * Math.abs(Math.sin(now / 110 + f.ph)) * 7;
    const y = f.y - bob;
    const color = f.c < 0.3 ? mine.shirt : f.c < 0.45 ? other.shirt : PALETTE[f.k];
    const skin = SKINS[f.s];
    if (level > 0.15 && f.arm) {
      ctx.strokeStyle = skin;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f.x - 5, y + 7); ctx.lineTo(f.x - 8, y - 9 * level);
      ctx.moveTo(f.x + 5, y + 7); ctx.lineTo(f.x + 8, y - 9 * level);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.fillRect(f.x - 5, y + 4, 10, 13);
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(f.x, y, 4.6, 0, Math.PI * 2); ctx.fill();
  }
  // waving flags
  const flags = [90, 250, 560, 715];
  flags.forEach((fx, i) => {
    const wave = Math.sin(now / 150 + fx) * 3;
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, 60); ctx.lineTo(fx, 16); ctx.stroke();
    ctx.fillStyle = i % 2 === 0 ? mine.shirt : other.shirt;
    ctx.beginPath();
    ctx.moveTo(fx, 16); ctx.lineTo(fx + 24 + wave, 20 + wave * 0.4); ctx.lineTo(fx, 30);
    ctx.closePath(); ctx.fill();
  });
}

/* ---------- drawing helpers ---------- */

function drawPitch(ctx: CanvasRenderingContext2D, now: number, level: number, mine: Team, other: Team) {
  ctx.fillStyle = "#0c3a20";
  ctx.fillRect(0, 0, W, 240);
  drawCrowd(ctx, now, level, mine, other);
  // floodlight glow
  for (const gx of [70, W - 70]) {
    const glow = ctx.createRadialGradient(gx, 0, 10, gx, 0, 260);
    glow.addColorStop(0, "rgba(255,255,230,0.22)");
    glow.addColorStop(1, "rgba(255,255,230,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 240);
  }
  // advertising boards
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 60, W, 28);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 60, W, 2);
  for (let x = 10, i = 0; x < W; x += 120, i++) {
    ctx.fillStyle = i % 2 === 0 ? "#2563eb" : "#475569";
    ctx.fillRect(x, 67, 90, 14);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(x + 10, 72, 40, 4);
  }

  // grass with mowing stripes that get wider towards the camera
  const grass = ctx.createLinearGradient(0, 240, 0, H);
  grass.addColorStop(0, "#15803d");
  grass.addColorStop(1, "#166534");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 240, W, H - 240);
  const bands = 8;
  for (let k = 0; k < bands; k += 2) {
    const y0 = 240 + (H - 240) * Math.pow(k / bands, 1.5);
    const y1 = 240 + (H - 240) * Math.pow((k + 1) / bands, 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    ctx.fillRect(0, y0, W, y1 - y0);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 240); ctx.lineTo(W, 240); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(290, 240); ctx.lineTo(270, 295); ctx.lineTo(530, 295); ctx.lineTo(510, 240); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(120, 240); ctx.lineTo(70, 475); ctx.moveTo(680, 240); ctx.lineTo(730, 475); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(SPOT.x, SPOT.y + 12, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
}

// Goal net with depth: a smaller back panel, side and roof nets
function drawNet(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = GOAL;
  const inset = 26, rise = 14;
  const bx = x + inset, by = y + rise, bw = w - inset * 2, bh = h - rise;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(bx + bw, by); ctx.lineTo(bx, by); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.lineTo(bx, by + bh); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let gx = bx; gx <= bx + bw; gx += 14) { ctx.beginPath(); ctx.moveTo(gx, by); ctx.lineTo(gx, by + bh); ctx.stroke(); }
  for (let gy = by; gy <= by + bh; gy += 14) { ctx.beginPath(); ctx.moveTo(bx, gy); ctx.lineTo(bx + bw, gy); ctx.stroke(); }
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(x + (w * i) / 8, y); ctx.lineTo(bx + (bw * i) / 8, by); ctx.stroke();
  }
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (h * i) / 6); ctx.lineTo(bx, by + (bh * i) / 6);
    ctx.moveTo(x + w, y + (h * i) / 6); ctx.lineTo(bx + bw, by + (bh * i) / 6);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(bx, by, bw, bh);
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  const { x, y, w, h } = GOAL;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  for (const px of [x, x + w]) { ctx.beginPath(); ctx.ellipse(px, y + h + 3, 15, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const frame = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h);
  };
  frame();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 8;
  ctx.stroke();
  frame();
  ctx.strokeStyle = "rgba(100,116,139,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/* ----- people: flat colours with a clean dark outline ----- */

const OUTLINE = "rgba(0,0,0,0.3)";

// a limb drawn as a thick line with an outline underneath
function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string) {
  ctx.lineCap = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 2.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

// a rectangle with an outline underneath
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x - 1.2, y - 1.2, w + 2.4, h + 2.4);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawKeeper(
  ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, raise: number, now: number,
  color: string, skin: string, hair: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineCap = "round";
  // legs: thigh, sock, boot
  for (const side of [-1, 1]) {
    box(ctx, side * 6 - 5, 16, 10, 12, skin);
    box(ctx, side * 6 - 5, 28, 10, 16, "#e5e7eb");
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(side * 6 - 5, 28, 10, 3);
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.ellipse(side * 6, 46, 8.2, 5.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath(); ctx.ellipse(side * 6, 46, 7, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // shorts
  box(ctx, -14, 3, 28, 16, "#1f2937");
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-1, 10, 2, 9);
  // shirt
  const shirt = () => {
    ctx.beginPath();
    ctx.moveTo(-15, -31); ctx.lineTo(15, -31); ctx.lineTo(13, 6); ctx.lineTo(-13, 6);
    ctx.closePath();
  };
  shirt();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(-5, -32, 10, 4);
  ctx.font = "bold 15px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("1", 0, -8);
  // arms + gloves
  const bob = Math.sin(now / 160) * 3 * (1 - raise);
  for (const side of [-1, 1]) {
    const gx = lerp(side * 32, side * 10, raise);
    const gy = lerp(-4 + bob, -68, raise);
    limb(ctx, side * 14, -26, gx, gy, 8, color);
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(gx, gy, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // head: no ears, simple face
  box(ctx, -4, -36, 8, 6, skin);
  ctx.fillStyle = skin;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(0, -43, 9.5, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.ellipse(0, -46, 10, 9, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath(); ctx.arc(-3.5, -41.5, 1.3, 0, Math.PI * 2); ctx.arc(3.5, -41.5, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = hair;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-5.5, -44.5); ctx.lineTo(-1.8, -44.5);
  ctx.moveTo(1.8, -44.5); ctx.lineTo(5.5, -44.5);
  ctx.stroke();
  ctx.strokeStyle = "rgba(90,50,20,0.7)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-2.5, -36.5); ctx.lineTo(2.5, -36.5); ctx.stroke();
  ctx.restore();
}

function drawTaker(
  ctx: CanvasRenderingContext2D, x: number, y: number, sc: number, swing: number, kick: number | null,
  kit: Team, celebrate: number, p: Player, moving: boolean,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(0, 2, 26, 6, 0, 0, Math.PI * 2); ctx.fill();

  // leg angles (a) and knee bends (b)
  let aL: number, aR: number, bL: number, bR: number;
  if (kick === null) {
    if (moving) {
      aL = Math.sin(swing) * 0.7; aR = -aL;
      bL = 0.7 * (0.5 + 0.5 * Math.cos(swing)); bR = 0.7 * (0.5 - 0.5 * Math.cos(swing));
    } else { aL = 0.04; aR = -0.04; bL = 0.05; bR = 0.05; }
  } else {
    const e = 1 - (1 - kick) * (1 - kick);
    aL = 0.05; bL = 0.08;
    aR = lerp(lerp(-0.95, 1.15, e), 0.08, celebrate);
    bR = lerp(lerp(1.25, 0.05, e), 0.05, celebrate);
  }

  const hipY = -52, THIGH = 27, CALF = 27;
  const leg = (hx: number, a: number, b: number) => {
    const kx = hx + Math.sin(a) * THIGH, ky = hipY + Math.cos(a) * THIGH;
    const ca = a - b;
    const fx = kx + Math.sin(ca) * CALF, fy = ky + Math.cos(ca) * CALF;
    limb(ctx, hx, hipY, kx, ky, 11, p.skin);
    limb(ctx, kx, ky, fx, fy, 8, p.skin);
    // sock with a turned-over top
    const top = { x: lerp(fx, kx, 0.82), y: lerp(fy, ky, 0.82) };
    const rim = { x: lerp(fx, kx, 0.9), y: lerp(fy, ky, 0.9) };
    ctx.lineCap = "butt";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 11.4;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(rim.x, rim.y); ctx.stroke();
    ctx.strokeStyle = kit.socks;
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(top.x, top.y); ctx.stroke();
    ctx.strokeStyle = kit.num;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rim.x, rim.y); ctx.stroke();
    ctx.lineCap = "round";
    // boot
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.ellipse(fx, fy + 1, 9.7, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.boots;
    ctx.beginPath(); ctx.ellipse(fx, fy + 1, 8.5, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(fx - 8, fy + 4, 16, 2);
  };
  leg(-6, aL, bL);
  leg(6, aR, bR);

  // shorts: flat colour, thin trim on the sides
  box(ctx, -15, -64, 14, 22, kit.shorts);
  box(ctx, 1, -64, 14, 22, kit.shorts);
  box(ctx, -15, -64, 30, 8, kit.shorts);
  ctx.fillStyle = kit.shirt;
  ctx.fillRect(-15, -62, 2, 20);
  ctx.fillRect(13, -62, 2, 20);

  // shirt: flat colour (stripes only where the kit has them), collar, number
  const shirt = () => {
    ctx.beginPath();
    ctx.moveTo(-16, -95); ctx.lineTo(16, -95); ctx.lineTo(14, -57); ctx.lineTo(-14, -57);
    ctx.closePath();
  };
  shirt();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = kit.shirt;
  ctx.fill();
  if (kit.stripe) {
    ctx.save();
    shirt();
    ctx.clip();
    ctx.fillStyle = kit.stripe;
    ctx.fillRect(-9, -96, 6, 40);
    ctx.fillRect(3, -96, 6, 40);
    ctx.restore();
  }
  ctx.fillStyle = kit.shorts;
  ctx.fillRect(-6, -96, 12, 4);
  ctx.font = "bold 20px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.strokeText(String(p.n), 0, -68);
  ctx.fillStyle = kit.num;
  ctx.fillText(String(p.n), 0, -68);

  // arms: skin, short sleeve, hand
  for (const side of [-1, 1]) {
    const base = kick === null ? (side === -1 ? -aL : -aR) * 0.8 : side * 0.9;
    const a = lerp(base, side * (Math.PI - 0.45), celebrate);
    const sx = side * 16;
    const sy = -91;
    const ex = sx + Math.sin(a) * 27 + side * 4 * (1 - celebrate);
    const ey = sy + Math.cos(a) * 27;
    limb(ctx, sx, sy, ex, ey, 7, p.skin);
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, Math.PI * 2); ctx.fill();
    limb(ctx, sx, sy, lerp(sx, ex, SLEEVE), lerp(sy, ey, SLEEVE), 10, kit.shirt);
  }

  // neck and head, seen from behind (no ears)
  box(ctx, -4, -101, 8, 9, p.skin);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  if (p.style === "afro") {
    ctx.fillStyle = p.hair;
    ctx.beginPath(); ctx.arc(0, -109, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (p.style === "long") {
    ctx.fillStyle = p.hair;
    ctx.beginPath();
    ctx.moveTo(-10, -106); ctx.lineTo(-9, -86); ctx.quadraticCurveTo(0, -81, 9, -86); ctx.lineTo(10, -106);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, -106, 10, 11.5, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = p.style === "bald" ? p.skin : p.style === "buzz" ? p.skin : p.hair;
    ctx.beginPath(); ctx.ellipse(0, -106, 10, 11.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.style === "buzz") {
      ctx.fillStyle = p.hair;
      ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.ellipse(0, -106, 10, 11.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function pentagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * 2 * Math.PI) / 5;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// A proper football: shaded sphere, black pentagons, seams, rolling with the spin
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, shadow?: Point) {
  if (shadow) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  const base = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  base.addColorStop(0, "#ffffff");
  base.addColorStop(0.65, "#eceff3");
  base.addColorStop(1, "#aab2bd");
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(Math.sin(spin * 0.8) * r * 0.22, Math.cos(spin * 0.6) * r * 0.14);
  ctx.fillStyle = "#1b1f27";
  ctx.strokeStyle = "rgba(40,46,58,0.85)";
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  pentagon(ctx, 0, 0, r * 0.34, spin);
  ctx.fill();
  const outer = (k: number, j: number) => {
    const th = spin + (k * 2 * Math.PI) / 5;
    const a = th + Math.PI + (j * 2 * Math.PI) / 5;
    return { x: Math.cos(th) * r * 0.92 + Math.cos(a) * r * 0.3, y: Math.sin(th) * r * 0.92 + Math.sin(a) * r * 0.3 };
  };
  for (let k = 0; k < 5; k++) {
    const th = spin + (k * 2 * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(th) * r * 0.34, Math.sin(th) * r * 0.34);
    ctx.lineTo(Math.cos(th) * r * 0.62, Math.sin(th) * r * 0.62);
    ctx.stroke();
    const from = outer(k, 4), to = outer((k + 1) % 5, 1);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    pentagon(ctx, Math.cos(th) * r * 0.92, Math.sin(th) * r * 0.92, r * 0.3, th + Math.PI);
    ctx.fill();
  }
  ctx.restore();

  const shade = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
  shade.addColorStop(0, "rgba(255,255,255,0.35)");
  shade.addColorStop(0.5, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.9)";
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 24, y); ctx.lineTo(x - 8, y);
  ctx.moveTo(x + 8, y); ctx.lineTo(x + 24, y);
  ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 8);
  ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 24);
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 18;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(cx - w / 2, y - 14, w, 20);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, cx, y);
}

function drawMeter(ctx: CanvasRenderingContext2D, cx: number, v: number) {
  const w = 260, h = 18, x = cx - w / 2, y = 16;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  const zones: [number, number, string][] = [
    [0, 0.45, "#f59e0b"], [0.45, 0.7, "#eab308"], [0.7, 0.86, "#22c55e"], [0.86, 1, "#ef4444"],
  ];
  for (const [a, b, c] of zones) {
    ctx.fillStyle = c;
    ctx.fillRect(x + a * w, y, (b - a) * w, h);
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + v * w - 3, y - 6, 6, h + 12);
  drawLabel(ctx, "TAP TO STOP IN THE GREEN", cx, y + h + 26);
}

function drawCountdown(ctx: CanvasRenderingContext2D, cx: number, frac: number) {
  const w = 260, h = 10, x = cx - w / 2, y = 20;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = frac > 0.3 ? "#22c55e" : "#ef4444";
  ctx.fillRect(x, y, w * frac, h);
  drawLabel(ctx, "YOU'RE THE KEEPER: PICK A DIVE", cx, y + h + 26);
}

/* ---------- component ---------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewW = useRef(W);
  const aiming = useRef(false);
  const particles = useRef<Particle[]>([]);
  const lastNow = useRef(0);

  const [screen, setScreen] = useState<"menu" | "game">("menu");
  const [team, setTeam] = useState<Team>(() => TEAMS.find((t) => t.name === load("ps-team")) ?? TEAMS[0]);
  const [mode, setMode] = useState<Mode>(() => MODES.find((m) => m.id === load("ps-mode"))?.id ?? "shots");
  const [scores, setScores] = useState<Scores>(loadScores);
  const [hud, setHud] = useState<Hud>({ you: 0, cpu: 0, yourHist: [], cpuHist: [] });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [finish, setFinish] = useState<Finish | null>(null);
  const [ui, setUi] = useState<Phase>("aim");
  const [curve, setCurve] = useState<-1 | 0 | 1>(0);
  const [mute, setMute] = useState(() => load("ps-mute") === "1");
  const [vib, setVib] = useState(() => load("ps-vib") !== "0");
  const [diff, setDiff] = useState<DiffId>(() => { const d = load("ps-diff"); return d === "easy" || d === "hard" ? d : "normal"; });
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const cup = useRef<{ round: number; opps: Team[] }>({ round: 0, opps: [] });
  const trail = useRef<{ x: number; y: number; r: number }[]>([]);

  const g = useRef<Game>(newGame(mode, TEAMS[1]));
  const teamRef = useRef(team);
  const scoresRef = useRef(scores);
  teamRef.current = team;
  scoresRef.current = scores;
  muted = mute;
  vibOn = vib;

  // The animation loop lives in an effect that only runs once, so it calls the
  // latest versions of these functions through this ref.
  const api = useRef({
    flightEnd: (_now: number) => {},
    resultEnd: (_now: number) => {},
    saveTimeout: () => {},
    key: (_e: KeyboardEvent) => {},
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    // On narrow screens show only the middle of the pitch so the goal is bigger
    const resize = () => {
      viewW.current = window.innerWidth < 640 ? 560 : W;
      canvas.width = viewW.current;
      canvas.height = H;
    };
    resize();
    window.addEventListener("resize", resize);
    const onKey = (e: KeyboardEvent) => api.current.key(e);
    window.addEventListener("keydown", onKey);
    const onInstall = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallEvent); };
    const onInstalled = () => setInstallEvt(null);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);

    const update = (now: number) => {
      const s = g.current;
      if (s.phase === "runup" && now - s.t0 >= RUNUP_MS) {
        s.phase = "flight";
        s.t0 = now;
        setUi("flight");
        sfx.kick();
        buzz(15);
      } else if (s.phase === "flight" && now - s.t0 >= s.flightMs) {
        api.current.flightEnd(now);
      } else if (s.phase === "result" && now - s.t0 >= RESULT_MS) {
        api.current.resultEnd(now);
      } else if (s.phase === "save" && now - s.t0 >= SAVE_MS) {
        api.current.saveTimeout();
      }
    };

    const draw = (now: number) => {
      const s = g.current;
      const mine = teamRef.current;
      const other = s.cpuTeam;
      const kicker = s.turn === "you" ? mine : other;
      const keeperColor = s.turn === "you" ? keeperKit(other, mine) : keeperKit(mine, other);
      const el = now - s.t0;
      const dt = Math.min(0.05, (now - lastNow.current) / 1000);
      lastNow.current = now;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      const hitIt = s.outcome === "goal" || s.outcome === "post" || s.outcome === "bar";
      const sh = s.phase === "result" && hitIt && el < 280 ? (1 - el / 280) * 4 : 0;
      ctx.translate(-(W - viewW.current) / 2 + (Math.random() - 0.5) * sh * 2, (Math.random() - 0.5) * sh * 2);
      const level = s.cheerPower * clamp(1 - (now - s.cheerT) / 2600);
      drawPitch(ctx, now, level, mine, other);
      drawNet(ctx);

      // keeper
      let pose = { x: 400, y: 195, rot: 0, raise: 0 };
      if (s.phase === "flight") pose = keeperPose(s.dive, diveProgress(el));
      else if (s.phase === "result") pose = keeperPose(s.dive, diveProgress(s.flightMs + el));
      else if (s.phase === "done") pose = keeperPose(s.dive, 1);
      else { pose.x = 400 + Math.sin(now / 220) * 8; pose.y = 195 + Math.sin(now / 300) * 2; }
      const keeperLook = (s.turn === "you" ? other : mine).squad[4];
      drawKeeper(ctx, pose.x, pose.y, pose.rot, pose.raise, now, keeperColor, keeperLook.skin, keeperLook.hair);
      drawFrame(ctx);

      // taker
      const scored = s.outcome === "goal" && (s.phase === "result" || s.phase === "done");
      let tx = 300, ty = 492, swing = 0, kick: number | null = null, celebrate = 0;
      if (s.phase === "runup") {
        const p = clamp(el / RUNUP_MS);
        tx = lerp(300, 362, p);
        ty = lerp(492, 438, p);
        swing = el * 0.022;
        if (el > RUNUP_MS - KICK_MS) kick = clamp((el - (RUNUP_MS - KICK_MS)) / KICK_MS);
      } else if (s.phase === "flight" || s.phase === "result" || s.phase === "done") {
        tx = 362; ty = 438; kick = 1;
        if (scored) {
          celebrate = 1;
          if (s.phase === "result" && el < 1300) ty -= Math.abs(Math.sin(el / 140)) * 20;
        }
      }
      const preKick = s.phase === "aim" || s.phase === "power" || s.phase === "save" || s.phase === "runup";

      // ball
      let bx = SPOT.x, by = SPOT.y, br = 11, spin = 0;
      let shadow: Point | undefined;
      if (s.phase === "flight") {
        const p = clamp(el / s.flightMs);
        bx = lerp(SPOT.x, s.target.x, p) + s.shotCurve * 70 * Math.sin(Math.PI * p);
        const ground = lerp(SPOT.y, s.target.y, p);
        by = ground - Math.sin(Math.PI * p) * lerp(95, 45, s.power);
        br = lerp(11, 6.5, p);
        spin = p * 14 * (s.shotCurve === 0 ? 1 : 2.2);
        shadow = { x: bx, y: ground + 8 };
      } else if (s.phase === "result" || s.phase === "done") {
        const d = s.phase === "done" ? RESULT_MS : el;
        br = 6.5;
        spin = 14 + d * 0.01;
        if (s.outcome === "goal") {
          bx = s.target.x;
          by = Math.min(s.target.y + d * 0.02, GOAL.y + GOAL.h - 6);
        } else if (s.outcome === "saved") {
          const dir = s.target.x >= s.dive.x ? 1 : -1;
          bx = s.target.x + dir * d * 0.1;
          by = Math.min(s.target.y + d * 0.06, 270);
        } else if (s.outcome === "post" || s.outcome === "bar") {
          bx = s.target.x + (SPOT.x - s.target.x) * d * 0.0004;
          by = s.target.y + (SPOT.y - s.target.y) * d * 0.0006;
        } else {
          bx = s.target.x + (s.target.x - 400) * d * 0.0004;
          by = s.target.y - d * 0.04;
          br = Math.max(3.5, 6.5 - d * 0.002);
        }
      }

      if (s.phase === "flight") {
        trail.current.push({ x: bx, y: by, r: br });
        if (trail.current.length > 9) trail.current.shift();
        trail.current.forEach((p, i, a) => {
          ctx.fillStyle = `rgba(255,255,255,${(i / a.length) * 0.3})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.35 + 0.5 * (i / a.length)), 0, Math.PI * 2); ctx.fill();
        });
      } else trail.current.length = 0;
      if (preKick) drawBall(ctx, bx, by, br, spin);
      const player = kicker.squad[s.takerIdx];
      const moving = s.phase === "runup" && kick === null;
      drawTaker(ctx, tx, ty, player.h, swing, s.phase === "aim" || s.phase === "power" || s.phase === "save" ? null : kick, kicker, celebrate, player, moving);
      if (!preKick) drawBall(ctx, bx, by, br, spin, shadow);

      if (s.phase === "aim") drawReticle(ctx, s.hover.x, s.hover.y, "#fde047");
      if (s.phase === "power") {
        // dotted preview of the curved path
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        for (let i = 1; i < 14; i++) {
          const p = i / 14;
          const px = lerp(SPOT.x, s.locked.x, p) + s.curve * 70 * Math.sin(Math.PI * p);
          const py = lerp(SPOT.y, s.locked.y, p) - Math.sin(Math.PI * p) * 60;
          ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        drawReticle(ctx, s.locked.x, s.locked.y, "#4ade80");
      }
      if (s.phase === "save") {
        // the six places you can dive to; the closest one to the pointer lights up
        const hot = nearestDive(s.hover);
        for (const d of DIVES) {
          const on = d === hot;
          ctx.fillStyle = on ? "rgba(253,224,71,0.45)" : "rgba(255,255,255,0.14)";
          ctx.strokeStyle = on ? "#fde047" : "rgba(255,255,255,0.6)";
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(d.x, d.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }

      // confetti
      for (const p of particles.current) {
        p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-4, -2, 8, 4);
        ctx.restore();
      }
      particles.current = particles.current.filter((p) => p.life > 0 && p.y < H + 10);
      ctx.restore();

      // soft vignette
      const vw = viewW.current;
      const vg = ctx.createRadialGradient(vw / 2, H * 0.5, H * 0.35, vw / 2, H * 0.5, Math.max(vw, H) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, H);

      if (s.phase === "power") drawMeter(ctx, viewW.current / 2, powerAt(now, s.t0));
      if (s.phase === "save") drawCountdown(ctx, viewW.current / 2, clamp(1 - el / SAVE_MS));
    };

    const frame = (now: number) => {
      update(now);
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /* ----- game flow ----- */

  function syncHud() {
    const s = g.current;
    setHud({ you: s.you, cpu: s.cpu, yourHist: [...s.yourHist], cpuHist: [...s.cpuHist] });
  }

  function spawnConfetti() {
    const s = g.current;
    const colors = [teamRef.current.shirt, "#ffffff", "#fde047", s.cpuTeam.shirt];
    for (let i = 0; i < 70; i++) {
      particles.current.push({
        x: GOAL.x + Math.random() * GOAL.w, y: GOAL.y - 10,
        vx: (Math.random() - 0.5) * 280, vy: -120 - Math.random() * 260,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
        c: colors[Math.floor(Math.random() * colors.length)], life: 1.8,
      });
    }
  }

  function flightEnd(now: number) {
    const s = g.current;
    const o = s.outcome;
    const mine = s.turn === "you";
    s.phase = "result";
    s.t0 = now;
    if (mine) { s.yourHist.push(o); if (o === "goal") s.you += 1; }
    else { s.cpuHist.push(o); if (o === "goal") s.cpu += 1; }

    const good = mine ? o === "goal" : o !== "goal"; // good for the player
    if (o === "goal") sfx.net();
    if (o === "saved") sfx.slap();
    if (o === "post") sfx.post();
    if (o === "bar") sfx.bar();
    buzz(
      o === "goal" ? (mine ? [40, 40, 40, 40, 160] : [260])
      : o === "saved" ? (mine ? [160] : [30, 30, 90])
      : o === "missed" ? [120] : [25, 40, 25],
    );
    if (good) roar(mine && o === "goal" ? 1 : 0.55); else sfx.sad();
    if (good) { s.cheerT = now; s.cheerPower = mine && o === "goal" ? 1 : 0.5; }
    if (mine && o === "goal") { spawnConfetti(); sfx.jingle(); }

    const text = mine
      ? { goal: "GOAL!", saved: "SAVED!", missed: "MISSED!", post: "POST!", bar: "BAR!" }[o]
      : { goal: "CONCEDED!", saved: "YOU SAVED IT!", missed: "THEY MISSED!", post: "OFF THE POST!", bar: "OFF THE BAR!" }[o];
    setBanner({ text, tone: o === "post" || o === "bar" ? "neutral" : good ? "good" : "bad" });
    setUi("result");
    syncHud();
  }

  function addScore(m: "shots" | "survival", score: number): boolean {
    const list = [...scoresRef.current[m]];
    const prevBest = list.length ? list[0].s : -1;
    if (score > 0) {
      list.push({ s: score, t: teamRef.current.name, d: new Date().toISOString().slice(0, 10) });
      list.sort((a, b) => b.s - a.s);
      list.splice(5);
      store(`ps-hs-${m}`, JSON.stringify(list));
      setScores((prev) => ({ ...prev, [m]: list }));
    }
    return score > 0 && score > prevBest;
  }

  function finishGame() {
    const s = g.current;
    s.phase = "done";
    setUi("done");
    if (versus(s.mode)) {
      const win = s.you > s.cpu;
      const mineName = teamRef.current.name;
      const result = `${mineName} ${s.you} – ${s.cpu} ${s.cpuTeam.name}`;
      if (s.mode === "vs") {
        const rec = { ...scoresRef.current.vs };
        if (win) rec.w += 1; else rec.l += 1;
        store("ps-vs", JSON.stringify(rec));
        setScores((prev) => ({ ...prev, vs: rec }));
        setFinish({ title: win ? "You win!" : "You lose", detail: result, newBest: false });
        sfx.end(win);
      } else {
        const round = cup.current.round;
        const rec = { ...scoresRef.current.cup };
        if (round > rec.r) rec.r = round;
        const champion = win && round === ROUNDS.length - 1;
        if (champion) rec.t += 1;
        store("ps-cup", JSON.stringify(rec));
        setScores((prev) => ({ ...prev, cup: rec }));
        if (champion) {
          setFinish({ title: "WORLD CHAMPIONS!", detail: `${result} in the final`, newBest: false, trophy: true });
          for (let i = 0; i < 4; i++) setTimeout(spawnConfetti, i * 500);
          buzz([100, 50, 100, 50, 300]);
        } else if (win) {
          setFinish({ title: `${ROUNDS[round]} won!`, detail: `${result}. Next: ${ROUNDS[round + 1]} vs ${cup.current.opps[round + 1].name}`, newBest: false, next: `${ROUNDS[round + 1]} →` });
        } else {
          setFinish({ title: "Knocked out", detail: `${result} in the ${ROUNDS[round].toLowerCase()}`, newBest: false });
        }
        sfx.end(win);
      }
    } else {
      const newBest = addScore(s.mode, s.you);
      setFinish({
        title: s.mode === "survival"
          ? `${s.you} in a row`
          : s.you >= 4 ? "Champion!" : s.you >= 3 ? "Not bad!" : "Keep practising!",
        detail: s.mode === "survival" ? "Streak ended" : `${teamRef.current.name} scored ${s.you} out of ${TOTAL_SHOTS}`,
        newBest,
      });
      sfx.end(s.you >= 3);
    }
  }

  function resultEnd(now: number) {
    const s = g.current;
    setBanner(null);
    let over = false;
    if (s.mode === "shots") over = s.yourHist.length >= TOTAL_SHOTS;
    else if (s.mode === "survival") over = s.outcome !== "goal";
    else if (s.turn === "cpu") over = s.cpuHist.length >= TOTAL_SHOTS && s.you !== s.cpu; // sudden death if level
    if (over) { finishGame(); return; }
    if (versus(s.mode)) s.turn = s.turn === "you" ? "cpu" : "you";
    s.takerIdx = (s.turn === "you" ? s.yourHist.length : s.cpuHist.length + 2) % NUMBERS.length;
    s.phase = s.turn === "cpu" ? "save" : "aim";
    s.t0 = now;
    setUi(s.phase);
  }

  // Work out where the ball goes, whether the keeper gets there, then start the run-up
  function launch(aim: Point, power: number, shotCurve: -1 | 0 | 1, dive: Dive) {
    const s = g.current;
    const dev = power - 0.78;
    const spread = dev > 0 ? Math.max(0, dev - 0.08) * 260 : Math.max(0, -dev - 0.08) * 120;
    const mag = (spread + (shotCurve !== 0 ? 10 : 0)) * (0.4 + Math.random() * 0.6);
    const ang = Math.random() * Math.PI * 2;
    const lob = power > 0.92 ? (power - 0.92) * 600 : 0;
    const t = {
      x: clamp(aim.x + Math.cos(ang) * mag, GOAL.x - 90, GOAL.x + GOAL.w + 90),
      y: clamp(aim.y + Math.sin(ang) * mag - lob, GOAL.y - 70, GOAL.y + GOAL.h - 8),
    };
    s.target = t;
    s.power = power;
    s.shotCurve = shotCurve;
    s.flightMs = lerp(950, 470, power);
    s.dive = dive;

    const kp = keeperPose(dive, diveProgress(s.flightMs));
    const bonus = power < 0.45 ? 1.25 : 1; // a weak shot is easier to reach
    const skill = s.turn === "you" ? cfg.reach + (s.mode === "worldcup" ? cup.current.round * 0.02 : 0) : 2 - cfg.reach;
    const rx = (dive.wide ? 78 : 44) * bonus * skill;
    const ry = (dive.wide ? 40 : 60) * bonus * skill;
    const right = GOAL.x + GOAL.w;
    const hitPost = (Math.abs(t.x - GOAL.x) <= 10 || Math.abs(t.x - right) <= 10) && t.y >= GOAL.y - 10 && t.y <= GOAL.y + GOAL.h;
    const hitBar = Math.abs(t.y - GOAL.y) <= 10 && t.x >= GOAL.x - 10 && t.x <= right + 10;
    const outside = t.x < GOAL.x || t.x > right || t.y < GOAL.y;
    const reached = ((t.x - kp.x) / rx) ** 2 + ((t.y - kp.y) / ry) ** 2 < 1;
    const nearBar = Math.abs(t.y - GOAL.y) < Math.min(Math.abs(t.x - GOAL.x), Math.abs(t.x - right));
    s.outcome = hitPost && hitBar ? (nearBar ? "bar" : "post") : hitPost ? "post" : hitBar ? "bar" : outside ? "missed" : reached ? "saved" : "goal";

    s.phase = "runup";
    s.t0 = performance.now();
    setUi("runup");
    sfx.whistle();
  }

  // Your kick: the computer keeper picks a dive
  function shoot(power: number) {
    const s = g.current;
    if (s.phase !== "power") return;
    const cupBoost = s.mode === "worldcup" ? cup.current.round * 0.05 : 0;
    const base = Math.min(0.65, cfg.read + cupBoost + (s.mode === "survival" ? 0.04 * s.you : 0));
    const readChance = s.curve !== 0 ? base * 0.25 : base;
    const dive = Math.random() < readChance ? nearestDive(s.locked) : DIVES[Math.floor(Math.random() * DIVES.length)];
    launch(s.locked, power, s.curve, dive);
  }

  // Computer's kick: you are the keeper and already picked s.dive
  function cpuShoot() {
    const s = g.current;
    const base = CPU_AIMS[Math.floor(Math.random() * CPU_AIMS.length)];
    const aim = { x: base.x + (Math.random() - 0.5) * 30, y: base.y + (Math.random() - 0.5) * 20 };
    const power = cfg.cpuMin + Math.random() * cfg.cpuRange;
    const swerve: -1 | 0 | 1 = Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    launch(aim, power, swerve, s.dive);
  }

  function chooseDive(p: Point) {
    const s = g.current;
    if (s.phase !== "save") return;
    s.dive = nearestDive(p);
    cpuShoot();
  }

  function lockAim(t: Point) {
    const s = g.current;
    s.hover = t;
    s.locked = t;
    s.phase = "power";
    s.t0 = performance.now();
    setUi("power");
  }

  api.current = {
    flightEnd,
    resultEnd,
    saveTimeout: () => { g.current.dive = DIVES[2]; cpuShoot(); },
    key: (e: KeyboardEvent) => {
      if (screen !== "game" || finish) return;
      const s = g.current;
      const moves: Record<string, Point> = {
        ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -12 }, ArrowDown: { x: 0, y: 12 },
      };
      if ((s.phase === "aim" || s.phase === "save") && moves[e.code]) {
        e.preventDefault();
        s.hover = {
          x: clamp(s.hover.x + moves[e.code].x, GOAL.x - 50, GOAL.x + GOAL.w + 50),
          y: clamp(s.hover.y + moves[e.code].y, GOAL.y - 40, GOAL.y + GOAL.h - 8),
        };
      } else if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        ac();
        if (s.phase === "aim") lockAim(s.hover);
        else if (s.phase === "power") shoot(powerAt(performance.now(), s.t0));
        else if (s.phase === "save") chooseDive(s.hover);
      }
    },
  };

  /* ----- input ----- */

  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>, lifted = true) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scale = viewW.current / rect.width;
    // on touch screens the reticle sits above the finger so it stays visible
    const lift = lifted && e.pointerType === "touch" ? 60 * scale : 0;
    const x = (e.clientX - rect.left) * scale + (W - viewW.current) / 2;
    const y = (e.clientY - rect.top) * scale - lift;
    return {
      x: clamp(x, GOAL.x - 50, GOAL.x + GOAL.w + 50),
      y: clamp(y, GOAL.y - 40, GOAL.y + GOAL.h - 8),
    };
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = g.current;
    if (s.phase === "save" && e.pointerType === "mouse") s.hover = toCanvas(e, false);
    else if (s.phase === "aim" && (e.pointerType === "mouse" || aiming.current)) s.hover = toCanvas(e);
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    ac(); // unlock audio on the first tap
    const s = g.current;
    if (s.phase === "power") { shoot(powerAt(performance.now(), s.t0)); return; }
    if (s.phase === "save") { chooseDive(toCanvas(e, false)); return; }
    if (s.phase !== "aim") return;
    if (e.pointerType === "mouse") { lockAim(toCanvas(e)); return; } // mouse: click to lock the aim
    // touch: press and drag to aim, release to lock
    aiming.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    s.hover = toCanvas(e);
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!aiming.current) return;
    aiming.current = false;
    if (g.current.phase === "aim") lockAim(toCanvas(e));
  }

  /* ----- menu / controls ----- */

  function startGame(nextMatch = false) {
    ac();
    applyAmbient();
    store("ps-team", team.name);
    store("ps-mode", mode);
    store("ps-diff", diff);
    cfg = DIFFS[diff];
    powerPeriod = cfg.period;
    let opp: Team;
    if (mode === "worldcup") {
      if (nextMatch) cup.current.round += 1;
      else cup.current = { round: 0, opps: shuffle(TEAMS.filter((t) => t.name !== team.name)).slice(0, ROUNDS.length) };
      opp = cup.current.opps[cup.current.round];
    } else {
      const others = TEAMS.filter((t) => t.name !== team.name);
      opp = others[Math.floor(Math.random() * others.length)];
    }
    const cpuTeam = awayKit(opp, team);
    const keep = g.current.curve;
    g.current = newGame(mode, cpuTeam);
    g.current.curve = keep;
    particles.current = [];
    setBanner(null);
    setFinish(null);
    setUi("aim");
    syncHud();
    setScreen("game");
  }

  function chooseCurve(c: -1 | 0 | 1) {
    g.current.curve = c;
    setCurve(c);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function toggleVib() {
    const next = !vib;
    vibOn = next;
    store("ps-vib", next ? "1" : "0");
    setVib(next);
    if (next) buzz(40);
  }

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    setInstallEvt(null);
  }

  function toggleMute() {
    const next = !mute;
    muted = next;
    store("ps-mute", next ? "1" : "0");
    setMute(next);
    applyAmbient();
  }

  /* ----- render ----- */

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const g0 = g.current;
  const inResult = ui === "result" || ui === "done";
  const taken = g0.turn === "you" ? hud.yourHist.length : hud.cpuHist.length;
  const kickLabel =
    versus(mode) ? `Round ${inResult ? taken : taken + 1} · ${g0.turn === "you" ? "your kick" : "their kick"}`
    : mode === "survival" ? `Shot ${inResult ? taken : taken + 1}`
    : `Shot ${Math.min(hud.yourHist.length + 1, TOTAL_SHOTS)} of ${TOTAL_SHOTS}`;
  const taker = `#${(g0.turn === "you" ? team : g0.cpuTeam).squad[g0.takerIdx].n}`;
  const hint =
    ui === "aim" ? (coarse ? "drag to aim, release to lock" : "click to lock your aim (arrow keys + space also work)")
    : ui === "power" ? (coarse ? "tap to stop the meter in the green" : "click to stop the meter in the green")
    : ui === "save" ? (coarse ? "tap where you think they'll shoot" : "click where you think they'll shoot")
    : "";
  const dots = (hist: Outcome[]) =>
    Array.from({ length: Math.max(TOTAL_SHOTS, hist.length) }, (_, i) => (
      <span key={i} className={`dot ${hist[i] ? (hist[i] === "goal" ? "hit" : "miss") : ""}`} />
    ));
  const kitBg = (t: Team) =>
    t.stripe ? `repeating-linear-gradient(90deg, ${t.shirt} 0 5px, ${t.stripe} 5px 10px)` : t.shirt;
  const table = mode === "shots" || mode === "survival" ? scores[mode] : null;
  const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const iosHint = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  const cupLine = scores.cup.r < 0 ? "No tournament played yet" : `🏆 ${scores.cup.t} ${scores.cup.t === 1 ? "title" : "titles"} · furthest run: ${ROUNDS[scores.cup.r]}`;

  const scoreTable = (list: Score[]) => (
    <ol className="table">
      {list.length === 0 && <li className="empty">No scores yet</li>}
      {list.map((r, i) => (
        <li key={i}><b>{r.s}</b> <span>{r.t}</span> <em>{r.d}</em></li>
      ))}
    </ol>
  );

  return (
    <main className="game">
      {screen === "game" && <h1 className="mini">⚽ Penalty Shootout</h1>}

      {screen === "menu" && (
        <section className="menu">
          <header className="hero">
            <svg className="heroball" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="46" fill="#f8fafc" stroke="#0f172a" strokeWidth="4" />
              <polygon points="50,30 69,44 62,66 38,66 31,44" fill="#0f172a" />
              <g stroke="#0f172a" strokeWidth="3.5" strokeLinecap="round">
                <path d="M50 30 L50 8" /><path d="M69 44 L90 37" /><path d="M62 66 L75 84" /><path d="M38 66 L25 84" /><path d="M31 44 L10 37" />
              </g>
            </svg>
            <p className="kicker">The spot-kick game</p>
            <h1><span className="l1">Penalty</span><span className="l2">Shootout</span></h1>
            <p className="tag">Pick a nation. Beat the keeper. <b>Win the World Cup.</b></p>
          </header>

          <h2>Game mode</h2>
          <div className="modes">
            {MODES.map((m) => (
              <button key={m.id} className={`mode ${m.id === "worldcup" ? "cup" : ""} ${mode === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}>
                <i>{m.icon}</i>
                <b>{m.name}</b>
                <span>{m.desc}</span>
              </button>
            ))}
          </div>

          <h2>Difficulty</h2>
          <div className="diffs" role="group" aria-label="Difficulty">
            {(Object.keys(DIFFS) as DiffId[]).map((d) => (
              <button key={d} className={diff === d ? "on" : ""} onClick={() => setDiff(d)}>
                <b>{DIFFS[d].name}</b>
                <span>{DIFFS[d].desc}</span>
              </button>
            ))}
          </div>

          <h2>Your team</h2>
          <div className="teams">
            {TEAMS.map((t) => (
              <button key={t.name} className={`team ${team.name === t.name ? "on" : ""}`} onClick={() => setTeam(t)}>
                <span className="kit"><i style={{ background: kitBg(t) }} /><b style={{ background: t.shorts }} /></span>
                {t.name}
              </button>
            ))}
          </div>

          <h2>{mode === "vs" ? "Your record" : mode === "worldcup" ? "Your World Cup" : "High scores"}</h2>
          {mode === "vs"
            ? <p className="record">{scores.vs.w} {scores.vs.w === 1 ? "win" : "wins"} · {scores.vs.l} {scores.vs.l === 1 ? "loss" : "losses"}</p>
            : mode === "worldcup"
              ? <p className="record">{cupLine}</p>
              : scoreTable(scores[mode])}

          <button className="restart big" onClick={() => startGame()}>{mode === "worldcup" ? "Start the World Cup" : "Kick off!"}</button>

          {installEvt && <button className="install" onClick={install}>📲 Install as an app</button>}
          {!installEvt && iosHint && <p className="small">On iPhone: tap Share, then “Add to Home Screen” to install.</p>}
          <p className="small foot">Made with React, TypeScript and Vite · works offline once loaded</p>
        </section>
      )}

      <div style={{ display: screen === "game" ? "block" : "none" }}>
        <div className="hud">
          {mode === "worldcup" && <div className="roundbar">🏆 {ROUNDS[cup.current.round]} · vs {g0.cpuTeam.name}</div>}
          {versus(mode) ? (
            <div className="vs">
              <div className="vsrow"><span className="who">You</span><b>{hud.you}</b><span className="dots">{dots(hud.yourHist)}</span></div>
              <div className="vsrow"><span className="who">{mode === "worldcup" ? g0.cpuTeam.name : "CPU"}</span><b>{hud.cpu}</b><span className="dots">{dots(hud.cpuHist)}</span></div>
            </div>
          ) : mode === "survival" ? (
            <span className="score">Streak: {hud.you} · Best: {scores.survival[0]?.s ?? 0}</span>
          ) : (
            <>
              <span className="score">Score: {hud.you} / {TOTAL_SHOTS}</span>
              <span className="dots">{dots(hud.yourHist)}</span>
            </>
          )}
          <button className="tool" onClick={() => setScreen("menu")} aria-label="Back to menu">Menu</button>
          {canVibrate && <button className="tool" onClick={toggleVib} aria-label={vib ? "Vibration on" : "Vibration off"}>{vib ? "📳" : "📴"}</button>}
          <button className="tool" onClick={toggleMute} aria-label={mute ? "Unmute" : "Mute"}>{mute ? "🔇" : "🔊"}</button>
        </div>

        <div className="stage">
          <canvas
            ref={canvasRef}
            onPointerMove={onMove}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerCancel={() => { aiming.current = false; }}
            aria-label="Penalty pitch. Click to aim, then click again to stop the power meter and shoot."
          />
          {banner && <div className={`banner ${banner.tone}`}>{banner.text}</div>}
          {finish && (
            <div className="overlay">
              {finish.trophy && <div className="trophy" aria-hidden="true">🏆</div>}
              <h2>{finish.title}</h2>
              <p>{finish.detail}</p>
              {finish.newBest && <p className="best">New high score!</p>}
              {table && scoreTable(table)}
              {mode === "vs" && <p className="record">{scores.vs.w} {scores.vs.w === 1 ? "win" : "wins"} · {scores.vs.l} {scores.vs.l === 1 ? "loss" : "losses"}</p>}
              <div className="row">
                {finish.next
                  ? <button className="restart" onClick={() => startGame(true)}>{finish.next}</button>
                  : <button className="restart" onClick={() => startGame()}>{mode === "worldcup" ? "New tournament" : "Play again"}</button>}
                <button className="tool" onClick={() => setScreen("menu")}>Menu</button>
              </div>
            </div>
          )}
        </div>

        <div className="curve" role="group" aria-label="Shot curve">
          {([-1, 0, 1] as const).map((c) => (
            <button key={c} className={curve === c ? "on" : ""} onClick={() => chooseCurve(c)}>
              {c === -1 ? "↰ Swerve left" : c === 1 ? "Swerve right ↱" : "Straight"}
            </button>
          ))}
        </div>

        <p className="hint">{!finish ? `${kickLabel} (${taker})${hint ? `: ${hint}` : ""}` : ""}</p>
      </div>
    </main>
  );
}
