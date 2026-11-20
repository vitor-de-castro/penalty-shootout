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
const POWER_PERIOD = 1000; // ms for the meter to go 0 -> 1
const SAVE_MS = 3000; // time you get to pick a dive when you are the keeper
const SLEEVE = 0.55; // 1 = long sleeves

type Mode = "shots" | "survival" | "vs";
type Phase = "aim" | "power" | "save" | "runup" | "flight" | "result" | "done";
type Outcome = "goal" | "saved" | "missed" | "post";
type Point = { x: number; y: number };

interface Team { name: string; shirt: string; shorts: string; socks: string; num: string; keeper: string; stripe?: string }
interface Dive { x: number; y: number; rot: number; wide: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; rot: number; vr: number; c: string; life: number }
interface Score { s: number; t: string; d: string }
interface Scores { shots: Score[]; survival: Score[]; vs: { w: number; l: number } }
interface Hud { you: number; cpu: number; yourHist: Outcome[]; cpuHist: Outcome[] }
interface Banner { text: string; tone: "good" | "bad" | "neutral" }
interface Finish { title: string; detail: string; newBest: boolean }

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
}

// Plain colour kits (no club crests)
const TEAMS: Team[] = [
  { name: "Brazil", shirt: "#facc15", shorts: "#1d4ed8", socks: "#f8fafc", num: "#1d4ed8", keeper: "#f97316" },
  { name: "France", shirt: "#1e3a8a", shorts: "#f8fafc", socks: "#dc2626", num: "#f8fafc", keeper: "#f97316" },
  { name: "Argentina", shirt: "#7dd3fc", stripe: "#f8fafc", shorts: "#111827", socks: "#f8fafc", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Portugal", shirt: "#b91c1c", shorts: "#166534", socks: "#b91c1c", num: "#fde047", keeper: "#f97316" },
  { name: "England", shirt: "#f8fafc", shorts: "#1e3a8a", socks: "#f8fafc", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Germany", shirt: "#f1f5f9", shorts: "#111827", socks: "#111827", num: "#111827", keeper: "#f97316" },
  { name: "Netherlands", shirt: "#f97316", shorts: "#f97316", socks: "#f97316", num: "#ffffff", keeper: "#7c3aed" },
  { name: "Spain", shirt: "#dc2626", shorts: "#1e3a8a", socks: "#1e3a8a", num: "#fde047", keeper: "#f97316" },
];

const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: "shots", name: "5 Shots", desc: "Score as many as you can" },
  { id: "survival", name: "Survival", desc: "Keep scoring until you miss" },
  { id: "vs", name: "vs Computer", desc: "Take turns: you shoot, then you keep" },
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
    you: 0, cpu: 0, yourHist: [], cpuHist: [], cheerT: -1e9, cheerPower: 0, cpuTeam,
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
  const x = ((now - t0) / POWER_PERIOD) % 2;
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
  return { shots: list("ps-hs-shots"), survival: list("ps-hs-survival"), vs };
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

// A stadium roar: layered, wobbling noise + vowel-like voices + applause
function roar(strength: number) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime;
  const dur = 1.2 + strength * 1.8;
  const peak = 0.3 * strength;

  for (const [freq, q, v] of [[450, 0.6, 0.55], [1000, 0.8, 0.75], [2200, 1, 0.35]] as const) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const wobble = c.createGain();
    const curve = new Float32Array(48);
    for (let i = 0; i < curve.length; i++) curve[i] = 0.6 + Math.random() * 0.4;
    wobble.gain.setValueCurveAtTime(curve, t, dur);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak * v, t + 0.35);
    env.gain.setValueAtTime(peak * v, t + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(wobble).connect(env).connect(c.destination);
    src.start(t);
  }

  // "aaaah" voices that rise a little
  const voices = c.createGain();
  voices.gain.setValueAtTime(0.0001, t);
  voices.gain.exponentialRampToValueAtTime(0.045 * strength, t + 0.4);
  voices.gain.setValueAtTime(0.045 * strength, t + dur * 0.5);
  voices.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const formant of [800, 1300]) {
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = formant;
    bp.Q.value = 2;
    voices.connect(bp).connect(c.destination);
  }
  for (const note of [196, 247, 294, 330, 392]) {
    const osc = c.createOscillator();
    osc.type = "sawtooth";
    const base = note * (1 + (Math.random() - 0.5) * 0.02);
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.12, t + dur * 0.6);
    osc.connect(voices);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // applause
  const claps = Math.round(24 * strength);
  for (let i = 0; i < claps; i++) noise(0.035, 0.1 * strength, "highpass", 1800, 0.002, 0.5 + Math.random() * dur);
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
  net() { noise(0.3, 0.14, "highpass", 3000); },
  slap() { noise(0.07, 0.4, "bandpass", 1500); },
  post() { tone(1300, 0.5, "sine", 0.25, 1100); tone(2600, 0.3, "sine", 0.1); noise(0.05, 0.3, "bandpass", 3000); },
  groan() { noise(1.0, 0.2, "bandpass", 420, 0.12); tone(240, 0.9, "sawtooth", 0.04, 110); },
  end(win: boolean) {
    if (win) roar(1); else sfx.groan();
    sfx.whistle();
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
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 60, W, 28);
  ctx.fillStyle = "#475569";
  for (let x = 10; x < W; x += 120) ctx.fillRect(x, 68, 90, 12);

  const grad = ctx.createLinearGradient(0, 240, 0, H);
  grad.addColorStop(0, "#15803d");
  grad.addColorStop(1, "#166534");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 240, W, H - 240);
  for (let i = 0; i < 6; i += 2) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 240 + i * 44, W, 44);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 240); ctx.lineTo(W, 240); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(290, 240); ctx.lineTo(270, 295); ctx.lineTo(530, 295); ctx.lineTo(510, 240); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(120, 240); ctx.lineTo(70, 475); ctx.moveTo(680, 240); ctx.lineTo(730, 475); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(SPOT.x, SPOT.y + 12, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function drawNet(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(GOAL.x, GOAL.y, GOAL.w, GOAL.h);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  for (let x = GOAL.x; x <= GOAL.x + GOAL.w; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, GOAL.y); ctx.lineTo(x, GOAL.y + GOAL.h); ctx.stroke();
  }
  for (let y = GOAL.y; y <= GOAL.y + GOAL.h; y += 16) {
    ctx.beginPath(); ctx.moveTo(GOAL.x, y); ctx.lineTo(GOAL.x + GOAL.w, y); ctx.stroke();
  }
}

