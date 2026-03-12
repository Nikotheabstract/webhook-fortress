import type { WebhookStore } from '../stores/WebhookStore.js';
import {
  calculateBackoffDelay,
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_CAP_DELAY_MS,
  sleep,
} from '../utils/backoff.js';

export type LockingOptions = {
  /**
   * @deprecated Use retryBaseDelayMs.
   */
  retryIntervalMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  acquireTimeoutMs?: number;
  onLockContention?: (eventId: string) => void;
  onWarning?: (warning: LockWarning) => void;
  lockRenewIntervalMs?: number;
};

export type LockWarningType =
  | 'lock-contention'
  | 'lock-renewal-failed'
  | 'lock-release-failed';

export type LockWarning = {
  type: LockWarningType;
  eventId: string;
  error?: unknown;
};

const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000;

type RenewingStore = WebhookStore & {
  renewLock: (eventId: string) => Promise<boolean>;
  getLockTtlMs?: () => number | undefined;
};

type RenewalController = {
  stop: () => Promise<void>;
};

const hasLockRenewal = (store: WebhookStore): store is RenewingStore =>
  typeof (store as { renewLock?: unknown }).renewLock === 'function';

const emitLockContentionSafely = (eventId: string, hook?: (eventId: string) => void) => {
  if (typeof hook !== 'function') {
    return;
  }

  try {
    hook(eventId);
  } catch {
    // Hooks are observational and must never alter processor control flow.
  }
};

const emitWarningSafely = (warning: LockWarning, hook?: (warning: LockWarning) => void) => {
  if (typeof hook !== 'function') {
    return;
  }

  try {
    hook(warning);
  } catch {
    // Hooks are observational and must never alter processor control flow.
  }
};

const resolveRenewIntervalMs = (
  store: RenewingStore,
  options: LockingOptions,
  retryBaseDelayMs: number
): number | undefined => {
  if (typeof options.lockRenewIntervalMs === 'number' && options.lockRenewIntervalMs > 0) {
    return Math.max(1, options.lockRenewIntervalMs);
  }

  if (typeof store.getLockTtlMs === 'function') {
    const lockTtlMs = store.getLockTtlMs();
    if (typeof lockTtlMs === 'number' && lockTtlMs > 0) {
      return Math.max(retryBaseDelayMs, Math.floor(lockTtlMs / 2));
    }
  }

  return undefined;
};

const startLockRenewal = (
  store: RenewingStore,
  eventId: string,
  intervalMs: number | undefined,
  onLockContention?: (eventId: string) => void,
  onWarning?: (warning: LockWarning) => void
): RenewalController => {
  if (!intervalMs) {
    return {
      stop: async () => undefined,
    };
  }

  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | null = null;
  let warned = false;

  const runRenewal = () => {
    if (inFlight) {
      return;
    }

    inFlight = (async () => {
      try {
        const renewed = await store.renewLock(eventId);
        if (!renewed && !warned) {
          warned = true;
          emitLockContentionSafely(eventId, onLockContention);
          emitWarningSafely(
            {
              type: 'lock-renewal-failed',
              eventId,
            },
            onWarning
          );
        }
      } catch (error) {
        if (!warned) {
          warned = true;
          emitLockContentionSafely(eventId, onLockContention);
          emitWarningSafely(
            {
              type: 'lock-renewal-failed',
              eventId,
              error,
            },
            onWarning
          );
        }
      }
    })().finally(() => {
      inFlight = null;
    });
  };

  timer = setInterval(runRenewal, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: async () => {
      if (timer) {
        clearInterval(timer);
      }
      if (inFlight) {
        await inFlight;
      }
    },
  };
};

export async function withEventLock<T>(
  store: WebhookStore,
  eventId: string,
  operation: () => Promise<T>,
  options: LockingOptions = {}
): Promise<T> {
  const retryBaseDelayMs = Math.max(
    1,
    options.retryBaseDelayMs ?? options.retryIntervalMs ?? DEFAULT_BACKOFF_BASE_DELAY_MS
  );
  const retryMaxDelayMs = Math.max(
    retryBaseDelayMs,
    options.retryMaxDelayMs ?? DEFAULT_BACKOFF_CAP_DELAY_MS
  );
  const acquireTimeoutMs = Math.max(retryBaseDelayMs, options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS);
  const startedAt = Date.now();
  let contentionHookCalled = false;
  let attempt = 0;

  while (true) {
    const acquired = await store.acquireLock(eventId);
    if (acquired) {
      break;
    }

    if (!contentionHookCalled) {
      contentionHookCalled = true;
      emitLockContentionSafely(eventId, options.onLockContention);
      emitWarningSafely(
        {
          type: 'lock-contention',
          eventId,
        },
        options.onWarning
      );
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= acquireTimeoutMs) {
      throw new Error(`Failed to acquire lock for event ${eventId}`);
    }

    const delayMs = calculateBackoffDelay(attempt, {
      baseDelayMs: retryBaseDelayMs,
      capDelayMs: retryMaxDelayMs,
    });
    attempt += 1;

    const remainingMs = acquireTimeoutMs - elapsedMs;
    if (remainingMs <= 0) {
      throw new Error(`Failed to acquire lock for event ${eventId}`);
    }

    await sleep(Math.min(delayMs, remainingMs));
  }

  const renewal =
    hasLockRenewal(store)
      ? startLockRenewal(
          store,
          eventId,
          resolveRenewIntervalMs(store, options, retryBaseDelayMs),
          options.onLockContention,
          options.onWarning
        )
      : {
          stop: async () => undefined,
        };

  try {
    return await operation();
  } finally {
    await renewal.stop();

    try {
      await store.releaseLock(eventId);
    } catch (error) {
      emitLockContentionSafely(eventId, options.onLockContention);
      emitWarningSafely(
        {
          type: 'lock-release-failed',
          eventId,
          error,
        },
        options.onWarning
      );
    }
  }
}
