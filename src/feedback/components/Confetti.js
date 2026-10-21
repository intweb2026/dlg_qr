import { useMemo } from "react";

const COLORS = ["#c99a2e", "#0f766e", "#e8c46a", "#16213e", "#f2efe6", "#d9534f"];

export default function Confetti({ pieces = 90 }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const duration = 2.4 + Math.random() * 1.8;
        return {
          id: i,
          left: Math.random() * 100,
          // A burst at the start, the rest spread over one fall so the loop keeps an even stream.
          delay: i < pieces / 3 ? Math.random() * 0.8 : Math.random() * duration,
          duration,
          size: 6 + Math.random() * 8,
          color: COLORS[i % COLORS.length],
          rotate: Math.random() * 360,
        };
      }),
    [pieces]
  );
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b) => (
        <span
          key={b.id}
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size * 0.45,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            transform: `rotate(${b.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
