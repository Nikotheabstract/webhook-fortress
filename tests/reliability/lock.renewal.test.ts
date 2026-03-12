import { describe, expect, it, vi } from 'vitest';
import { createEventProcessor } from '../../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../../src/stores/WebhookStore.js';

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

class ExpiringLockStore implements WebhookStore {
  private readonly processedEvents = new Set<string>();
  private readonly lockExpiresAt = new Map<string, number>();
  renewCalls = 0;

  constructor(private readonly lockTtlMs: number) {}

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }

  async recordFailure(): Promise<void> {
    return undefined;
  }

  async acquireLock(eventId: string): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.lockExpiresAt.get(eventId);

    if (typeof expiresAt === 'number' && expiresAt > now) {
      return false;
    }

    this.lockExpiresAt.set(eventId, now + this.lockTtlMs);
    return true;
  }

  async releaseLock(eventId: string): Promise<void> {
    this.lockExpiresAt.delete(eventId);
  }

  async renewLock(eventId: string): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.lockExpiresAt.get(eventId);
    if (typeof expiresAt !== 'number' || expiresAt <= now) {
      return false;
    }

    this.renewCalls += 1;
    this.lockExpiresAt.set(eventId, now + this.lockTtlMs);
    return true;
  }

  getLockTtlMs(): number {
    return this.lockTtlMs;
  }
}

describe('lock renewal', () => {
  it('keeps lock valid for long-running handlers and prevents duplicate processing', async () => {
    const store = new ExpiringLockStore(40);
    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 600,
    });

    const handler = vi.fn(async () => {
      await sleep(140);
    });

    const first = processor.process('evt.renewal.1', handler);
    await sleep(70); // beyond original lock TTL; renewal must keep lock alive.
    const second = processor.process('evt.renewal.1', handler);

    const [resultA, resultB] = await Promise.all([first, second]);
    const processedCount = [resultA, resultB].filter((result) => result.processed).length;
    const duplicateCount = [resultA, resultB].filter((result) => !result.processed).length;

    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.renewCalls).toBeGreaterThan(0);
  });

  it('does not fail processing when lock renewal fails and emits lock contention hook', async () => {
    const onLockContention = vi.fn();
    const onWarning = vi.fn();

    const store: WebhookStore = {
      async hasProcessed() {
        return false;
      },
      async markProcessed() {
        return undefined;
      },
      async recordFailure() {
        return undefined;
      },
      async acquireLock() {
        return true;
      },
      async releaseLock() {
        return undefined;
      },
      async renewLock() {
        return false;
      },
      getLockTtlMs() {
        return 20;
      },
    };

    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 300,
      lockRenewIntervalMs: 5,
      onLockContention,
      onWarning,
    });

    const result = await processor.process('evt.renewal.warning', async () => {
      await sleep(25);
    });

    expect(result).toEqual({ processed: true });
    expect(onLockContention).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith({
      type: 'lock-renewal-failed',
      eventId: 'evt.renewal.warning',
    });
  });
});
