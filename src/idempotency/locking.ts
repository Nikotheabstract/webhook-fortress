import type { WebhookStore } from '../stores/WebhookStore.js';

export type LockingOptions = {
  retryIntervalMs?: number;
  acquireTimeoutMs?: number;
};

const DEFAULT_RETRY_INTERVAL_MS = 25;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000;

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function withEventLock<T>(
  store: WebhookStore,
  eventId: string,
  operation: () => Promise<T>,
  options: LockingOptions = {}
): Promise<T> {
  const retryIntervalMs = Math.max(1, options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS);
  const acquireTimeoutMs = Math.max(retryIntervalMs, options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS);
  const startedAt = Date.now();

  while (true) {
    const acquired = await store.acquireLock(eventId);
    if (acquired) {
      break;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= acquireTimeoutMs) {
      throw new Error(`Failed to acquire lock for event ${eventId}`);
    }

    await sleep(retryIntervalMs);
  }

  try {
    return await operation();
  } finally {
    await store.releaseLock(eventId);
  }
}
