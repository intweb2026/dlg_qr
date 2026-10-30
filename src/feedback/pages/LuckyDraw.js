import { useCallback, useEffect, useRef, useState } from "react";
import api, { errorMessage, eventKey, padId } from "../api";
import SlotMachine from "../components/SlotMachine";
import Confetti from "../components/Confetti";
import NameScramble from "../components/NameScramble";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";

// Survives a page refresh, so a landed number or a finished draw is never lost mid-event.
const drawKey = () => eventKey("luckyDrawState");
const TICK_MS = 30;
const FAST_MS = 55; // digit change speed at full spin
const WAIT_MS = 240; // speed while waiting on a slow network after the timer ends
const SUSPENSE_MS = 3000; // suspense between the reels stopping and the name showing

const EMPTY_DRAW = { attempts: 0, phase: "idle", entryId: null, padLength: 2, winner: null };

const THEMES = ["default", "white", "black"];
const themeKey = () => eventKey("luckyDrawTheme");

function readTheme() {
  try {
    const saved = sessionStorage.getItem(themeKey());
    if (THEMES.includes(saved)) return saved;
  } catch (e) {
    /* ignore */
  }
  return "default";
}

function saveTheme(theme) {
  try {
    sessionStorage.setItem(themeKey(), theme);
  } catch (e) {
    /* ignore */
  }
}

function readDraw() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(drawKey()) || "null");
    if (saved && ["idle", "landed", "revealed"].includes(saved.phase)) return { ...EMPTY_DRAW, ...saved };
  } catch (e) {
    /* ignore */
  }
  return EMPTY_DRAW;
}

