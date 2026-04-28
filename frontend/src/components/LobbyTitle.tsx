import { Link } from "react-router-dom";
import clsx from "clsx";

import { RotatingTagline } from "./RotatingTagline";
import css from "./LobbyTitle.module.less";

interface Props {
  /**
   * Mono eyebrow on the top bar (e.g. "GET STARTED", "5 RESULTS",
   * "PAST PROGRAMMES"). The leading status dot is rendered by this
   * component — pass plain text only.
   */
  eyebrow?: string;
  /** When true, the eyebrow dot pulses (used for the "thinking" state). */
  eyebrowPulsing?: boolean;
  /**
   * Static tagline to render below the wordmark instead of the rotating one.
   * Used by archive pages where the line is contextual rather than evocative.
   */
  staticTagline?: string;
  /** Right-side mono links (Home / History / etc). */
  rightLinks?: Array<{ to: string; label: string }>;
}

/**
 * The "mise." wordmark with a stateful top bar above it. The top bar pairs
 * a single dot+label eyebrow on the left (driven by the page's phase) with
 * navigation links on the right.
 */
export function LobbyTitle({
  eyebrow = "MISE",
  eyebrowPulsing = false,
  staticTagline,
  rightLinks,
}: Props) {
  return (
    <div className={css.root}>
      <div className={css.topBar}>
        <div className={css.eyebrow}>
          <span
            className={clsx(
              css.eyebrowDot,
              eyebrowPulsing && css.eyebrowDotPulsing,
            )}
          />
          {eyebrow}
        </div>
        {rightLinks && rightLinks.length > 0 && (
          <div className={css.rightLinks}>
            {rightLinks.map((l) => (
              <Link key={l.to} to={l.to} className={css.rightLink}>
                {l.label.toUpperCase()}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className={css.titleBlock}>
        <h1 className={css.wordmark}>
          mise<span className={css.wordmarkAccent}>.</span>
        </h1>
        <RotatingTagline staticText={staticTagline} />
      </div>
    </div>
  );
}
