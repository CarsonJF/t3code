export interface ReconnectOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  /** Returns [0, 1). Injected so the policy is testable without randomness. */
  readonly random?: () => number;
}

/**
 * discord.js reconnects on its own; this paces a fresh `login` after a login
 * failure or a session it could not resume, so a Discord outage is not a hot loop.
 */
export const nextReconnectDelay = (attempt: number, options: ReconnectOptions = {}): number => {
  const baseMs = options.baseMs ?? 1_000;
  const maxMs = options.maxMs ?? 60_000;
  const random = options.random ?? Math.random;
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(safeAttempt, 16));
  return Math.round(exponential * (0.5 + random() * 0.5));
};

export interface LoginRetryPlan {
  readonly retry: boolean;
  readonly delayMs: number;
}

/**
 * A rejected token never becomes valid, so the service stops; everything else
 * (network, Discord outage, rate limit) retries with backoff.
 */
export const planLoginRetry = (input: {
  readonly attempt: number;
  readonly fatal: boolean;
  readonly random?: () => number;
}): LoginRetryPlan =>
  input.fatal
    ? { retry: false, delayMs: 0 }
    : {
        retry: true,
        delayMs: nextReconnectDelay(
          input.attempt,
          input.random === undefined ? {} : { random: input.random },
        ),
      };
