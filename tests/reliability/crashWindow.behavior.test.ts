import { describe, expect, it } from 'vitest';
import { createEventProcessor } from '../../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../../src/stores/WebhookStore.js';

class CrashWindowStore implements WebhookStore {
  readonly processedEvents = new Set<string>();
  readonly locks = new Set<string>();
  readonly failures = new Map<string, unknown>();
  private failMarkProcessedOnce = true;

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    if (this.failMarkProcessedOnce) {
      this.failMarkProcessedOnce = false;
      throw new Error('simulated crash after handler side effect');
    }

    this.processedEvents.add(eventId);
  }

  async recordFailure(eventId: string, error?: unknown): Promise<void> {
    this.failures.set(eventId, error);
  }

  async acquireLock(eventId: string): Promise<boolean> {
    if (this.locks.has(eventId)) {
      return false;
    }
    this.locks.add(eventId);
    return true;
  }

  async releaseLock(eventId: string): Promise<void> {
    this.locks.delete(eventId);
  }
}

describe('crash window behavior', () => {
  it('replays handler side effects when crash occurs before markProcessed', async () => {
    const store = new CrashWindowStore();
    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 300,
    });

    let sideEffectCount = 0;

    await expect(
      processor.process('evt.crash.window', async () => {
        sideEffectCount += 1;
      })
    ).rejects.toThrow('simulated crash after handler side effect');

    expect(sideEffectCount).toBe(1);
    expect(await store.hasProcessed('evt.crash.window')).toBe(false);

    const retryResult = await processor.process('evt.crash.window', async () => {
      sideEffectCount += 1;
    });

    expect(retryResult).toEqual({ processed: true });
    expect(sideEffectCount).toBe(2);
    expect(await store.hasProcessed('evt.crash.window')).toBe(true);
  });
});
