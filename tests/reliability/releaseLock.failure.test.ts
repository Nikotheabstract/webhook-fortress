import { describe, expect, it, vi } from 'vitest';
import { createEventProcessor } from '../../src/idempotency/eventProcessor.js';
import type { WebhookStore } from '../../src/stores/WebhookStore.js';

class ReleaseFailureStore implements WebhookStore {
  readonly processedEvents = new Set<string>();
  readonly locks = new Set<string>();
  readonly failures = new Map<string, unknown>();

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
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
    throw new Error('releaseLock failed');
  }
}

describe('releaseLock failure protection', () => {
  it('preserves successful processing result when releaseLock throws', async () => {
    const onLockContention = vi.fn();
    const onWarning = vi.fn();
    const store = new ReleaseFailureStore();
    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 300,
      onLockContention,
      onWarning,
    });

    const result = await processor.process('evt.release.success', async () => undefined);

    expect(result).toEqual({ processed: true });
    expect(await store.hasProcessed('evt.release.success')).toBe(true);
    expect(onLockContention).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lock-release-failed',
        eventId: 'evt.release.success',
      })
    );
  });

  it('preserves original handler error when handler and releaseLock both throw', async () => {
    const onLockContention = vi.fn();
    const onWarning = vi.fn();
    const store = new ReleaseFailureStore();
    const processor = createEventProcessor(store, {
      retryIntervalMs: 2,
      acquireTimeoutMs: 300,
      onLockContention,
      onWarning,
    });

    await expect(
      processor.process('evt.release.failure', async () => {
        throw new Error('handler failed');
      })
    ).rejects.toThrow('handler failed');

    expect(await store.hasProcessed('evt.release.failure')).toBe(false);
    expect(store.failures.get('evt.release.failure')).toBeInstanceOf(Error);
    expect(onLockContention).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'lock-release-failed',
        eventId: 'evt.release.failure',
      })
    );
  });
});
