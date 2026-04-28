import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { CircularProgress } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import clsx from 'clsx'

import css from './ChatPanel.module.less'

interface Props {
  onSubmit: (text: string) => void
  isPending: boolean
  isFollowUp: boolean
  /**
   * Single placeholder, or a list to cycle through while the input is empty
   * and unfocused. Cycling pauses on focus and resumes on blur.
   */
  placeholder?: string | readonly string[]
  /** Cycle interval in ms when `placeholder` is an array (default 4000). */
  cycleMs?: number
}

/**
 * Lobby-card chat input. Mono prefix + italic-serif placeholder + emerald
 * round send button. Sticky to the bottom of the viewport.
 */
export function ChatPanel({
  onSubmit,
  isPending,
  isFollowUp,
  placeholder,
  cycleMs = 4000,
}: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [phIndex, setPhIndex] = useState(0)
  const [phVisible, setPhVisible] = useState(true)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const placeholders = useMemo(() => {
    if (!placeholder) return [defaultPlaceholder(isFollowUp)]
    if (Array.isArray(placeholder)) {
      return placeholder.length > 0 ? placeholder : [defaultPlaceholder(isFollowUp)]
    }
    return [placeholder as string]
  }, [placeholder, isFollowUp])

  // Reset cycle when the source list changes (e.g. follow-up suggestion arrives).
  useEffect(() => {
    setPhIndex(0)
    setPhVisible(true)
  }, [placeholders])

  // Cycle while idle (empty + unfocused) and there's more than one placeholder.
  useEffect(() => {
    if (placeholders.length < 2) return
    if (text.length > 0 || focused || isPending) return
    const timer = setInterval(() => {
      setPhVisible(false)
      setTimeout(() => {
        setPhIndex((i) => (i + 1) % placeholders.length)
        setPhVisible(true)
      }, 220)
    }, cycleMs)
    return () => clearInterval(timer)
  }, [placeholders, text, focused, isPending, cycleMs])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed || isPending) return
    onSubmit(trimmed)
    setText('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const prefix = isFollowUp ? 'FOLLOW-UP →' : 'REQUEST →'
  const currentPh = placeholders[phIndex] ?? placeholders[0]

  return (
    <div className={css.bar}>
      <div className={css.row}>
        <div className={css.prefix}>{prefix}</div>
        <div className={css.inputWrap}>
          {text.length === 0 && (
            <div
              aria-hidden
              className={clsx(css.placeholder, !phVisible && css.placeholderHidden)}
            >
              {currentPh}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            disabled={isPending}
            aria-label="chat input"
            aria-placeholder={currentPh}
            className={css.input}
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={isPending || !text.trim()}
          aria-label="send"
          className={css.sendBtn}
        >
          {isPending ? (
            <CircularProgress size={14} sx={{ color: 'var(--lobby-accent-ink)' }} />
          ) : (
            <ArrowForwardIcon sx={{ fontSize: 14 }} />
          )}
        </button>
      </div>
    </div>
  )
}

function defaultPlaceholder(isFollowUp: boolean): string {
  return isFollowUp
    ? 'something a little weirder…'
    : 'a feel-good 90s comedy under 2 hours…'
}
