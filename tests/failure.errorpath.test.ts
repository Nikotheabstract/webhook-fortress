import { describe, expect, it } from 'vitest';
import { createEventProcessor } from '../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../src/stores/WebhookStore.js';

class RecordFailureThrowingStore implements WebhookStore {
  readonly processedEvents = new Set<string>();
  readonly locks = new Set<string>();
  markProcessedCalls = 0;
  recordFailureCalls = 0;

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.markProcessedCalls += 1;
    this.processedEvents.add(eventId);
  }

  async recordFailure(_eventId: string): Promise<void> {
    this.recordFailureCalls += 1;
    throw new Error('recordFailure failed');
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

describe('EventProcessor failure error path', () => {
  it('propagates original handler error, keeps event unprocessed, and releases lock', async () => {
    const store = new RecordFailureThrowingStore();
    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 500,
    });

    await expect(
      processor.process('evt.failure.errorpath', async () => {
        throw new Error('handler exploded');
      })
    ).rejects.toThrow('handler exploded');

    expect(store.recordFailureCalls).toBe(1);
    expect(store.markProcessedCalls).toBe(0);
    expect(await store.hasProcessed('evt.failure.errorpath')).toBe(false);

    // Lock must be released despite handler + recordFailure failure.
    expect(await store.acquireLock('evt.failure.errorpath')).toBe(true);
    await store.releaseLock('evt.failure.errorpath');

    const retry = await processor.process('evt.failure.errorpath', async () => undefined);
    expect(retry).toEqual({ processed: true });
    expect(await store.hasProcessed('evt.failure.errorpath')).toBe(true);
  });
});
