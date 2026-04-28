import { CircularProgress } from "@mui/material";
import { Link } from "react-router-dom";

import { useSessions } from "@/api/hooks";
import { LobbyTitle } from "@/components/LobbyTitle";
import type { SessionStatus } from "@/types";

import css from "./HistoryPage.module.less";

const STATUS_CLASS: Record<SessionStatus, string> = {
  pending: css.statusPending,
  running: css.statusRunning,
  complete: css.statusComplete,
  error: css.statusError,
};

export function HistoryPage() {
  const { data, isLoading, error } = useSessions(50, 0);

  return (
    <div className={css.root}>
      <LobbyTitle
        eyebrow="PAST PROGRAMMES"
        staticTagline="The archive."
        rightLinks={[{ to: "/", label: "Home" }]}
      />

      <div className={css.body}>
        {isLoading && (
          <div className={css.spinnerWrap}>
            <CircularProgress sx={{ color: "var(--lobby-accent)" }} />
          </div>
        )}
        {error && <div className={css.errorPanel}>Failed to load history.</div>}
        {!isLoading && !error && (data?.sessions.length ?? 0) === 0 && (
          <div className={css.empty}>The archive is empty.</div>
        )}

        {(data?.sessions ?? []).map((s, idx) => (
          <Link key={s.id} to={`/sessions/${s.id}`} className={css.row}>
            <div className={css.meta}>
              <span>No. {String(idx + 1).padStart(3, "0")}</span>
              <span>·</span>
              <span>{formatDate(s.created_at)}</span>
              <span>·</span>
              <span className={STATUS_CLASS[s.status]}>
                {s.status.toUpperCase()}
              </span>
              {s.latency_ms != null && (
                <>
                  <span>·</span>
                  <span>{(s.latency_ms / 1000).toFixed(1)}s</span>
                </>
              )}
            </div>
            <div className={css.prompt}>“{s.user_prompt}”</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
}
