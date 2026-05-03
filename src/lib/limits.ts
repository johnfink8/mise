/**
 * Runaway-protection limits. All overridable via env so you can tune without
 * a redeploy. Defaults are intended for a single-user local Plex install on
 * Claude Sonnet 4.6 — adjust if you switch models or surface this on a network.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const limits = {
  /** Wallclock budget for one agent cycle (one POST or follow-up). */
  cycleTimeoutMs: envInt('MISE_CYCLE_TIMEOUT_MS', 90_000),

  /** Combined input+output tokens allowed per cycle. */
  cycleTokenBudget: envInt('MISE_CYCLE_TOKEN_BUDGET', 250_000),

  /** Combined input+output tokens allowed across the lifetime of one session. */
  sessionTokenCeiling: envInt('MISE_SESSION_TOKEN_CEILING', 500_000),

  /** How many extra attempts after the first fails validation. 0 = no retry. */
  validationRetries: envInt('MISE_VALIDATION_RETRIES', 1),

  /** Max steps (model round-trips) per attempt. Each step can fan out tool calls. */
  agentMaxSteps: envInt('MISE_AGENT_MAX_STEPS', 16),

  /**
   * Anthropic extended-thinking budget per step (tokens). 0 disables thinking.
   * Counted against output tokens by the model; with our 16-step ceiling and
   * 250k cycle budget, a 3000-token thinking budget is a comfortable fit.
   */
  thinkingBudgetTokens: envInt('MISE_THINKING_BUDGET_TOKENS', 3000),
} as const;

/**
 * Cron schedule for the daily catalog refresh tick. Defaults to 4:00 AM local
 * time. Override with MISE_CATALOG_CRON (any standard cron expression) or set
 * it to 'off' to disable the scheduled refresh entirely.
 */
export const catalogCron = process.env.MISE_CATALOG_CRON ?? '0 4 * * *';
