import { useState } from "react";
import "./App.css";

const TOTAL_SHOTS = 5;
const ZONE_LABELS = ["Top left", "Top middle", "Top right", "Bottom left", "Bottom middle", "Bottom right"];

// Position (as % of the goal box) where the ball / keeper ends up for each zone
const ZONE_POS = [
  { left: 17, top: 25 },
  { left: 50, top: 25 },
  { left: 83, top: 25 },
  { left: 17, top: 70 },
  { left: 50, top: 70 },
  { left: 83, top: 70 },
];

type Result = "goal" | "saved" | null;

export default function App() {
  const [shot, setShot] = useState(0);
  const [score, setScore] = useState(0);
  const [ballZone, setBallZone] = useState<number | null>(null);
  const [keeperZone, setKeeperZone] = useState<number | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<boolean[]>([]);

  const finished = shot >= TOTAL_SHOTS && !busy;

  function shoot(zone: number) {
    if (busy || shot >= TOTAL_SHOTS) return;
    setBusy(true);
    setBallZone(zone);

    const keeper = Math.floor(Math.random() * 6);
    setKeeperZone(keeper);

    setTimeout(() => {
      const scored = keeper !== zone;
      setResult(scored ? "goal" : "saved");
      if (scored) setScore((s) => s + 1);
      setHistory((h) => [...h, scored]);
    }, 900);

    setTimeout(() => {
      setBallZone(null);
      setKeeperZone(null);
      setResult(null);
      setShot((s) => s + 1);
      setBusy(false);
    }, 1400);
  }

  function restart() {
    setShot(0);
    setScore(0);
    setHistory([]);
    setResult(null);
  }

  const ballStyle = ballZone !== null ? { left: `${ZONE_POS[ballZone].left}%`, top: `${ZONE_POS[ballZone].top}%` } : undefined;
  const keeperStyle = keeperZone !== null ? { left: `${ZONE_POS[keeperZone].left}%`, top: `${ZONE_POS[keeperZone].top}%` } : undefined;

  return (
    <main className="game">
      <h1>Penalty Shootout</h1>
      <p className="score">Score: {score} / {TOTAL_SHOTS}</p>
      <div className="history" aria-label="Shot history">
        {Array.from({ length: TOTAL_SHOTS }, (_, i) => (
          <span key={i} className={`dot ${history[i] === undefined ? "" : history[i] ? "hit" : "miss"}`} />
        ))}
      </div>

      <div className="goal">
        <div className="keeper" style={keeperStyle}>🧤</div>
        <div className="ball" style={ballStyle}>⚽</div>
        <div className="zones">
          {ZONE_LABELS.map((label, i) => (
            <button key={i} className="zone" aria-label={`Shoot ${label}`} disabled={busy || finished} onClick={() => shoot(i)} />
          ))}
        </div>
        {result && <div className={`banner ${result}`}>{result === "goal" ? "GOAL!" : "SAVED!"}</div>}
      </div>

      {finished ? (
        <div className="end">
          <h2>{score >= 4 ? "Champion!" : score >= 3 ? "Not bad!" : "Keep practising!"}</h2>
          <button className="restart" onClick={restart}>Play again</button>
        </div>
      ) : (
        <p className="hint">Shot {Math.min(shot + 1, TOTAL_SHOTS)} of {TOTAL_SHOTS}: pick a corner</p>
      )}
    </main>
  );
}
