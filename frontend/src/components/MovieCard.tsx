import { Tooltip } from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUp";
import ThumbDownIcon from "@mui/icons-material/ThumbDown";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useState } from "react";
import clsx from "clsx";

import type { FeedbackStatus, Recommendation } from "@/types";
import css from "./MovieCard.module.less";

interface Props {
  rec: Recommendation;
  onFeedback?: (next: FeedbackStatus) => void;
  feedbackPending?: boolean;
}

/**
 * "Lobby Card" movie row — horizontal at >= md, stacked on mobile (driven by
 * a CSS media query on the .card class so the layout is purely declarative).
 * Static styling lives in MovieCard.module.less; the only runtime concern is
 * choosing between active/inactive class names.
 */
export function MovieCard({ rec, onFeedback, feedbackPending }: Props) {
  const [imageOk, setImageOk] = useState(true);

  const idx = (rec.position ?? 1) - 1;
  const numberLabel = String(idx + 1).padStart(2, "0");
  const director = rec.directors?.[0];
  const castLine = (rec.cast ?? []).slice(0, 2).join(", ");
  const runtime = rec.runtime_min ? `${rec.runtime_min} MIN` : null;
  const contentRating = rec.content_rating ?? null;
  const matchPct =
    typeof rec.audience_rating === "number"
      ? Math.round(rec.audience_rating * 10)
      : null;

  return (
    <article className={css.card}>
      <div aria-hidden className={css.ghostNumber}>
        {numberLabel}
      </div>

      <div className={css.poster}>
        {imageOk ? (
          <img
            src={`/api/thumbs/${rec.plex_rating_key}`}
            alt={rec.title}
            onError={() => setImageOk(false)}
            className={css.posterImg}
          />
        ) : (
          <PosterFallback title={rec.title} year={rec.year} />
        )}
        {matchPct !== null && <div className={css.matchBadge}>{matchPct}</div>}
      </div>

      <div className={css.details}>
        <div className={css.eyebrow}>
          PICK {numberLabel}
          {director && (
            <>
              {" · DIR. "}
              <span className={css.eyebrowDir}>{director.toUpperCase()}</span>
            </>
          )}
        </div>

        <h3 className={css.title}>
          {rec.title}
          {rec.year && <span className={css.year}>({rec.year})</span>}
        </h3>

        {(runtime || contentRating || castLine) && (
          <div className={css.meta}>
            {[runtime, contentRating, castLine.toUpperCase()]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        {rec.synopsis && <p className={css.synopsis}>{rec.synopsis}</p>}

        {rec.reasoning && <div className={css.why}>{rec.reasoning}</div>}

        {(onFeedback || rec.play_url) && (
          <div className={css.actions}>
            {rec.play_url && (
              <Tooltip title="Open in Plex Web">
                <a
                  className={clsx(css.pill, css.pillPrimary)}
                  href={rec.play_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <PlayArrowIcon sx={{ fontSize: 14 }} />
                  Play
                </a>
              </Tooltip>
            )}

            {onFeedback && (
              <>
                <FeedbackPill
                  active={rec.feedback === "up"}
                  label="Good pick"
                  icon={<ThumbUpIcon sx={{ fontSize: 14 }} />}
                  onClick={() =>
                    onFeedback(rec.feedback === "up" ? "none" : "up")
                  }
                  disabled={feedbackPending}
                />
                <FeedbackPill
                  active={rec.feedback === "watched"}
                  label="Watched"
                  icon={<VisibilityIcon sx={{ fontSize: 14 }} />}
                  onClick={() =>
                    onFeedback(rec.feedback === "watched" ? "none" : "watched")
                  }
                  disabled={feedbackPending}
                />
                <div className={css.actionsSpacer} />
                <Tooltip title="Not for me">
                  <span>
                    <button
                      className={css.dismissBtn}
                      onClick={() =>
                        onFeedback(rec.feedback === "down" ? "none" : "down")
                      }
                      disabled={feedbackPending}
                      aria-label="not for me"
                      aria-pressed={rec.feedback === "down"}
                    >
                      {rec.feedback === "down" ? (
                        <ThumbDownIcon
                          sx={{ fontSize: 16, color: "var(--lobby-accent)" }}
                        />
                      ) : (
                        <CloseIcon sx={{ fontSize: 16 }} />
                      )}
                    </button>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        )}

        {(rec.genres ?? []).length > 0 && (
          <div className={css.footer}>
            PLEX · {(rec.genres ?? []).slice(0, 3).join(" / ").toUpperCase()}
          </div>
        )}
      </div>
    </article>
  );
}

interface PillProps {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function FeedbackPill({ active, label, icon, onClick, disabled }: PillProps) {
  return (
    <Tooltip title={label}>
      <span>
        <button
          className={clsx(css.pill, active && css.pillActive)}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
        >
          {icon}
          {label}
        </button>
      </span>
    </Tooltip>
  );
}

function PosterFallback({
  title,
  year,
}: {
  title: string;
  year: number | null;
}) {
  const initials = title
    .split(/\s+/)
    .slice(0, 3)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 3);
  return (
    <div className={css.posterFallback}>
      <div className={css.posterFallbackInitials}>{initials || "·"}</div>
      {year && <div className={css.posterFallbackYear}>{year}</div>}
    </div>
  );
}
