'use client';

import { useEffect, useState } from 'react';

/**
 * Reveal `text` character-by-character. When `text` changes, restart the
 * animation from the new content. Calls `onDone` once the full string is shown.
 */
export function Typewriter({
  text,
  speed = 14,
  onDone,
}: {
  text: string;
  speed?: number;
  onDone?: () => void;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    setI(0);
  }, [text]);

  useEffect(() => {
    if (i >= text.length) {
      onDone?.();
      return;
    }
    const id = setTimeout(() => setI(i + 1), speed);
    return () => clearTimeout(id);
  }, [i, text, speed, onDone]);

  return <>{text.slice(0, i)}</>;
}