function drawFrame(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(GOAL.x, GOAL.y + GOAL.h);
  ctx.lineTo(GOAL.x, GOAL.y);
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y);
  ctx.lineTo(GOAL.x + GOAL.w, GOAL.y + GOAL.h);
  ctx.stroke();
}

function drawKeeper(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, raise: number, now: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineCap = "round";
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(-11, 14, 9, 32);
  ctx.fillRect(2, 14, 9, 32);
  ctx.fillStyle = "#111827";
  ctx.fillRect(-12, 42, 11, 6);
  ctx.fillRect(1, 42, 11, 6);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(-13, 3, 26, 15);
  ctx.fillStyle = color;
  ctx.fillRect(-13, -30, 26, 36);
  const bob = Math.sin(now / 160) * 3 * (1 - raise);
  for (const side of [-1, 1]) {
    const gx = lerp(side * 32, side * 10, raise);
    const gy = lerp(-4 + bob, -68, raise);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(side * 13, -26); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(gx, gy, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#e0ac69";
  ctx.beginPath(); ctx.arc(0, -42, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3b2314";
  ctx.beginPath(); ctx.arc(0, -45, 10, Math.PI, 0); ctx.fill();
  ctx.restore();
}

function drawTaker(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, swing: number, kick: number | null, kit: Team, celebrate: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(0, 2, 24, 6, 0, 0, Math.PI * 2); ctx.fill();

  let aL: number, aR: number;
  if (kick === null) { aL = Math.sin(swing) * 0.7; aR = -aL; }
  else { aL = 0.05; aR = lerp(-0.95, 1.15, 1 - (1 - kick) * (1 - kick)); }

  const hipY = -52;
  const leg = (hx: number, a: number) => {
    const fx = hx + Math.sin(a) * 52;
    const fy = hipY + Math.cos(a) * 52;
    ctx.strokeStyle = "#e0ac69";
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(fx, fy); ctx.stroke();
    // sock: covers the lower part of the leg
    ctx.lineCap = "butt";
    ctx.strokeStyle = kit.socks;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(lerp(fx, hx, 0.45), lerp(fy, hipY, 0.45)); ctx.stroke();
    ctx.lineCap = "round";
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.ellipse(fx, fy, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
  };
  leg(-6, aL);
  leg(6, aR);

  ctx.fillStyle = kit.shorts;
  ctx.fillRect(-14, -62, 28, 18);
  ctx.fillStyle = kit.shirt;
  ctx.fillRect(-15, -94, 30, 34);
  if (kit.stripe) {
    ctx.fillStyle = kit.stripe;
    ctx.fillRect(-9, -94, 6, 34);
    ctx.fillRect(3, -94, 6, 34);
  }
  ctx.fillStyle = kit.num;
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("10", 0, -70);

  for (const side of [-1, 1]) {
    const base = kick === null ? (side === -1 ? -aL : -aR) * 0.8 : side * 0.9;
    const a = lerp(base, side * (Math.PI - 0.45), celebrate);
    const sx = side * 15;
    const sy = -90;
    const ex = sx + Math.sin(a) * 26 + side * 4 * (1 - celebrate);
    const ey = sy + Math.cos(a) * 26;
    ctx.strokeStyle = "#e0ac69";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = kit.shirt;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, ex, SLEEVE), lerp(sy, ey, SLEEVE)); ctx.stroke();
  }
  ctx.fillStyle = "#3b2314";
  ctx.beginPath(); ctx.arc(0, -106, 11, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, shadow?: Point) {
  if (shadow) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(shadow.x, shadow.y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#111";
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * Math.PI * 2) / 3;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.22, 0, Math.PI * 2); ctx.fill();
  }
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

  const g = useRef<Game>(newGame(mode, TEAMS[1]));
  const teamRef = useRef(team);
  const scoresRef = useRef(scores);
  teamRef.current = team;
  scoresRef.current = scores;
  muted = mute;

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

    const update = (now: number) => {
      const s = g.current;
      if (s.phase === "runup" && now - s.t0 >= RUNUP_MS) {
        s.phase = "flight";
        s.t0 = now;
        setUi("flight");
        sfx.kick();
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
      const keeperColor = s.turn === "you" ? other.keeper : mine.keeper;
      const el = now - s.t0;
      const dt = Math.min(0.05, (now - lastNow.current) / 1000);
      lastNow.current = now;

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-(W - viewW.current) / 2, 0);
      const level = s.cheerPower * clamp(1 - (now - s.cheerT) / 2600);
      drawPitch(ctx, now, level, mine, other);
      drawNet(ctx);

      // keeper
      let pose = { x: 400, y: 195, rot: 0, raise: 0 };
      if (s.phase === "flight") pose = keeperPose(s.dive, diveProgress(el));
      else if (s.phase === "result") pose = keeperPose(s.dive, diveProgress(s.flightMs + el));
      else if (s.phase === "done") pose = keeperPose(s.dive, 1);
      else { pose.x = 400 + Math.sin(now / 220) * 8; pose.y = 195 + Math.sin(now / 300) * 2; }
      drawKeeper(ctx, pose.x, pose.y, pose.rot, pose.raise, now, keeperColor);
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
        } else if (s.outcome === "post") {
          bx = s.target.x + (SPOT.x - s.target.x) * d * 0.0004;
          by = s.target.y + (SPOT.y - s.target.y) * d * 0.0006;
        } else {
          bx = s.target.x + (s.target.x - 400) * d * 0.0004;
          by = s.target.y - d * 0.04;
          br = Math.max(3.5, 6.5 - d * 0.002);
        }
      }

      if (preKick) drawBall(ctx, bx, by, br, spin);
      drawTaker(ctx, tx, ty, 1.15, swing, s.phase === "aim" || s.phase === "power" || s.phase === "save" ? null : kick, kicker, celebrate);
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
    if (good) roar(mine && o === "goal" ? 1 : 0.55); else sfx.groan();
    if (good) { s.cheerT = now; s.cheerPower = mine && o === "goal" ? 1 : 0.5; }
    if (mine && o === "goal") spawnConfetti();

    const text = mine
      ? { goal: "GOAL!", saved: "SAVED!", missed: "MISSED!", post: "POST!" }[o]
      : { goal: "CONCEDED!", saved: "YOU SAVED IT!", missed: "THEY MISSED!", post: "OFF THE POST!" }[o];
    setBanner({ text, tone: o === "post" ? "neutral" : good ? "good" : "bad" });
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
    if (s.mode === "vs") {
      const win = s.you > s.cpu;
      const rec = { ...scoresRef.current.vs };
      if (win) rec.w += 1; else rec.l += 1;
      store("ps-vs", JSON.stringify(rec));
      setScores((prev) => ({ ...prev, vs: rec }));
      setFinish({
        title: win ? "You win!" : "You lose",
        detail: `${teamRef.current.name} ${s.you} – ${s.cpu} ${s.cpuTeam.name}`,
        newBest: false,
      });
      sfx.end(win);
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
    if (s.mode === "vs") s.turn = s.turn === "you" ? "cpu" : "you";
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
    const rx = (dive.wide ? 78 : 44) * bonus;
    const ry = (dive.wide ? 40 : 60) * bonus;
    const right = GOAL.x + GOAL.w;
    const hitPost = (Math.abs(t.x - GOAL.x) <= 10 || Math.abs(t.x - right) <= 10) && t.y >= GOAL.y - 10 && t.y <= GOAL.y + GOAL.h;
    const hitBar = Math.abs(t.y - GOAL.y) <= 10 && t.x >= GOAL.x - 10 && t.x <= right + 10;
    const outside = t.x < GOAL.x || t.x > right || t.y < GOAL.y;
    const reached = ((t.x - kp.x) / rx) ** 2 + ((t.y - kp.y) / ry) ** 2 < 1;
    s.outcome = hitPost || hitBar ? "post" : outside ? "missed" : reached ? "saved" : "goal";

    s.phase = "runup";
    s.t0 = performance.now();
    setUi("runup");
    sfx.whistle();
  }

  // Your kick: the computer keeper picks a dive
  function shoot(power: number) {
    const s = g.current;
    if (s.phase !== "power") return;
    const base = s.mode === "survival" ? Math.min(0.6, 0.2 + 0.04 * s.you) : 0.2;
    const readChance = s.curve !== 0 ? base * 0.25 : base;
    const dive = Math.random() < readChance ? nearestDive(s.locked) : DIVES[Math.floor(Math.random() * DIVES.length)];
    launch(s.locked, power, s.curve, dive);
  }

  // Computer's kick: you are the keeper and already picked s.dive
  function cpuShoot() {
    const s = g.current;
    const base = CPU_AIMS[Math.floor(Math.random() * CPU_AIMS.length)];
    const aim = { x: base.x + (Math.random() - 0.5) * 30, y: base.y + (Math.random() - 0.5) * 20 };
    const power = 0.55 + Math.random() * 0.4;
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

  function startGame() {
    ac();
    applyAmbient();
    store("ps-team", team.name);
    store("ps-mode", mode);
    const others = TEAMS.filter((t) => t.name !== team.name);
    const cpuTeam = others[Math.floor(Math.random() * others.length)];
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
    mode === "vs" ? `Round ${inResult ? taken : taken + 1} · ${g0.turn === "you" ? "your kick" : "their kick"}`
    : mode === "survival" ? `Shot ${inResult ? taken : taken + 1}`
    : `Shot ${Math.min(hud.yourHist.length + 1, TOTAL_SHOTS)} of ${TOTAL_SHOTS}`;
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
  const table = mode === "vs" ? null : scores[mode];

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
      <h1>Penalty Shootout</h1>

      {screen === "menu" && (
        <section className="menu">
          <h2>Game mode</h2>
          <div className="modes">
            {MODES.map((m) => (
              <button key={m.id} className={`mode ${mode === m.id ? "on" : ""}`} onClick={() => setMode(m.id)}>
                <b>{m.name}</b>
                <span>{m.desc}</span>
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

          <h2>{mode === "vs" ? "Your record" : "High scores"}</h2>
          {mode === "vs"
            ? <p className="record">{scores.vs.w} {scores.vs.w === 1 ? "win" : "wins"} · {scores.vs.l} {scores.vs.l === 1 ? "loss" : "losses"}</p>
            : scoreTable(scores[mode])}

          <button className="restart big" onClick={startGame}>Kick off!</button>
        </section>
      )}

      <div style={{ display: screen === "game" ? "block" : "none" }}>
        <div className="hud">
          {mode === "vs" ? (
            <div className="vs">
              <div className="vsrow"><span className="who">You</span><b>{hud.you}</b><span className="dots">{dots(hud.yourHist)}</span></div>
              <div className="vsrow"><span className="who">CPU</span><b>{hud.cpu}</b><span className="dots">{dots(hud.cpuHist)}</span></div>
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
              <h2>{finish.title}</h2>
              <p>{finish.detail}</p>
              {finish.newBest && <p className="best">New high score!</p>}
              {table && scoreTable(table)}
              {mode === "vs" && <p className="record">{scores.vs.w} {scores.vs.w === 1 ? "win" : "wins"} · {scores.vs.l} {scores.vs.l === 1 ? "loss" : "losses"}</p>}
              <div className="row">
                <button className="restart" onClick={startGame}>Play again</button>
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

        <p className="hint">{!finish ? `${kickLabel}${hint ? `: ${hint}` : ""}` : ""}</p>
      </div>
    </main>
  );
}
