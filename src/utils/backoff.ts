export const DEFAULT_BACKOFF_BASE_DELAY_MS = 50;
export const DEFAULT_BACKOFF_CAP_DELAY_MS = 2_000;

export type BackoffOptions = {
  baseDelayMs?: number;
  capDelayMs?: number;
  random?: () => number;
};

const normalizePositiveInteger = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
};

export const calculateBackoffDelay = (attempt: number, options: BackoffOptions = {}): number => {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const baseDelayMs = normalizePositiveInteger(options.baseDelayMs, DEFAULT_BACKOFF_BASE_DELAY_MS);
  const capDelayMs = Math.max(baseDelayMs, normalizePositiveInteger(options.capDelayMs, DEFAULT_BACKOFF_CAP_DELAY_MS));

  const exponentialDelay = baseDelayMs * Math.pow(2, normalizedAttempt);
  const maxDelayMs = Math.min(capDelayMs, exponentialDelay);

  const random = options.random ?? Math.random;
  const jitter = Math.max(0, Math.min(1, random()));

  // Full jitter strategy: random value in [0, maxDelayMs].
  return Math.floor(jitter * maxDelayMs);
};

export const sleep = async (delayMs: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, delayMs));
  });
