import type { Request, WebhookEvent } from '../types.js';

export interface WebhookProvider {
  verifySignature(req: Request): boolean;
  parseEvent(req: Request): WebhookEvent;
}
