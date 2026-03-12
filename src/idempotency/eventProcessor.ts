import { hasEventBeenProcessed, markEventAsProcessed } from './dedupe.js';
import { type LockingOptions, withEventLock } from './locking.js';
import type { WebhookStore } from '../stores/WebhookStore.js';
import {
  calculateBackoffDelay,
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_CAP_DELAY_MS,
  sleep,
} from '../utils/backoff.js';

export type EventProcessHandler = () => Promise<void> | void;

export type EventProcessResult = {
  processed: boolean;
};

export type EventProcessorOptions = LockingOptions & {
  onDuplicate?: (eventId: string) => void;
  maxHandlerRetries?: number;
  handlerRetryBaseDelayMs?: number;
  handlerRetryMaxDelayMs?: number;
};

const DEFAULT_MAX_HANDLER_RETRIES = 0;

export class EventProcessor {
  private readonly store: WebhookStore;
  private readonly options: EventProcessorOptions;

  constructor(store: WebhookStore, options: EventProcessorOptions = {}) {
    this.store = store;
    this.options = options;
  }

  async process(eventId: string, handler: EventProcessHandler): Promise<EventProcessResult> {
    const normalizedEventId = eventId.trim();
    if (!normalizedEventId) {
      throw new Error('eventId is required for idempotent processing');
    }

    if (await hasEventBeenProcessed(this.store, normalizedEventId)) {
      this.emitDuplicate(normalizedEventId);
      return { processed: false };
    }

    try {
      return await withEventLock(
        this.store,
        normalizedEventId,
        async () => {
          if (await hasEventBeenProcessed(this.store, normalizedEventId)) {
            this.emitDuplicate(normalizedEventId);
            return { processed: false };
          }

          try {
            await this.executeHandlerWithRetries(handler);
            await markEventAsProcessed(this.store, normalizedEventId);
          } catch (error) {
            try {
              await this.store.recordFailure(normalizedEventId, error);
            } catch {
              // Preserve handler failure as the primary error when failure logging itself fails.
            }
            throw error;
          }

          return { processed: true };
        },
        this.options
      );
    } catch (error) {
      if (await hasEventBeenProcessed(this.store, normalizedEventId)) {
        this.emitDuplicate(normalizedEventId);
        return { processed: false };
      }

      throw error;
    }
  }

  private async executeHandlerWithRetries(handler: EventProcessHandler): Promise<void> {
    const maxHandlerRetries = Math.max(0, this.options.maxHandlerRetries ?? DEFAULT_MAX_HANDLER_RETRIES);
    const baseDelayMs = Math.max(
      1,
      this.options.handlerRetryBaseDelayMs ??
        this.options.retryBaseDelayMs ??
        this.options.retryIntervalMs ??
        DEFAULT_BACKOFF_BASE_DELAY_MS
    );
    const maxDelayMs = Math.max(
      baseDelayMs,
      this.options.handlerRetryMaxDelayMs ?? this.options.retryMaxDelayMs ?? DEFAULT_BACKOFF_CAP_DELAY_MS
    );

    let attempt = 0;

    while (true) {
      try {
        await handler();
        return;
      } catch (error) {
        if (attempt >= maxHandlerRetries) {
          throw error;
        }

        // Retry with exponential backoff + full jitter to avoid synchronized retries.
        const delayMs = calculateBackoffDelay(attempt, {
          baseDelayMs,
          capDelayMs: maxDelayMs,
        });

        attempt += 1;
        await sleep(delayMs);
      }
    }
  }

  private emitDuplicate(eventId: string): void {
    if (typeof this.options.onDuplicate !== 'function') {
      return;
    }

    try {
      this.options.onDuplicate(eventId);
    } catch {
      // Hooks are observational and must never alter processor control flow.
    }
  }
}

export const createEventProcessor = (store: WebhookStore, options: EventProcessorOptions = {}) =>
  new EventProcessor(store, options);
