'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';

interface PlaylistResult {
  title: string;
  ratingKey: string;
  deepLink: string | null;
  count: number;
  created: boolean;
}

export function SaveToPlex({ sessionId, count }: { sessionId: string; count: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlaylistResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as PlaylistResult & { error?: string };
      if (!res.ok) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const saved = result !== null;

  return (
    <div
      data-mise-end-card
      className="mt-7 flex flex-col items-stretch justify-between gap-5 border-t border-mise-border pt-7 pb-4 sm:flex-row sm:items-center sm:gap-7"
    >
      <div className="flex-1">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-mise-fg-faint">
          ✦&nbsp;&nbsp;End of Programme&nbsp;&nbsp;✦
        </div>
        <div className="font-serif text-[26px] italic leading-[1.15] tracking-[-0.01em] text-mise-fg sm:text-[30px]">
          {saved
            ? `${result.created ? 'Saved' : 'Updated'} as ${result.title}.`
            : `Save tonight's ${count} as a playlist?`}
        </div>
        <div className="mt-1.5 max-w-[480px] text-[12px] leading-[1.5] text-mise-fg-dim">
          {saved
            ? result.created
              ? "Pin it to your home screen from any Plex client so it's there when you sit down."
              : 'Replaced the previous mise playlist in place — any home-screen pin you set is preserved.'
            : "We'll mirror it to your Plex library so you can press play without thinking twice."}
        </div>
        {error && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-pill text-mise-down">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
        <button
          onClick={onClick}
          disabled={busy}
          className={`inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-sm border border-mise-accent px-5 py-3.5 font-mono text-[11px] font-semibold uppercase tracking-eyebrow transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            saved
              ? 'bg-transparent text-mise-accent'
              : 'bg-mise-accent text-mise-accent-ink hover:bg-mise-accent/90'
          }`}
        >
          {saved ? (
            <>
              <span>✓</span> Saved to Plex
            </>
          ) : busy ? (
            <>Saving…</>
          ) : (
            <>
              Create Playlist
              <Icon name="arrow" size={12} />
            </>
          )}
        </button>
        {saved && result.deepLink && (
          <a
            href={result.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-eyebrow text-mise-fg-dim hover:text-mise-accent"
          >
            Open in Plex →
          </a>
        )}
      </div>
    </div>
  );
}
