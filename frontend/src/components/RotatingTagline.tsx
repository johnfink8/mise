import { useEffect, useState } from 'react'
import clsx from 'clsx'

import css from './RotatingTagline.module.less'

/**
 * "mise" taglines, in order. The rotation cycles through these with a soft
 * fade-and-rise between lines so it feels like a film slate flipping.
 */
export const TAGLINES: readonly string[] = [
  'Set the scene.',
  'Roll camera.',
  'Cue the feature.',
  'Lights down.',
  'Frame tonight.',
  'Press play, with intent.',
  'Tonight, composed.',
  'The marquee is yours.',
  'Your shelf, on tonight.',
] as const

interface Props {
  /**
   * Static tagline to display instead of cycling. When provided, no animation
   * runs — used by archive pages where the line is purely contextual.
   */
  staticText?: string
  /**
   * Pool of lines to cycle through. Defaults to the canonical mise taglines.
   * Pass an alternate list (or `[oneLine]`) to bypass cycling for a single
   * fixed entry.
   */
  lines?: readonly string[]
  /** Hold duration before fading out, in ms (default 3200). */
  holdMs?: number
  /** Time between fade-out start and the next line appearing, in ms (default 600). */
  swapMs?: number
}

export function RotatingTagline({
  staticText,
  lines = TAGLINES,
  holdMs = 3200,
  swapMs = 600,
}: Props) {
  // Static mode: render a single line with no animation, no timers.
  if (staticText !== undefined) {
    return <div className={css.static}>{staticText}</div>
  }

  return <CyclingTagline lines={lines} holdMs={holdMs} swapMs={swapMs} />
}

interface CyclingProps {
  lines: readonly string[]
  holdMs: number
  swapMs: number
}

function CyclingTagline({ lines, holdMs, swapMs }: CyclingProps) {
  const [i, setI] = useState(0)
  const [phase, setPhase] = useState<'in' | 'out'>('in')

  useEffect(() => {
    if (lines.length < 2) return
    const hold = setTimeout(() => setPhase('out'), holdMs)
    const swap = setTimeout(() => {
      setI((x) => (x + 1) % lines.length)
      setPhase('in')
    }, holdMs + swapMs)
    return () => {
      clearTimeout(hold)
      clearTimeout(swap)
    }
  }, [i, lines, holdMs, swapMs])

  return (
    <div className={css.root}>
      <span className={clsx(css.line, phase === 'out' && css.lineOut)}>
        {lines[i] ?? lines[0] ?? ''}
      </span>
    </div>
  )
}
