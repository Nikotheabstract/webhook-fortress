import { describe, expect, it } from 'vitest';
import { createEventProcessor } from '../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../src/stores/WebhookStore.js';

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

class SpyStore implements WebhookStore {
  readonly processedEvents = new Set<string>();
  readonly locks = new Set<string>();
  readonly failures = new Map<string, unknown>();
  markProcessedCalls = 0;
  recordFailureCalls = 0;

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.markProcessedCalls += 1;
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

describe('EventProcessor failure tracking', () => {
  it('records failure, does not mark processed, and allows retry', async () => {
    const store = new SpyStore();
    const processor = createEventProcessor(store, { retryIntervalMs: 2, acquireTimeoutMs: 300 });

    const handlerError = new Error('boom');

    await expect(
      processor.process('evt.failure.1', async () => {
        throw handlerError;
      })
    ).rejects.toThrow('boom');

    expect(store.recordFailureCalls).toBe(1);
    expect(store.failures.get('evt.failure.1')).toBe(handlerError);
    expect(store.markProcessedCalls).toBe(0);
    expect(await store.hasProcessed('evt.failure.1')).toBe(false);

    const retryResult = await processor.process('evt.failure.1', async () => undefined);
    expect(retryResult).toEqual({ processed: true });
    expect(store.markProcessedCalls).toBe(1);
    expect(await store.hasProcessed('evt.failure.1')).toBe(true);

    const duplicate = await processor.process('evt.failure.1', async () => undefined);
    expect(duplicate).toEqual({ processed: false });
    expect(store.markProcessedCalls).toBe(1);
  });

  it('keeps concurrent failure attempts lock-safe', async () => {
    const store = new SpyStore();
    const processor = createEventProcessor(store, { retryIntervalMs: 2, acquireTimeoutMs: 1_000 });

    let activeHandlers = 0;
    let maxActiveHandlers = 0;
    let invocations = 0;

    const failingHandler = async () => {
      invocations += 1;
      activeHandlers += 1;
      maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);

      await sleep(25);

      activeHandlers -= 1;
      throw new Error('concurrent failure');
    };

    const results = await Promise.allSettled([
      processor.process('evt.failure.concurrent', failingHandler),
      processor.process('evt.failure.concurrent', failingHandler),
      processor.process('evt.failure.concurrent', failingHandler),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(maxActiveHandlers).toBe(1);
    expect(store.recordFailureCalls).toBe(invocations);
    expect(store.markProcessedCalls).toBe(0);
    expect(await store.hasProcessed('evt.failure.concurrent')).toBe(false);
  });
});
