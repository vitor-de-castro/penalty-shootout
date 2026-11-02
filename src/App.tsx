import { useEffect, useRef, useState } from "react";
import "./App.css";

const W = 800;
const H = 500;
const TOTAL_SHOTS = 5;
const GOAL = { x: 200, y: 90, w: 400, h: 150 };
const SPOT = { x: 400, y: 410 };

const RUNUP_MS = 600;
const KICK_MS = 160;
const FLIGHT_MS = 650;
const RESULT_MS = 1400;
const DIVE_DELAY = 120;
const DIVE_MS = 520;

type Phase = "aim" | "runup" | "flight" | "result" | "done";
type Outcome = "goal" | "saved" | "missed";
interface Dive { x: number; y: number; rot: number; wide: boolean }
interface Game {
  phase: Phase;
  t0: number;
  hover: { x: number; y: number };
  target: { x: number; y: number };
  dive: Dive;
  outcome: Outcome;
  shots: number;
}

const SLEEVE = 0.55;
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
    hover: { x: 400, y: 150 }, target: { x: 400, y: 150 },
    dive: DIVES[2], outcome: "goal", shots: 0,
  };
}

/* ---------- drawing helpers ---------- */

function drawPitch(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0c3a20";
  ctx.fillRect(0, 0, W, 240);
  // advertising boards
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 60, W, 28);
  ctx.fillStyle = "#475569";
  for (let x = 10; x < W; x += 120) ctx.fillRect(x, 68, 90, 12);

  const grad = ctx.createLinearGradient(0, 240, 0, H);
  grad.addColorStop(0, "#15803d");
  grad.addColorStop(1, "#166534");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 240, W, H - 240);
  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(0, 240 + i * 44, W, 44);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 240); ctx.lineTo(W, 240); ctx.stroke();
  // six-yard box
  ctx.beginPath(); ctx.moveTo(290, 240); ctx.lineTo(270, 295); ctx.lineTo(530, 295); ctx.lineTo(510, 240); ctx.stroke();
  // penalty area
  ctx.beginPath(); ctx.moveTo(120, 240); ctx.lineTo(70, 475); ctx.moveTo(680, 240); ctx.lineTo(730, 475); ctx.stroke();
  // spot
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

function drawKeeper(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, raise: number, now: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineCap = "round";
  // legs
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(-11, 14, 9, 32);
  ctx.fillRect(2, 14, 9, 32);
  ctx.fillStyle = "#111827";
  ctx.fillRect(-12, 42, 11, 6);
  ctx.fillRect(1, 42, 11, 6);
  // shorts + torso
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(-13, 3, 26, 15);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(-13, -30, 26, 36);
  // arms
  const bob = Math.sin(now / 160) * 3 * (1 - raise);
  for (const side of [-1, 1]) {
    const gx = lerp(side * 32, side * 10, raise);
    const gy = lerp(-4 + bob, -68, raise);
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(side * 13, -26); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(gx, gy, 7, 0, Math.PI * 2); ctx.fill();
  }
  // head
  ctx.fillStyle = "#e0ac69";
  ctx.beginPath(); ctx.arc(0, -42, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3b2314";
  ctx.beginPath(); ctx.arc(0, -45, 10, Math.PI, 0); ctx.fill();
  ctx.restore();
}

function drawTaker(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, swing: number, kick: number | null) {
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

  // shorts, shirt
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(-14, -62, 28, 18);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(-15, -94, 30, 34);
  ctx.fillStyle = "#1d4ed8";
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("10", 0, -70);

  // arms
  for (const side of [-1, 1]) {
    const a = kick === null ? (side === -1 ? -aL : -aR) * 0.8 : side * 0.9;
    const sx = side * 15;
    const sy = -90;
    const ex = sx + Math.sin(a) * 26 + side * 4;
    const ey = sy + Math.cos(a) * 26;
    // forearm / hand
    ctx.strokeStyle = "#e0ac69";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    // short sleeve (set SLEEVE to 1 for long sleeves)
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, ex, SLEEVE), lerp(sy, ey, SLEEVE)); ctx.stroke();
  }
  // head (seen from behind)
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