function saveDraw(state) {
  try {
    sessionStorage.setItem(drawKey(), JSON.stringify(state));
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

// The winner's name, letter by letter so each one can drop in after the one before it.
// Letters sit inside a span per word, so a long name wraps between words, never inside one.
// --p0 and --p1 place each letter along the name, so the White and Black themes can run one gradient across all letters.
function WinnerName({ name }) {
  const total = Math.max(1, name.replace(/ /g, "").length);
  let index = 0;
  return (
    <p className="dlgfb-winner-name dlgfb-is-animated" aria-label={name}>
      {name.split(" ").map((word, w) => (
        <span className="dlgfb-winner-word" key={w} aria-hidden="true">
          {word.split("").map((ch) => {
            const i = index++;
            return (
              <span
                className="dlgfb-winner-letter"
                key={i}
                style={{ animationDelay: `${0.1 + i * 0.045}s`, "--p0": i / total, "--p1": (i + 1) / total }}
              >
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}

// Only used by the winner history table, which is commented out below. Restore both together.
// function formatDate(iso) {
//   return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// }

/**
 * autoFullscreen, used by the standalone /lucky-draw page. The stage fills the whole window from the start,
 * and the first click or key press switches the browser to real full screen. Browsers refuse full screen
 * without a user action, so it cannot happen on page load alone.
 */
export default function LuckyDraw({ autoFullscreen = false }) {
  const notify = useToast();
  const [initial] = useState(readDraw);
  const [theme, setTheme] = useState(readTheme);
  const [pool, setPool] = useState(null);
  const [attempts, setAttempts] = useState(initial.attempts);
  // idle | spinning | landed | revealing | revealed
  // The name is revealed automatically as soon as the reels land, which finishes the draw.
  const [phase, setPhase] = useState(initial.phase);
  const [reels, setReels] = useState(() =>
    initial.entryId !== null ? numberReels(initial.entryId, initial.padLength) : blankReels(initial.padLength)
  );
  const [entryId, setEntryId] = useState(initial.entryId);
  const [winner, setWinner] = useState(initial.winner);
  // The winners value is only read by the commented out winner history table, the setter is still used.
  // Restore with the table: const [winners, setWinners] = useState([]);
  const [, setWinners] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Set when the automatic reveal fails on the network, so it is not retried in a loop.
  const [revealFailed, setRevealFailed] = useState(false);
  // The answer from the server during the suspense, only its shape is shown by the scramble.
  const [pending, setPending] = useState(null);

  const stageRef = useRef(null);
  const timerRef = useRef(null);
  const spinRef = useRef(null); // live data for the running spin
  const suspenseRef = useRef(null);
  const nextSpinRef = useRef(false); // set by the top bar Spin button, spins once the reset has rendered

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
      clearTimeout(suspenseRef.current);
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

  useEffect(() => {
    if (!autoFullscreen) return undefined;
    const enter = (e) => {
      // The Full screen button handles its own click, entering here too would toggle straight back out.
      if (e?.target?.closest?.(".btn-fullscreen:not(.btn-next-spin)")) return;
      if (!document.fullscreenElement) stageRef.current?.requestFullscreen?.().catch(() => {});
      stop();
    };
    const stop = () => {
      document.removeEventListener("pointerdown", enter);
      document.removeEventListener("keydown", enter);
    };
    // Works when the browser allows it on load, for example in kiosk mode, otherwise it waits for the first action.
    stageRef.current?.requestFullscreen?.().then(stop, () => {});
    document.addEventListener("pointerdown", enter);
    document.addEventListener("keydown", enter);
    return stop;
  }, [autoFullscreen]);

  const poolEmpty = !pool || pool.count === 0;
  const outOfSpins = maxSpins > 0 && attempts >= maxSpins;
  const canSpin = !poolEmpty && !outOfSpins && phase === "idle";
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
    setRevealFailed(false);
    setPending(null);
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
    const started = performance.now();
    try {
      const { data } = await api.post("/lucky-draw/reveal/", { submission_id: entryId, attempt_number: attempts });
      // Saved straight away, the server has recorded the winner, so a refresh during the suspense shows the name.
      saveDraw({ attempts, phase: "revealed", entryId, padLength: reels.length, winner: data });
      setPending(data);
      // The name shows once the suspense has run, even when the server answered sooner.
      const wait = SUSPENSE_MS - (performance.now() - started);
      if (wait > 0) await new Promise((done) => (suspenseRef.current = setTimeout(done, wait)));
      setWinner(data);
      setPhase("revealed");
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
        setRevealFailed(true);
        setPhase("landed");
        notify(errorMessage(err, "The name could not be revealed, try again."), "danger", { title: "Reveal failed" });
      }
    }
  };

  // Reveal the name as soon as the reels stop, also after a refresh that happened on a landed number.
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (phase === "landed" && !revealFailed) revealRef.current();
  }, [phase, revealFailed]);

  // The top bar Spin button resets the finished draw and spins straight away for the next prize.
  const spinNext = () => {
    if (!canStartNew) return;
    clearInterval(timerRef.current);
    spinRef.current = null;
    setAttempts(0);
    setPhase("idle");
    setEntryId(null);
    setWinner(null);
    setRevealFailed(false);
    saveDraw({ ...EMPTY_DRAW, padLength });
    nextSpinRef.current = true;
    loadPool();
  };

  const spinActionRef = useRef(spin);
  spinActionRef.current = spin;
  useEffect(() => {
    if (nextSpinRef.current && phase === "idle" && attempts === 0) {
      nextSpinRef.current = false;
      spinActionRef.current();
    }
  }, [phase, attempts]);

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

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(next);
    saveTheme(next);
  };

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => notify("Full screen is not available in this browser.", "warning"));
  };

  // Only used by the attempt chip in the top bar, which is commented out below. Restore both together.
  // const attemptText =
  //   attempts === 0 ? "No spins yet" : maxSpins > 0 ? `Attempt ${attempts} of ${maxSpins}` : `Attempt ${attempts}`;
  // The confetti runs for as long as the winner is on screen, the saved phase brings it back after a refresh.
  const celebrate = phase === "revealed" && !!winner;
  const entryText = entryId !== null ? padId(entryId, reels.length) : "";

  let srLabel = "Ready to spin";
  if (phase === "spinning") srLabel = "Spinning";
  else if (phase === "landed" || phase === "revealing") srLabel = `Entry ${entryText} drawn, revealing the name`;
  else if (phase === "revealed" && winner) srLabel = `Winner ${winner.attendee_name}, entry ${entryText}`;

  return (
    <div className="dlgfb-draw-page">
      <section
        className={`dlgfb-draw-stage dlgfb-theme-${theme} dlgfb-phase-${phase}${fullscreen || autoFullscreen ? " dlgfb-is-fullscreen" : ""}${autoFullscreen ? " dlgfb-is-window" : ""}`}
        ref={stageRef}
      >
        {/* Inside the stage so the confetti still shows in full screen */}
        {celebrate && <Confetti />}

        <div className="dlgfb-draw-topbar">
          <div className="dlgfb-draw-meta">
            {/* {pool && pool.count > 0 && (
              <span className="dlgfb-draw-chip">Range {padId(1, padLength)} to {padId(pool.max_id, padLength)}</span>
            )}
            {pool?.past_winners > 0 && (
              <span className="dlgfb-draw-chip">
                {pool.past_winners} past winner{pool.past_winners > 1 ? "s" : ""} excluded
              </span>
            )}
            <span className="dlgfb-draw-chip">{spinSeconds}s spin</span>
            <span className="dlgfb-draw-chip dlgfb-draw-chip-strong">{attemptText}</span> */}
          </div>
          <div className="dlgfb-draw-actions">
            {canStartNew && (
              <button type="button" className="dlgfb-btn-fullscreen dlgfb-btn-next-spin" onClick={spinNext} disabled={poolEmpty} aria-label="Spin for the next prize">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 12a8 8 0 11-2.34-5.66" />
                  <path d="M20 4v4.5h-4.5" />
                </svg>
                <span>Spin</span>
              </button>
            )}
            <button
              type="button"
              className="dlgfb-btn-fullscreen dlgfb-btn-theme"
              onClick={cycleTheme}
              aria-label={`Change theme, current theme ${theme}`}
              title={`Theme: ${theme}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 000 18z" fill="currentColor" />
              </svg>
              <span>Theme</span>
            </button>
            <button type="button" className={`dlgfb-btn-fullscreen${fullscreen ? " dlgfb-is-on" : ""}`} onClick={toggleFullscreen} aria-pressed={fullscreen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
              </svg>
              <span>{fullscreen ? "Exit full screen" : "Full screen"}</span>
            </button>
          </div>
        </div>

        <h1 className="dlgfb-draw-title">
          {phase === "revealed" && winner ? "Congratulations!" : "Raffle Draw"}
        </h1>

        <SlotMachine reels={reels} state={phase === "revealing" ? "suspense" : phase} label={srLabel} />

        <div className="dlgfb-spin-progress" aria-hidden="true">
          {phase === "spinning" && (
            <span className="dlgfb-spin-progress-bar" key={attempts} style={{ animationDuration: `${spinSeconds}s` }} />
          )}
        </div>

        <div className="dlgfb-winner-area" aria-live="assertive">
          {/* Before the first spin nothing is shown, only these two problem cases get a message. */}
          {phase === "idle" && ((poolEmpty && pool) || canStartNew) && (
            <p className="dlgfb-draw-hint">
              {poolEmpty && pool
                ? "No eligible entries. Entries appear once attendees submit feedback, and past winners are left out."
                : "The last spin was interrupted and no spins are left. Press Spin at the top to start the next draw."}
              {/* : `Press Spin to start. The reels stop after ${spinSeconds} seconds and the winner's name is shown.` */}
            </p>
          )}
          {phase === "spinning" && <p className="dlgfb-draw-hint">Drawing an entry</p>}
          {phase === "landed" && revealFailed && (
            <div className="dlgfb-entry-card">
              <p className="dlgfb-winner-kicker">Entry drawn</p>
              <p className="dlgfb-entry-number">No. {entryText}</p>
              <p className="dlgfb-draw-hint dlgfb-mb-0">The name could not be revealed.</p>
            </div>
          )}
          {(phase === "revealing" || (phase === "landed" && !revealFailed)) && (
            <div className="dlgfb-suspense-card">
              <p className="dlgfb-winner-kicker">Entry No. {entryText}</p>
              <NameScramble name={pending?.attendee_name} />
              <p className="dlgfb-suspense-text">
                And the winner is
                <span className="dlgfb-suspense-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
              </p>
            </div>
          )}
          {phase === "revealed" && winner && (
            <div className="dlgfb-winner-card">
              <WinnerName name={winner.attendee_name} />
              {winner.company_name && <p className="dlgfb-winner-company">{winner.company_name}</p>}
            </div>
          )}
        </div>

        {/* The big Spin button is for the first draw only, after a reveal the next spin is in the top bar. */}
        <div className="dlgfb-draw-controls">
          {(phase === "idle" || phase === "spinning") && !canStartNew && (
            <button className="dlgfb-btn dlgfb-btn-draw dlgfb-btn-lg" onClick={spin} disabled={!canSpin}>
              {phase === "spinning" ? (
                <>
                  <span className="dlgfb-spinner-border dlgfb-spinner-border-sm dlgfb-mr-2" aria-hidden="true" />
                  Spinning
                </>
              ) : (
                "Spin"
              )}
            </button>
          )}
          {/* Only shown when the automatic reveal failed, so the draw is never stuck on a number. */}
          {revealFailed && canReveal && (
            <button className="dlgfb-btn dlgfb-btn-reveal dlgfb-btn-lg dlgfb-is-ready" onClick={() => setRevealFailed(false)}>
              Try again
            </button>
          )}
        </div>

        {/* {phase === "revealed" && <p className="dlgfb-draw-note">This draw is finished. Start the next draw for the next prize.</p>} */}
      </section>

      {/* <section className="dlgfb-mt-4">
        <div className="dlgfb-section-head">
          <h2 className="dlgfb-h5 dlgfb-mb-0">Winner history</h2>
          {winners.length > 0 && (
            <button className="dlgfb-btn dlgfb-btn-sm dlgfb-btn-outline-secondary" onClick={() => setConfirmClear(true)}>Clear history</button>
          )}
        </div>
        <div className="dlgfb-table-card">
          <table className="dlgfb-table dlgfb-table-stack dlgfb-mb-0">
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
                <tr className="dlgfb-empty-row"><td colSpan={6} className="dlgfb-text-center dlgfb-text-muted dlgfb-py-4">Revealed winners are listed here.</td></tr>
              )}
              {winners.map((w) => (
                <tr key={w.id}>
                  <td data-label="Entry" className="dlgfb-id-cell">{padId(w.submission_id, padLength)}</td>
                  <td data-label="Attendee" className="dlgfb-font-weight-bold">{w.attendee_name}</td>
                  <td data-label="Company">{w.company_name || "Not listed"}</td>
                  <td data-label="Attempt">{w.attempt_number}</td>
                  <td data-label="Drawn by">{w.drawn_by || "Unknown"}</td>
                  <td data-label="Drawn at" className="dlgfb-text-nowrap">{formatDate(w.drawn_at)}</td>
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
