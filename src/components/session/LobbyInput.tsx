'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';

interface Props {
  variant: 'initial' | 'follow-up';
  placeholder?: string;
  disabled?: boolean;
  onSubmit: (text: string) => Promise<void> | void;
  /** When true, renders sticky against the bottom of its scroll container. */
  sticky?: boolean;
  autoFocus?: boolean;
}

const INITIAL_PLACEHOLDER = 'a feel-good 90s comedy under 2 hours…';
const FOLLOWUP_PLACEHOLDER = 'something a little weirder…';

export function LobbyInput({
  variant,
  placeholder,
  disabled,
  onSubmit,
  sticky = true,
  autoFocus = false,
}: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const label = variant === 'initial' ? 'REQUEST →' : 'FOLLOW-UP →';
  const ph = placeholder ?? (variant === 'initial' ? INITIAL_PLACEHOLDER : FOLLOWUP_PLACEHOLDER);
  const canSubmit = !disabled && !busy && value.trim().length > 0;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className={`${
        sticky ? 'sticky' : ''
      } bottom-0 z-20 border-t border-mise-border bg-mise-bg/95 px-7 pt-4 pb-5.5 backdrop-blur-md`}
      style={sticky ? undefined : { position: 'static' }}
    >
      <form
        onSubmit={submit}
        className="flex items-end gap-2.5 border-b border-mise-border pb-2.5"
      >
        <span className="font-mono text-[10px] tracking-eyebrow text-mise-accent pb-2">
          {label}
        </span>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={ph}
          disabled={disabled || busy}
          className="flex-1 resize-none border-0 bg-transparent pt-1 pb-1.5 font-serif text-[18px] italic leading-[1.4] text-mise-fg outline-none placeholder:text-mise-fg-faint"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="Submit"
          className={`grid size-8 place-items-center rounded-full border-0 transition-colors ${
            canSubmit
              ? 'cursor-pointer bg-mise-accent text-mise-accent-ink'
              : 'cursor-not-allowed bg-mise-bg-elev text-mise-fg-faint'
          }`}
        >
          <Icon name="arrow" size={14} />
        </button>
      </form>
      {variant === 'initial' && (
        <div className="mt-2 font-mono text-[10px] tracking-[0.1em] text-mise-fg-faint">
          ENTER TO SUBMIT · SHIFT+ENTER FOR NEWLINE
        </div>
      )}
    </div>
  );
}