/* ---------- component ---------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef<Game>(newGame());
  const viewW = useRef(W);
  const aiming = useRef(false);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<Outcome[]>([]);
  const [message, setMessage] = useState<Outcome | null>(null);
  const [finished, setFinished] = useState(false);

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
      } else if (s.phase === "flight" && now - s.t0 >= FLIGHT_MS) {
        s.phase = "result";
        s.t0 = now;
        s.shots += 1;
        const outcome = s.outcome;
        setMessage(outcome);
        setHistory((h) => [...h, outcome]);
        if (outcome === "goal") setScore((v) => v + 1);
      } else if (s.phase === "result" && now - s.t0 >= RESULT_MS) {
        setMessage(null);
        if (s.shots >= TOTAL_SHOTS) {
          s.phase = "done";
          setFinished(true);
        } else {
          s.phase = "aim";
        }
      }
    };

    const draw = (now: number) => {
      const s = g.current;
      const el = now - s.t0;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-(W - viewW.current) / 2, 0);
      drawPitch(ctx);
      drawNet(ctx);

      // keeper pose
      let kx = 400, ky = 195, rot = 0, raise = 0;
      if (s.phase === "aim" || s.phase === "runup" || s.phase === "done") {
        kx = 400 + Math.sin(now / 220) * 8;
        ky = 195 + Math.sin(now / 300) * 2;
      } else {
        const dp = s.phase === "flight" ? ease(clamp((el - DIVE_DELAY) / DIVE_MS)) : 1;
        const d = s.dive;
        kx = lerp(400, d.x, dp);
        ky = lerp(195, d.y, dp) - Math.sin(Math.PI * dp) * (d.wide ? 14 : 26);
        rot = d.rot * dp;
        raise = d.wide || d.y < 190 ? dp : dp * 0.6;
      }
      drawKeeper(ctx, kx, ky, rot, raise, now);
      drawFrame(ctx);

      // taker pose
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
      const preKick = s.phase === "aim" || s.phase === "runup";

      // ball
      let bx = SPOT.x, by = SPOT.y, br = 11, spin = 0;
      let shadow: { x: number; y: number } | undefined;
      if (s.phase === "flight") {
        const p = clamp(el / FLIGHT_MS);
        bx = lerp(SPOT.x, s.target.x, p);
        const ground = lerp(SPOT.y, s.target.y, p);
        by = ground - Math.sin(Math.PI * p) * 70;
        br = lerp(11, 6.5, p);
        spin = p * 14;
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
      drawTaker(ctx, tx, ty, 1.15, swing, s.phase === "aim" ? null : kick);
      if (!preKick) drawBall(ctx, bx, by, br, spin, shadow);

      // aiming reticle
      if (s.phase === "aim") {
        const { x, y } = s.hover;
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 24, y); ctx.lineTo(x - 8, y);
        ctx.moveTo(x + 8, y); ctx.lineTo(x + 24, y);
        ctx.moveTo(x, y - 24); ctx.lineTo(x, y - 8);
        ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 24);
        ctx.stroke();
      }
      ctx.restore();
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

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse" || aiming.current) g.current.hover = toCanvas(e);
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (g.current.phase !== "aim") return;
    if (e.pointerType === "mouse") {
      shoot(toCanvas(e)); // mouse: click to shoot
      return;
    }
    // touch: press and drag to aim, release to shoot
    aiming.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    g.current.hover = toCanvas(e);
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!aiming.current) return;
    aiming.current = false;
    shoot(toCanvas(e));
  }

  function shoot(t: { x: number; y: number }) {
    const s = g.current;
    if (s.phase !== "aim") return;
    s.hover = t;
    s.target = t;

    // keeper picks a dive: mostly random, sometimes he reads the shot
    if (Math.random() < 0.2) {
      s.dive = DIVES.reduce((best, d) =>
        Math.hypot(d.x - t.x, d.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y) ? d : best
      );
    } else {
      s.dive = DIVES[Math.floor(Math.random() * DIVES.length)];
    }

    // decide the result up front, using where the keeper will be on arrival
    const outside = t.x < GOAL.x + 6 || t.x > GOAL.x + GOAL.w - 6 || t.y < GOAL.y + 6;
    const rx = s.dive.wide ? 78 : 44;
    const ry = s.dive.wide ? 40 : 60;
    const reached = ((t.x - s.dive.x) / rx) ** 2 + ((t.y - s.dive.y) / ry) ** 2 < 1;
    s.outcome = outside ? "missed" : reached ? "saved" : "goal";

    s.phase = "runup";
    s.t0 = performance.now();
  }

  function restart() {
    g.current = newGame();
    setScore(0);
    setHistory([]);
    setMessage(null);
    setFinished(false);
  }

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const label: Record<Outcome, string> = { goal: "GOAL!", saved: "SAVED!", missed: "MISSED!" };

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
      </div>

      <div className="stage">
        <canvas
          ref={canvasRef}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => { aiming.current = false; }}
          aria-label="Penalty pitch. Click inside or near the goal to aim and shoot."
        />
        {message && <div className={`banner ${message}`}>{label[message]}</div>}
        {finished && (
          <div className="end">
            <h2>{score >= 4 ? "Champion!" : score >= 3 ? "Not bad!" : "Keep practising!"}</h2>
            <p>You scored {score} out of {TOTAL_SHOTS}</p>
            <button className="restart" onClick={restart}>Play again</button>
          </div>
        )}
      </div>

      <p className="hint">
        {finished ? "" : `Shot ${Math.min(g.current.shots + 1, TOTAL_SHOTS)} of ${TOTAL_SHOTS}: ${coarse ? "drag to aim, release to shoot" : "click where you want to shoot"}`}
      </p>
    </main>
  );
}
