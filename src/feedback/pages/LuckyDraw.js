import { useCallback, useEffect, useRef, useState } from "react";
import api, { errorMessage, padId } from "../api";
import SlotMachine from "../components/SlotMachine";
import Confetti from "../components/Confetti";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";

// Survives a page refresh, so a landed number or a finished draw is never lost mid-event.
const DRAW_KEY = "luckyDrawState";
const TICK_MS = 30;
const FAST_MS = 55; // digit change speed at full spin
const WAIT_MS = 240; // speed while waiting on a slow network after the timer ends

const EMPTY_DRAW = { attempts: 0, phase: "idle", entryId: null, padLength: 2, winner: null };

function readDraw() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAW_KEY) || "null");
    if (saved && ["idle", "landed", "revealed"].includes(saved.phase)) return { ...EMPTY_DRAW, ...saved };
  } catch (e) {
    /* ignore */
  }
  return EMPTY_DRAW;
}

function saveDraw(state) {
  try {
    sessionStorage.setItem(DRAW_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore */
  }
}

function blankReels(n) {
  return Array.from({ length: n }, () => ({ digit: "-", rev: 0, locked: false }));
}

function numberReels(id, length) {
  return String(id)
    .padStart(length, "0")
    .split("")
    .map((digit) => ({ digit, rev: 0, locked: true }));
}

function randomDigit(not) {
  let d;
  do d = String(Math.floor(Math.random() * 10));
  while (d === not);
  return d;
}

// Only used by the winner history table, which is commented out below. Restore both together.
// function formatDate(iso) {
//   return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// }

export default function LuckyDraw() {
  const notify = useToast();
  const [initial] = useState(readDraw);
  const [pool, setPool] = useState(null);
  const [attempts, setAttempts] = useState(initial.attempts);
  // idle | spinning | landed | revealing | revealed
  // While landed with spins left the draw can spin again. Revealing the name finishes the draw.
  const [phase, setPhase] = useState(initial.phase);
  const [reels, setReels] = useState(() =>
    initial.entryId !== null ? numberReels(initial.entryId, initial.padLength) : blankReels(initial.padLength)
  );
  const [entryId, setEntryId] = useState(initial.entryId);
  const [winner, setWinner] = useState(initial.winner);
  // The winners value is only read by the commented out winner history table, the setter is still used.
  // Restore with the table: const [winners, setWinners] = useState([]);
  const [, setWinners] = useState([]);
  const [celebrate, setCelebrate] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const stageRef = useRef(null);
  const timerRef = useRef(null);
  const celebrateRef = useRef(null);
  const spinRef = useRef(null); // live data for the running spin

  const padLength = pool?.pad_length || 2;
  const maxSpins = pool?.max_spin_attempts || 0;
  const spinSeconds = pool?.spin_duration_seconds || 5;

  const loadPool = useCallback(async () => {
    try {
      const { data } = await api.get("/lucky-draw/pool/");
      setPool(data);
      return data;
    } catch (err) {
      notify(errorMessage(err), "danger", { title: "Could not load the draw" });
      return null;
    }
  }, [notify]);

  const loadWinners = useCallback(async () => {
    try {
      const { data } = await api.get("/lucky-draw/winners/");
      setWinners(data);
    } catch (err) {
      /* history is optional */
    }
  }, []);

  useEffect(() => {
    loadPool();
    loadWinners();
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(celebrateRef.current);
    };
  }, [loadPool, loadWinners]);

  // Keep the blank reels in step with the pool size until the first spin.
  useEffect(() => {
    if (phase === "idle" && entryId === null) setReels(blankReels(padLength));
  }, [padLength, phase, entryId]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const poolEmpty = !pool || pool.count === 0;
  const outOfSpins = maxSpins > 0 && attempts >= maxSpins;
  const spinsLeft = maxSpins > 0 ? Math.max(0, maxSpins - attempts) : null;
  const canSpin = !poolEmpty && !outOfSpins && (phase === "idle" || phase === "landed");
  const canReveal = phase === "landed";
  // A new draw starts only once this one is finished. The second case covers a spin cut off by a
  // page refresh before its number arrived, with no spins left, so the draw can never get stuck.
  const canStartNew = phase === "revealed" || (phase === "idle" && outOfSpins);

  // One timer drives every reel. Each reel slows down as it nears its lock time, then locks on its digit.
  const tick = useCallback(() => {
    const s = spinRef.current;
    if (!s) return;
    const now = performance.now();
    const elapsed = now - s.start;
    const target = s.result ? String(s.result.submission_id).padStart(s.length, "0") : null;
    let changed = false;
    const next = s.reels.map((r, i) => {
      if (r.locked) return r;
      const lockAt = s.lockTimes[i];
      if (target && elapsed >= lockAt) {
        changed = true;
        return { digit: target[i], rev: r.rev + 1, locked: true };
      }
      if (now < s.nextChange[i]) return r;
      const remaining = lockAt - elapsed;
      let delay;
      if (remaining <= 0) delay = WAIT_MS;
      else if (remaining > s.slowWindow) delay = FAST_MS;
      else delay = FAST_MS + Math.pow(1 - remaining / s.slowWindow, 2) * 300;
      s.nextChange[i] = now + Math.min(delay, Math.max(remaining, TICK_MS));
      changed = true;
      return { digit: randomDigit(r.digit), rev: r.rev + 1, locked: false };
    });
    if (!changed) return;
    s.reels = next;
    setReels(next);
    if (next.every((r) => r.locked)) {
      clearInterval(timerRef.current);
      setEntryId(s.result.submission_id);
      setPhase("landed");
    }
  }, []);

  const startTimer = (length) => {
    const duration = spinSeconds * 1000;
    // The last reel locks exactly at the configured time, earlier reels lock a little before it.
    const stagger = Math.min(650, (duration * 0.45) / Math.max(1, length - 1));
    spinRef.current = {
      start: performance.now(),
      length,
      reels: blankReels(length).map((r) => ({ ...r, digit: randomDigit() })),
      lockTimes: Array.from({ length }, (_, i) => duration - (length - 1 - i) * stagger),
      nextChange: Array(length).fill(0),
      slowWindow: Math.min(1600, duration * 0.55),
      result: null,
    };
    setReels(spinRef.current.reels);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(tick, TICK_MS);
  };

  const spin = async () => {
    if (!canSpin) return;
    const prev = { phase, entryId, reels };
    const next = attempts + 1;
    setAttempts(next);
    saveDraw({ attempts: next, phase: prev.phase, entryId: prev.entryId, padLength: prev.reels.length, winner: null });
    setEntryId(null);
    setCelebrate(false);
    setPhase("spinning");
    startTimer(padLength);

    try {
      const { data } = await api.post("/lucky-draw/spin/");
      const s = spinRef.current;
      const length = Math.max(data.pad_length || padLength, String(data.submission_id).length);
      if (length !== s.length) {
        // New entries pushed the ID past the current digit count, restart the reels with the right size.
        const offset = s.start;
        startTimer(length);
        spinRef.current.start = offset;
      }
      spinRef.current.result = data;
      saveDraw({ attempts: next, phase: "landed", entryId: data.submission_id, padLength: length, winner: null });
    } catch (err) {
      // The spin did not happen, give the attempt back and put the previous number back on the reels.
      clearInterval(timerRef.current);
      spinRef.current = null;
      setAttempts(next - 1);
      setPhase(prev.phase);
      setEntryId(prev.entryId);
      setReels(prev.reels);
      saveDraw({ attempts: next - 1, phase: prev.phase, entryId: prev.entryId, padLength: prev.reels.length, winner: null });
      notify(errorMessage(err), "danger", { title: "Spin failed" });
    }
  };

  const reveal = async () => {
    if (!canReveal || entryId === null) return;
    setPhase("revealing");
    try {
      const { data } = await api.post("/lucky-draw/reveal/", { submission_id: entryId, attempt_number: attempts });
      setWinner(data);
      setPhase("revealed");
      saveDraw({ attempts, phase: "revealed", entryId, padLength: reels.length, winner: data });
      setCelebrate(true);
      clearTimeout(celebrateRef.current);
      celebrateRef.current = setTimeout(() => setCelebrate(false), 5500);
      loadWinners();
      loadPool();
    } catch (err) {
      if (err?.response?.status === 400) {
        // Suspended, or already a winner, since it landed. Give the attempt back so the draw can go on.
        const back = Math.max(0, attempts - 1);
        const entry = padId(entryId, reels.length);
        setAttempts(back);
        setPhase("idle");
        setEntryId(null);
        setReels(blankReels(padLength));
        saveDraw({ ...EMPTY_DRAW, attempts: back, padLength });
        loadPool();
        notify(`Entry ${entry} is no longer eligible, the attempt was given back. Spin again.`, "warning", {
          title: "Entry not eligible",
        });
      } else {
        setPhase("landed");
        notify(errorMessage(err, "The name could not be revealed, try again."), "danger", { title: "Reveal failed" });
      }
    }
  };

  const startNewDraw = () => {
    if (!canStartNew) return;
    clearInterval(timerRef.current);
    clearTimeout(celebrateRef.current);
    spinRef.current = null;
    setAttempts(0);
    setPhase("idle");
    setEntryId(null);
    setWinner(null);
    setCelebrate(false);
    saveDraw({ ...EMPTY_DRAW, padLength });
    loadPool().then((data) => setReels(blankReels(data?.pad_length || padLength)));
    notify("Attempts are reset, the reels are ready for the next prize.", "info", { title: "New draw" });
  };

  const clearHistory = async () => {
    setClearing(true);
    try {
      await api.delete("/lucky-draw/winners/");
      setWinners([]);
      setConfirmClear(false);
      notify("Past winners were removed from the list and can be drawn again.", "success", { title: "History cleared" });
      loadPool();
    } catch (err) {
      notify(errorMessage(err), "danger");
    } finally {
      setClearing(false);
    }
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => notify("Full screen is not available in this browser.", "warning"));
  };

  // Presenter shortcuts, Space spins, Enter reveals, N starts the next draw.
  const actions = useRef({});
  actions.current = { spin, reveal, startNewDraw, canSpin, canReveal, canStartNew };
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(tag) || document.body.classList.contains("modal-open")) return;
      if (e.code === "Space" && actions.current.canSpin) {
        e.preventDefault();
        actions.current.spin();
      } else if (e.key === "Enter" && actions.current.canReveal) {
        e.preventDefault();
        actions.current.reveal();
      } else if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && actions.current.canStartNew) {
        e.preventDefault();
        actions.current.startNewDraw();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Only used by the attempt chip in the top bar, which is commented out below. Restore both together.
  // const attemptText =
  //   attempts === 0 ? "No spins yet" : maxSpins > 0 ? `Attempt ${attempts} of ${maxSpins}` : `Attempt ${attempts}`;
  const entryText = entryId !== null ? padId(entryId, reels.length) : "";

  let srLabel = "Ready to spin";
  if (phase === "spinning") srLabel = "Spinning";
  else if (phase === "landed" || phase === "revealing") srLabel = `Entry ${entryText} drawn, reveal the name or spin again`;
  else if (phase === "revealed" && winner) srLabel = `Winner ${winner.attendee_name}, entry ${entryText}`;

  let landedHint = "No spins left, reveal the name to finish this draw.";
  if (!outOfSpins) {
    landedHint = "Reveal the name to finish this draw, or spin again for another number.";
    if (spinsLeft !== null) landedHint += ` ${spinsLeft} spin${spinsLeft > 1 ? "s" : ""} left.`;
  }

  return (
    <div className="draw-page">
      <section className={`draw-stage phase-${phase}${fullscreen ? " is-fullscreen" : ""}`} ref={stageRef}>
        {/* Inside the stage so the confetti still shows in full screen */}
        {celebrate && <Confetti />}

        <div className="draw-topbar">
          <div className="draw-meta">
            <span className="draw-chip">{pool ? `${pool.count} eligible entries` : "Loading pool"}</span>
            {/* {pool && pool.count > 0 && (
              <span className="draw-chip">Range {padId(1, padLength)} to {padId(pool.max_id, padLength)}</span>
            )}
            {pool?.past_winners > 0 && (
              <span className="draw-chip">
                {pool.past_winners} past winner{pool.past_winners > 1 ? "s" : ""} excluded
              </span>
            )}
            <span className="draw-chip">{spinSeconds}s spin</span>
            <span className="draw-chip draw-chip-strong">{attemptText}</span> */}
          </div>
          <button type="button" className={`btn-fullscreen${fullscreen ? " is-on" : ""}`} onClick={toggleFullscreen} aria-pressed={fullscreen}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
            <span>{fullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>
        </div>

        <p className="draw-kicker">{process.env.REACT_APP_EVENT_NAME || "Summit"}</p>
        <h1 className="draw-title">Lucky draw</h1>

        <SlotMachine reels={reels} state={phase === "revealing" ? "landed" : phase} label={srLabel} />

        <div className="spin-progress" aria-hidden="true">
          {phase === "spinning" && (
            <span className="spin-progress-bar" key={attempts} style={{ animationDuration: `${spinSeconds}s` }} />
          )}
        </div>

        <div className="winner-area" aria-live="assertive">
          {phase === "idle" && (
            <p className="draw-hint">
              {poolEmpty && pool
                ? "No eligible entries. Entries appear once attendees submit feedback, and past winners are left out."
                : canStartNew
                ? "The last spin was interrupted and no spins are left. Start the next draw."
                : "Press Spin to start. The reels stop on their own."}
            </p>
          )}
          {phase === "spinning" && <p className="draw-hint">Drawing an entry</p>}
          {(phase === "landed" || phase === "revealing") && (
            <div className="entry-card">
              <p className="winner-kicker">Entry drawn</p>
              <p className="entry-number">No. {entryText}</p>
              <p className="draw-hint mb-0">{landedHint}</p>
            </div>
          )}
          {phase === "revealed" && winner && (
            <div className="winner-card">
              <p className="winner-kicker">Congratulations, entry {entryText}</p>
              <p className="winner-name">{winner.attendee_name}</p>
              {winner.company_name && <p className="winner-company">{winner.company_name}</p>}
            </div>
          )}
        </div>

        <div className="draw-controls">
          {canStartNew ? (
            <button className="btn btn-draw btn-lg" onClick={startNewDraw}>
              Start next draw
            </button>
          ) : (
            <>
              <button className="btn btn-draw btn-lg" onClick={spin} disabled={!canSpin}>
                {phase === "spinning" ? (
                  <>
                    <span className="spinner-border spinner-border-sm mr-2" aria-hidden="true" />
                    Spinning
                  </>
                ) : attempts === 0 ? (
                  "Spin"
                ) : (
                  "Spin again"
                )}
              </button>
              <button className={`btn btn-reveal btn-lg${canReveal ? " is-ready" : ""}`} onClick={reveal} disabled={!canReveal}>
                {phase === "revealing" ? (
                  <>
                    <span className="spinner-border spinner-border-sm mr-2" aria-hidden="true" />
                    Revealing
                  </>
                ) : (
                  "Reveal name"
                )}
              </button>
            </>
          )}
        </div>

        {phase === "revealed" && <p className="draw-note">This draw is finished. Start the next draw for the next prize.</p>}

        <div className="draw-footer">
          <span className="draw-shortcuts">Space to spin, Enter to reveal, N for the next draw</span>
        </div>
      </section>

      {/* <section className="mt-4">
        <div className="section-head">
          <h2 className="h5 mb-0">Winner history</h2>
          {winners.length > 0 && (
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setConfirmClear(true)}>Clear history</button>
          )}
        </div>
        <div className="table-card">
          <table className="table table-stack mb-0">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Attendee name</th>
                <th>Company</th>
                <th>Attempt</th>
                <th>Drawn by</th>
                <th>Drawn at</th>
              </tr>
            </thead>
            <tbody>
              {winners.length === 0 && (
                <tr className="empty-row"><td colSpan={6} className="text-center text-muted py-4">Revealed winners are listed here.</td></tr>
              )}
              {winners.map((w) => (
                <tr key={w.id}>
                  <td data-label="Entry" className="id-cell">{padId(w.submission_id, padLength)}</td>
                  <td data-label="Attendee" className="font-weight-bold">{w.attendee_name}</td>
                  <td data-label="Company">{w.company_name || "Not listed"}</td>
                  <td data-label="Attempt">{w.attempt_number}</td>
                  <td data-label="Drawn by">{w.drawn_by || "Unknown"}</td>
                  <td data-label="Drawn at" className="text-nowrap">{formatDate(w.drawn_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section> */}

      {confirmClear && (
        <ConfirmDialog
          title="Clear winner history"
          confirmLabel="Clear history"
          busy={clearing}
          onConfirm={clearHistory}
          onCancel={() => setConfirmClear(false)}
        >
          This removes every revealed winner from the list, and those entries can be drawn again. Submissions are not affected.
        </ConfirmDialog>
      )}
    </div>
  );
}
