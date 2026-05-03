'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Smooth incremental reveal for streamed text.
 *
 * The model's API streams in chunks (often 4–8 words at a time on Anthropic),
 * which lands in big jumps if rendered directly. This component holds a
 * "displayed length" that animates toward the latest received `text` length
 * via requestAnimationFrame — a steady ~120 chars/sec base reveal, accelerated
 * when the buffer grows so we never fall too far behind.
 *
 * The trailing blinking caret is rendered here while characters remain to
 * reveal; once the displayed text matches `text`, the caret continues to
 * blink (handled by callers when they want one — the parent ThinkingBlock
 * keeps a separate caret on the active turn).
 */
export function StreamingText({ text, baseRate = 120 }: { text: string; baseRate?: number }) {
  const [displayedLen, setDisplayedLen] = useState(0);
  const targetRef = useRef(text);
  targetRef.current = text;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = now - last;
      last = now;

      setDisplayedLen((prev) => {
        const target = targetRef.current.length;
        if (prev >= target) return prev;
        const buffer = target - prev;
        // Scale rate up when buffer is large so we don't accumulate lag.
        const rate = baseRate * (1 + buffer / 50);
        const advance = Math.max(1, Math.round((dt / 1000) * rate));
        return Math.min(prev + advance, target);
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [baseRate]);

  // Clamp to current text in case it ever gets shorter (shouldn't, but safe).
  const safeLen = Math.min(displayedLen, text.length);
  return <>{text.slice(0, safeLen)}</>;
}
