import { useEffect, useState } from "react";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SPEED_MS = 70;

// Random letters in the shape of the name, spaces kept, so the length hints at the winner without giving it away.
function scramble(shape) {
  return shape
    .split("")
    .map((ch) => (ch === " " ? " " : LETTERS[Math.floor(Math.random() * LETTERS.length)]))
    .join("");
}

/**
 * Shuffling letters shown during the suspense before the winner's name.
 * name, the winner's name once the server has answered, before that a placeholder shape is used.
 */
export default function NameScramble({ name }) {
  const shape = (name || "XXXXX XXXXXX").toUpperCase();
  const [text, setText] = useState(() => scramble(shape));

  useEffect(() => {
    const t = setInterval(() => setText(scramble(shape)), SPEED_MS);
    return () => clearInterval(t);
  }, [shape]);

  return (
    <p className="dlgfb-name-scramble" aria-hidden="true">
      {text}
    </p>
  );
}
