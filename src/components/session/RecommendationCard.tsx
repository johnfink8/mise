'use client';

import { useState } from 'react';
import type { Feedback, RecOut } from './types';

export function RecommendationCard({
  rec,
  onFeedback,
  hideGroupLabel,
}: {
  rec: RecOut;
  onFeedback: (fb: Feedback) => void;
  hideGroupLabel?: boolean;
}) {
  return (
    <article
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Thumb ratingKey={rec.ratingKey} title={rec.title} year={rec.year} playUrl={rec.playUrl} />
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {rec.group && !hideGroupLabel && (
          <span
            className="faint"
            style={{ fontSize: 10, letterSpacing: 0.05, textTransform: 'uppercase' }}
          >
            {rec.group}
          </span>
        )}
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
          {rec.title}{' '}
          <span className="faint" style={{ fontWeight: 400 }}>
            {rec.year ?? ''}
          </span>
        </h3>
        <p className="muted" style={{ fontSize: 13, margin: 0, flex: 1 }}>
          {rec.reasoning}
        </p>
        <div className="faint" style={{ fontSize: 11 }}>
          {rec.runtimeMin != null && `${rec.runtimeMin} min · `}
          {rec.audienceRating != null && `★ ${rec.audienceRating.toFixed(1)} · `}
          {rec.genres.slice(0, 2).join(', ')}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <FeedbackBtn current={rec.feedback} value="up" onClick={onFeedback} label="👍" />
          <FeedbackBtn current={rec.feedback} value="down" onClick={onFeedback} label="👎" />
          <FeedbackBtn
            current={rec.feedback}
            value="watched"
            onClick={onFeedback}
            label="watched"
          />
          {rec.playUrl && (
            <a
              href={rec.playUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                padding: '4px 10px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-dim)',
              }}
            >
              ▶ play
            </a>
          )}
        </div>
      </div>
    </article>
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
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        textAlign: 'center',
        color: 'var(--text-dim)',
        fontSize: 13,
      }}
    >
      <div>
        <div style={{ fontWeight: 500, color: 'var(--text)' }}>{title}</div>
        {year != null && <div className="faint">{year}</div>}
      </div>
    </div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/thumbs/${ratingKey}`}
      alt={title}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
  const wrap = {
    aspectRatio: '2/3',
    background: 'var(--bg-elev-2)',
    display: 'block',
  } as const;
  if (playUrl) {
    return (
      <a href={playUrl} target="_blank" rel="noopener noreferrer" style={wrap}>
        {inner}
      </a>
    );
  }
  return <div style={wrap}>{inner}</div>;
}

function FeedbackBtn({
  current,
  value,
  onClick,
  label,
}: {
  current: Feedback;
  value: 'up' | 'down' | 'watched';
  onClick: (fb: Feedback) => void;
  label: string;
}) {
  const active = current === value;
  const color =
    value === 'up' ? 'var(--up)' : value === 'down' ? 'var(--down)' : 'var(--watched)';
  return (
    <button
      type="button"
      onClick={() => onClick(active ? 'none' : value)}
      style={{
        padding: '4px 10px',
        fontSize: 12,
        background: active ? color : undefined,
        borderColor: active ? color : undefined,
        color: active ? 'var(--bg)' : undefined,
      }}
    >
      {label}
    </button>
  );
}
