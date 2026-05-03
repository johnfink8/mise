'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import type { SessionStatus } from './types';

interface Props {
  status?: SessionStatus | 'initial';
  resultCount?: number;
  showHistory?: boolean;
  /** Render a "+ NEW" link back to the home page. */
  showNew?: boolean;
  /** Render a "+ PLAYLIST" shortcut that scrolls to the end-of-programme card. */
  showPlaylistShortcut?: boolean;
}

export function LobbyTopBar({
  status = 'initial',
  resultCount,
  showHistory = true,
  showNew = false,
  showPlaylistShortcut = false,
}: Props) {
  const label =
    status === 'initial'
      ? 'GET STARTED'
      : status === 'pending' || status === 'running'
      ? 'THINKING…'
      : status === 'error'
      ? 'ERROR'
      : `${resultCount ?? 0} RESULT${resultCount === 1 ? '' : 'S'}`;

  const isActive = status === 'pending' || status === 'running';
  const isError = status === 'error';

  return (
    <div className="flex items-center justify-between px-7 py-3.5">
      <div
        className={`flex items-center gap-2 font-mono text-[11px] tracking-pill ${
          isError ? 'text-mise-down' : 'text-mise-accent'
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${
            isError
              ? 'bg-mise-down shadow-[0_0_0_3px_var(--color-mise-down-soft)]'
              : 'bg-mise-accent shadow-[0_0_0_3px_var(--color-mise-accent-soft)]'
          } ${isActive ? 'animate-mise-pulse' : ''}`}
        />
        {label}
      </div>
      <div className="flex items-center gap-4">
        {showPlaylistShortcut && (
          <button
            type="button"
            onClick={() => {
              const el = document.querySelector('[data-mise-end-card]');
              if (!(el instanceof HTMLElement)) return;
              const top = el.getBoundingClientRect().top + window.scrollY - 80;
              window.scrollTo({ top, behavior: 'smooth' });
            }}
            className={`${navLinkClass} cursor-pointer bg-transparent p-0`}
          >
            <span className="text-mise-accent">+</span>
            PLAYLIST
          </button>
        )}
        {showNew && (
          <Link href="/" className={navLinkClass}>
            <Icon name="plus" size={13} />
            NEW
          </Link>
        )}
        {showHistory && (
          <Link href="/history" className={navLinkClass}>
            <Icon name="history" size={13} />
            HISTORY
          </Link>
        )}
      </div>
    </div>
  );
}

const navLinkClass =
  'flex items-center gap-1.5 font-mono text-[11px] tracking-pill text-mise-fg-dim hover:text-mise-fg transition-colors';
