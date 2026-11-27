/**
 * reels, [{ digit, rev, locked }]. rev changes whenever the digit changes so the roll animation replays.
 * state, idle | spinning | landed | revealed.
 */
export default function SlotMachine({ reels, state, label }) {
  return (
    <div className={`dlgfb-slot-machine dlgfb-is-${state}`}>
      <span className="dlgfb-sr-only" aria-live="polite">{label}</span>
      {reels.map((r, i) => (
        <div className={`dlgfb-slot-reel${r.locked ? " dlgfb-is-locked" : ""}`} key={i} aria-hidden="true">
          <span className="dlgfb-slot-digit" key={r.rev}>{r.digit}</span>
        </div>
      ))}
    </div>
  );
}
