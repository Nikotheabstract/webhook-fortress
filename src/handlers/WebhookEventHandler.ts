import type { WebhookEvent } from '../types.js';

export interface WebhookEventHandler {
  handle(event: WebhookEvent): Promise<void>;
}
