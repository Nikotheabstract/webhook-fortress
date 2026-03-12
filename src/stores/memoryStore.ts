import type { WebhookStore } from './WebhookStore.js';

export class MemoryWebhookStore implements WebhookStore {
  private readonly processedEvents = new Set<string>();
  private readonly locks = new Set<string>();
  private readonly failedEvents = new Map<string, unknown>();

  async hasProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }

  async recordFailure(eventId: string, error?: unknown): Promise<void> {
    this.failedEvents.set(eventId, error ?? new Error('unknown webhook processing failure'));
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

  async renewLock(eventId: string): Promise<boolean> {
    return this.locks.has(eventId);
  }

  getLockTtlMs(): number | undefined {
    return undefined;
  }

  getFailures(): ReadonlyMap<string, unknown> {
    return new Map(this.failedEvents);
  }
}

export const memoryStore = () => new MemoryWebhookStore();
