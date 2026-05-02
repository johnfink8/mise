'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import type { Feedback, RecOut } from './types';

export function LobbyMovieCard({
  rec,
  idx,
  onFeedback,
}: {
  rec: RecOut;
  idx: number;
  onFeedback: (fb: Feedback) => void;
}) {
  const numLabel = String(idx + 1).padStart(2, '0');
  const metaLine = [
    rec.runtimeMin != null && `${rec.runtimeMin} MIN`,
    rec.audienceRating != null && `★ ${rec.audienceRating.toFixed(1)}`,
    rec.topCast.slice(0, 2).join(', ').toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="relative flex flex-col gap-0 border-t border-mise-border py-7 md:flex-row md:gap-6">
      {/* Oversized italic ghost number */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-5 right-1 font-serif text-[110px] font-normal italic leading-none text-mise-fg-faint opacity-[0.18] md:-right-1"
      >
        {numLabel}
      </div>

      {/* Poster */}
      <div className="shrink-0 md:w-[200px]">
        <Thumb ratingKey={rec.ratingKey} title={rec.title} year={rec.year} playUrl={rec.playUrl} />
      </div>

      {/* Details */}
      <div className="relative z-10 min-w-0 flex-1 pt-4.5 pr-2 md:pt-1">
        <div className="eyebrow mb-2">
          PICK {numLabel}
          {rec.directors[0] && ` · DIR. ${rec.directors[0].toUpperCase()}`}
        </div>
        <h3 className="m-0 font-serif text-[38px] font-normal leading-none tracking-[-0.01em] text-mise-fg">
          {rec.title}
          {rec.year != null && (
            <span className="ml-2.5 font-serif text-[24px] italic text-mise-fg-faint">
              ({rec.year})
            </span>
          )}
        </h3>
        {metaLine && (
          <div className="mt-2 font-mono text-[11px] tracking-[0.06em] text-mise-fg-dim">
            {metaLine}
          </div>
        )}

        {/* Pull-quote — agent reasoning, emerald left rule */}
        <div className="mt-4 max-w-[540px] border-l-2 border-mise-accent pl-3.5 font-serif text-[15px] italic leading-[1.5] text-mise-fg-dim">
          {rec.reasoning}
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {rec.playUrl && (
            <a
              href={rec.playUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex cursor-pointer items-center gap-2 rounded-full border-0 bg-mise-accent px-4.5 py-2.5 font-display text-xs font-semibold uppercase tracking-[0.08em] text-mise-accent-ink no-underline hover:opacity-90"
            >
              <Icon name="play" size={11} /> Play
            </a>
          )}
          <FeedbackBtn current={rec.feedback} value="up" onClick={onFeedback} icon="thumbsUp" />
          <FeedbackBtn current={rec.feedback} value="down" onClick={onFeedback} icon="thumbsDown" />
          <FeedbackBtn
            current={rec.feedback}
            value="watched"
            onClick={onFeedback}
            label="Watched"
          />
        </div>
      </div>
    </article>
  );
}

function FeedbackBtn({
  current,
  value,
  onClick,
  icon,
  label,
}: {
  current: Feedback;
  value: 'up' | 'down' | 'watched';
  onClick: (fb: Feedback) => void;
  icon?: 'thumbsUp' | 'thumbsDown';
  label?: string;
}) {
  const active = current === value;
  if (icon) {
    return (
      <button
        type="button"
        onClick={() => onClick(active ? 'none' : value)}
        aria-label={value === 'up' ? 'thumbs up' : 'thumbs down'}
        className={`grid size-9 cursor-pointer place-items-center rounded-full border p-0 ${
          active
            ? 'border-mise-accent bg-mise-accent text-mise-accent-ink'
            : 'border-mise-border bg-transparent text-mise-fg hover:border-mise-accent'
        }`}
      >
        <Icon name={icon} size={14} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClick(active ? 'none' : value)}
      className={`cursor-pointer rounded-full border px-3.5 py-2.5 font-display text-xs font-medium tracking-[0.06em] ${
        active
          ? 'border-mise-accent bg-mise-accent text-mise-accent-ink'
          : 'border-mise-border bg-transparent text-mise-fg hover:border-mise-accent'
      }`}
    >
      {label}
    </button>
  );
}

function Thumb({
  ratingKey,
  title,
  year,
  playUrl,
}: {
  ratingKey: string;
  title: string;
  year: number | null;
  playUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);

  const inner = failed ? (
    <div className="flex h-full w-full items-center justify-center bg-mise-bg-elev p-4 text-center font-serif italic">
      <div>
        <div className="text-[16px] text-mise-fg">{title}</div>
        {year != null && (
          <div className="mt-1 text-[12px] text-mise-fg-faint">{year}</div>
        )}
      </div>
    </div>
  ) : (
    // Plain <img> on purpose. next/image would route every poster through
    // Next's image optimizer (resize, AVIF/WebP, on-disk cache in .next).
    // For a single-user local-LAN app pointing at a private Plex, the bytes
    // saved aren't worth the extra cache layer. Layout shift is already
    // prevented by the aspect-ratio parent.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/thumbs/${ratingKey}`}
      alt={title}
      loading="lazy"
      onError={() => setFailed(true)}
      className="block h-full w-full object-cover"
    />
  );

  const wrap =
    'block aspect-[2/3] w-full overflow-hidden bg-mise-bg-elev shadow-[0_18px_40px_rgba(0,0,0,0.4)]';

  if (playUrl) {
    return (
      <a href={playUrl} target="_blank" rel="noopener noreferrer" className={wrap}>
        {inner}
      </a>
    );
  }
  return <div className={wrap}>{inner}</div>;
}
