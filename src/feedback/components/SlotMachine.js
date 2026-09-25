/**
 * reels, [{ digit, rev, locked }]. rev changes whenever the digit changes so the roll animation replays.
 * state, idle | spinning | landed | revealed.
 */
export default function SlotMachine({ reels, state, label }) {
  return (
    <div className={`slot-machine is-${state}`}>
      <span className="sr-only" aria-live="polite">{label}</span>
      {reels.map((r, i) => (
        <div className={`slot-reel${r.locked ? " is-locked" : ""}`} key={i} aria-hidden="true">
          <span className="slot-digit" key={r.rev}>{r.digit}</span>
        </div>
      ))}
    </div>
  );
}
