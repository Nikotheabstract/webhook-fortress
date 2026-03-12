import { describe, expect, it } from 'vitest';
import { createEventProcessor } from '../../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../../src/stores/WebhookStore.js';

class RetryAwareStore implements WebhookStore {
  readonly processedEvents = new Set<string>();
  readonly locks = new Set<string>();
  readonly failures = new Map<string, unknown>();
  recordFailureCalls = 0;

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }

  async recordFailure(eventId: string, error?: unknown): Promise<void> {
    this.recordFailureCalls += 1;
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

describe('event handler retry backoff', () => {
  it('retries failed handlers with backoff and succeeds before failure recording', async () => {
    const store = new RetryAwareStore();
    const processor = createEventProcessor(store, {
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      acquireTimeoutMs: 200,
      maxHandlerRetries: 2,
      handlerRetryBaseDelayMs: 1,
      handlerRetryMaxDelayMs: 5,
    });

    let attempts = 0;

    const result = await processor.process('evt.retry.success', async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('transient handler error');
      }
    });

    expect(result).toEqual({ processed: true });
    expect(attempts).toBe(3);
    expect(store.recordFailureCalls).toBe(0);
    expect(await store.hasProcessed('evt.retry.success')).toBe(true);
  });

  it('records failure once when retries are exhausted', async () => {
    const store = new RetryAwareStore();
    const processor = createEventProcessor(store, {
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      acquireTimeoutMs: 200,
      maxHandlerRetries: 1,
      handlerRetryBaseDelayMs: 1,
      handlerRetryMaxDelayMs: 5,
    });

    let attempts = 0;

    await expect(
      processor.process('evt.retry.failure', async () => {
        attempts += 1;
        throw new Error('persistent handler error');
      })
    ).rejects.toThrow('persistent handler error');

    expect(attempts).toBe(2);
    expect(store.recordFailureCalls).toBe(1);
    expect(await store.hasProcessed('evt.retry.failure')).toBe(false);
  });
});
