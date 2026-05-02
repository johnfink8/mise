'use client';

import { useEffect, useState } from 'react';

const TAGLINES = [
  'Set the scene.',
  'Roll camera.',
  'Cue the feature.',
  'Lights down.',
  'Frame tonight.',
  'Press play, with intent.',
  'Tonight, composed.',
  'The marquee is yours.',
  'Your shelf, on tonight.',
];

export function RotatingTagline({ hero = false }: { hero?: boolean }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const hold = setTimeout(() => setPhase('out'), 3200);
    const swap = setTimeout(() => {
      setI((x) => (x + 1) % TAGLINES.length);
      setPhase('in');
    }, 3800);
    return () => {
      clearTimeout(hold);
      clearTimeout(swap);
    };
  }, [i]);

  return (
    <div
      className={`relative h-[1.15em] font-serif italic leading-none text-mise-accent ${
        hero ? 'text-[44px] tracking-tighter md:text-[72px]' : 'text-[30px] tracking-tight'
      }`}
    >
      <span
        className="absolute left-0 top-0 transition-[opacity,transform] duration-[550ms] ease"
        style={{
          opacity: phase === 'in' ? 1 : 0,
          transform: phase === 'in' ? 'translateY(0)' : 'translateY(-6px)',
        }}
      >
        {TAGLINES[i]}
      </span>
    </div>
  );
}
