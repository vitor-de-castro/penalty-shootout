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
const SLEEVE = 0.55; // 1 = long sleeves

type Phase = "aim" | "power" | "runup" | "flight" | "result" | "done";
type Outcome = "goal" | "saved" | "missed";
interface Team { name: string; shirt: string; shorts: string; num: string; keeper: string }
interface Dive { x: number; y: number; rot: number; wide: boolean }
interface Game {
  phase: Phase;
  t0: number;
  hover: { x: number; y: number };
  locked: { x: number; y: number };
  target: { x: number; y: number };
  dive: Dive;
  outcome: Outcome;
  shots: number;
  score: number;
  power: number;
  curve: -1 | 0 | 1;
  flightMs: number;
}

// Plain colour kits (no club crests)
const TEAMS: Team[] = [
  { name: "Brazil", shirt: "#facc15", shorts: "#1d4ed8", num: "#1d4ed8", keeper: "#f97316" },
  { name: "France", shirt: "#1e3a8a", shorts: "#f8fafc", num: "#f8fafc", keeper: "#f97316" },
  { name: "Argentina", shirt: "#7dd3fc", shorts: "#111827", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Portugal", shirt: "#b91c1c", shorts: "#166534", num: "#fde047", keeper: "#f97316" },
  { name: "England", shirt: "#f8fafc", shorts: "#1e3a8a", num: "#1e3a8a", keeper: "#f97316" },
  { name: "Germany", shirt: "#f1f5f9", shorts: "#111827", num: "#111827", keeper: "#f97316" },
  { name: "Netherlands", shirt: "#f97316", shorts: "#f97316", num: "#ffffff", keeper: "#7c3aed" },
  { name: "Spain", shirt: "#dc2626", shorts: "#1e3a8a", num: "#fde047", keeper: "#f97316" },
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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const ease = (t: number) => t * t * (3 - 2 * t);

function newGame(): Game {
  return {
    phase: "aim", t0: 0,
    hover: { x: 400, y: 150 }, locked: { x: 400, y: 150 }, target: { x: 400, y: 150 },
    dive: DIVES[2], outcome: "goal", shots: 0, score: 0, power: 0.8, curve: 0, flightMs: 700,
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

/* ---------- sound (synthesised, no files) ---------- */

let actx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (!actx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    actx = new Ctor();
  }
  if (actx.state === "suspended") void actx.resume();
  return actx;
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
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
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

const sfx = {
  whistle() { tone(2700, 0.14, "triangle", 0.12); tone(2700, 0.4, "triangle", 0.12, 2600, 0.18); },
  kick() { noise(0.09, 0.5, "lowpass", 500); tone(160, 0.14, "sine", 0.5, 45); },
  goal() {
    noise(0.3, 0.14, "highpass", 3000);                // net rustle
    noise(1.8, 0.3, "bandpass", 900, 0.25, 0.05);      // crowd roar
    tone(523, 0.18, "triangle", 0.1, undefined, 0.1);
    tone(659, 0.18, "triangle", 0.1, undefined, 0.22);
    tone(784, 0.35, "triangle", 0.1, undefined, 0.34);
  },
  save() {
    noise(0.07, 0.4, "bandpass", 1500);                // glove slap
    noise(1.0, 0.18, "bandpass", 500, 0.1, 0.1);       // crowd groan
    tone(280, 0.7, "sawtooth", 0.05, 140, 0.1);
  },
  miss() {
    noise(1.1, 0.16, "bandpass", 450, 0.15);
    tone(300, 0.8, "sawtooth", 0.05, 120);
  },
  end(win: boolean) {
    if (win) { noise(2.2, 0.3, "bandpass", 1000, 0.3); tone(659, 0.2, "triangle", 0.12); tone(880, 0.5, "triangle", 0.12, undefined, 0.2); }
    else sfx.whistle();
  },
};

/* ---------- drawing helpers ---------- */

function drawPitch(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0c3a20";
  ctx.fillRect(0, 0, W, 240);
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

function drawTaker(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, swing: number, kick: number | null, kit: Team) {
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
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.ellipse(fx, fy, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
  };
  leg(-6, aL);
  leg(6, aR);

  ctx.fillStyle = kit.shorts;
  ctx.fillRect(-14, -62, 28, 18);
  ctx.fillStyle = kit.shirt;
  ctx.fillRect(-15, -94, 30, 34);
  ctx.fillStyle = kit.num;
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("10", 0, -70);

  for (const side of [-1, 1]) {
    const a = kick === null ? (side === -1 ? -aL : -aR) * 0.8 : side * 0.9;
    const sx = side * 15;
    const sy = -90;
    const ex = sx + Math.sin(a) * 26 + side * 4;
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

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, shadow?: { x: number; y: number }) {
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
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("TAP TO STOP IN THE GREEN", cx, y + h + 22);
}

/* ---------- component ---------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef<Game>(newGame());
  const viewW = useRef(W);
  const aiming = useRef(false);
  const kitRef = useRef<Team>(TEAMS[0]);

  const [team, setTeam] = useState<Team | null>(() => TEAMS.find((t) => t.name === load("ps-team")) ?? null);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<Outcome[]>([]);
  const [message, setMessage] = useState<Outcome | null>(null);
  const [finished, setFinished] = useState(false);
  const [ui, setUi] = useState<Phase>("aim");
  const [curve, setCurve] = useState<-1 | 0 | 1>(0);
  const [mute, setMute] = useState(() => load("ps-mute") === "1");

  kitRef.current = team ?? TEAMS[0];
  muted = mute;

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

    const update = (now: number) => {
      const s = g.current;
      if (s.phase === "runup" && now - s.t0 >= RUNUP_MS) {
        s.phase = "flight";
        s.t0 = now;
        setUi("flight");
        sfx.kick();
      } else if (s.phase === "flight" && now - s.t0 >= s.flightMs) {
        s.phase = "result";
        s.t0 = now;
        s.shots += 1;
        const outcome = s.outcome;
        if (outcome === "goal") { s.score += 1; sfx.goal(); }
        else if (outcome === "saved") sfx.save();
        else sfx.miss();
        setMessage(outcome);
        setHistory((h) => [...h, outcome]);
        setScore(s.score);
        setUi("result");
      } else if (s.phase === "result" && now - s.t0 >= RESULT_MS) {
        setMessage(null);
        if (s.shots >= TOTAL_SHOTS) {
          s.phase = "done";
          setFinished(true);
          setUi("done");
          sfx.end(s.score >= 3);
        } else {
          s.phase = "aim";
          setUi("aim");
        }
      }
    };

    const draw = (now: number) => {
      const s = g.current;
      const kit = kitRef.current;
      const el = now - s.t0;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-(W - viewW.current) / 2, 0);
      drawPitch(ctx);
      drawNet(ctx);

      // keeper
      let pose = { x: 400, y: 195, rot: 0, raise: 0 };
      if (s.phase === "flight") pose = keeperPose(s.dive, diveProgress(el));
      else if (s.phase === "result") pose = keeperPose(s.dive, diveProgress(s.flightMs + el));
      else if (s.phase === "done") pose = keeperPose(s.dive, 1);
      else { pose.x = 400 + Math.sin(now / 220) * 8; pose.y = 195 + Math.sin(now / 300) * 2; }
      drawKeeper(ctx, pose.x, pose.y, pose.rot, pose.raise, now, kit.keeper);
      drawFrame(ctx);

      // taker
      let tx = 300, ty = 492, swing = 0, kick: number | null = null;
      if (s.phase === "runup") {
        const p = clamp(el / RUNUP_MS);
        tx = lerp(300, 362, p);
        ty = lerp(492, 438, p);
        swing = el * 0.022;
        if (el > RUNUP_MS - KICK_MS) kick = clamp((el - (RUNUP_MS - KICK_MS)) / KICK_MS);
      } else if (s.phase === "flight" || s.phase === "result" || s.phase === "done") {
        tx = 362; ty = 438; kick = 1;
      }
      const preKick = s.phase === "aim" || s.phase === "power" || s.phase === "runup";

      // ball
      let bx = SPOT.x, by = SPOT.y, br = 11, spin = 0;
      let shadow: { x: number; y: number } | undefined;
      if (s.phase === "flight") {
        const p = clamp(el / s.flightMs);
        bx = lerp(SPOT.x, s.target.x, p) + s.curve * 70 * Math.sin(Math.PI * p);
        const ground = lerp(SPOT.y, s.target.y, p);
        by = ground - Math.sin(Math.PI * p) * lerp(95, 45, s.power);
        br = lerp(11, 6.5, p);
        spin = p * 14 * (s.curve === 0 ? 1 : 2.2);
        shadow = { x: bx, y: ground + 8 };
      } else if (s.phase === "result" || s.phase === "done") {
        const dt = s.phase === "done" ? RESULT_MS : el;
        br = 6.5;
        spin = 14 + dt * 0.01;
        if (s.outcome === "goal") {
          bx = s.target.x;
          by = Math.min(s.target.y + dt * 0.02, GOAL.y + GOAL.h - 6);
        } else if (s.outcome === "saved") {
          const dir = s.target.x >= s.dive.x ? 1 : -1;
          bx = s.target.x + dir * dt * 0.1;
          by = Math.min(s.target.y + dt * 0.06, 270);
        } else {
          bx = s.target.x + (s.target.x - 400) * dt * 0.0004;
          by = s.target.y - dt * 0.04;
          br = Math.max(3.5, 6.5 - dt * 0.002);
        }
      }

      if (preKick) drawBall(ctx, bx, by, br, spin);
      drawTaker(ctx, tx, ty, 1.15, swing, s.phase === "aim" || s.phase === "power" ? null : kick, kit);
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
      ctx.restore();

      if (s.phase === "power") drawMeter(ctx, viewW.current / 2, powerAt(now, s.t0));
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
    };
  }, []);

  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scale = viewW.current / rect.width;
    // on touch screens the reticle sits above the finger so it stays visible
    const lift = e.pointerType === "touch" ? 60 * scale : 0;
    const x = (e.clientX - rect.left) * scale + (W - viewW.current) / 2;
    const y = (e.clientY - rect.top) * scale - lift;
    return {
      x: clamp(x, GOAL.x - 50, GOAL.x + GOAL.w + 50),
      y: clamp(y, GOAL.y - 40, GOAL.y + GOAL.h - 8),
    };
  }

  function lockAim(t: { x: number; y: number }) {
    const s = g.current;
    s.hover = t;
    s.locked = t;
    s.phase = "power";
    s.t0 = performance.now();
    setUi("power");
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (g.current.phase === "aim" && (e.pointerType === "mouse" || aiming.current)) g.current.hover = toCanvas(e);
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!team) return;
    ac(); // unlock audio on the first tap
    const s = g.current;
    if (s.phase === "power") {
      shoot(powerAt(performance.now(), s.t0));
      return;
    }
    if (s.phase !== "aim") return;
    if (e.pointerType === "mouse") {
      lockAim(toCanvas(e)); // mouse: click to lock the aim
      return;
    }
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

  function shoot(power: number) {
    const s = g.current;
    if (s.phase !== "power") return;
    const aim = s.locked;

    // Accuracy: the green zone is accurate, too weak or too hard sprays the ball
    const dev = power - 0.78;
    const spread = dev > 0 ? Math.max(0, dev - 0.08) * 260 : Math.max(0, -dev - 0.08) * 120;
    const mag = (spread + (s.curve !== 0 ? 10 : 0)) * (0.4 + Math.random() * 0.6);
    const ang = Math.random() * Math.PI * 2;
    const lob = power > 0.92 ? (power - 0.92) * 600 : 0; // blasting it goes high
    const t = {
      x: clamp(aim.x + Math.cos(ang) * mag, GOAL.x - 90, GOAL.x + GOAL.w + 90),
      y: clamp(aim.y + Math.sin(ang) * mag - lob, GOAL.y - 70, GOAL.y + GOAL.h - 8),
    };
    s.target = t;
    s.power = power;
    s.flightMs = lerp(950, 470, power); // harder = faster = less time for the keeper

    // Keeper: mostly random, sometimes reads the shot (curve fools him)
    const readChance = s.curve !== 0 ? 0.05 : 0.2;
    if (Math.random() < readChance) {
      s.dive = DIVES.reduce((best, d) =>
        Math.hypot(d.x - aim.x, d.y - aim.y) < Math.hypot(best.x - aim.x, best.y - aim.y) ? d : best
      );
    } else {
      s.dive = DIVES[Math.floor(Math.random() * DIVES.length)];
    }

    // Decide the result from where the keeper actually is when the ball arrives
    const kp = keeperPose(s.dive, diveProgress(s.flightMs));
    const bonus = power < 0.45 ? 1.25 : 1; // a weak shot is easier to reach
    const rx = (s.dive.wide ? 78 : 44) * bonus;
    const ry = (s.dive.wide ? 40 : 60) * bonus;
    const outside = t.x < GOAL.x + 6 || t.x > GOAL.x + GOAL.w - 6 || t.y < GOAL.y + 6;
    const reached = ((t.x - kp.x) / rx) ** 2 + ((t.y - kp.y) / ry) ** 2 < 1;
    s.outcome = outside ? "missed" : reached ? "saved" : "goal";

    s.phase = "runup";
    s.t0 = performance.now();
    setUi("runup");
    sfx.whistle();
  }

  function chooseCurve(c: -1 | 0 | 1) {
    g.current.curve = c;
    setCurve(c);
  }

  function pickTeam(t: Team) {
    store("ps-team", t.name);
    setTeam(t);
    restart();
  }

  function restart() {
    const curveNow = g.current.curve;
    g.current = newGame();
    g.current.curve = curveNow;
    setScore(0);
    setHistory([]);
    setMessage(null);
    setFinished(false);
    setUi("aim");
  }

  function toggleMute() {
    const next = !mute;
    store("ps-mute", next ? "1" : "0");
    setMute(next);
  }

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const label: Record<Outcome, string> = { goal: "GOAL!", saved: "SAVED!", missed: "MISSED!" };
  const hint =
    ui === "aim" ? (coarse ? "drag to aim, release to lock" : "click to lock your aim")
    : ui === "power" ? (coarse ? "tap to stop the meter in the green" : "click to stop the meter in the green")
    : "";

  return (
    <main className="game">
      <h1>Penalty Shootout</h1>
      <div className="hud">
        <span className="score">Score: {score} / {TOTAL_SHOTS}</span>
        <div className="history" aria-label="Shot history">
          {Array.from({ length: TOTAL_SHOTS }, (_, i) => (
            <span key={i} className={`dot ${history[i] ? (history[i] === "goal" ? "hit" : "miss") : ""}`} />
          ))}
        </div>
        <button className="tool" onClick={() => setTeam(null)} aria-label="Change team">{team ? team.name : "Team"} ▾</button>
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
        {message && <div className={`banner ${message}`}>{label[message]}</div>}
        {!team && (
          <div className="overlay menu">
            <h2>Choose your team</h2>
            <div className="teams">
              {TEAMS.map((t) => (
                <button key={t.name} className="team" onClick={() => pickTeam(t)}>
                  <span className="kit"><i style={{ background: t.shirt }} /><b style={{ background: t.shorts }} /></span>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {team && finished && (
          <div className="overlay">
            <h2>{score >= 4 ? "Champion!" : score >= 3 ? "Not bad!" : "Keep practising!"}</h2>
            <p>{team.name} scored {score} out of {TOTAL_SHOTS}</p>
            <button className="restart" onClick={restart}>Play again</button>
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

      <p className="hint">
        {team && !finished ? `Shot ${Math.min(g.current.shots + 1, TOTAL_SHOTS)} of ${TOTAL_SHOTS}${hint ? `: ${hint}` : ""}` : ""}
      </p>
    </main>
  );
}
