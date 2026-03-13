import type { Request, WebhookEvent } from '../types.js';

export type WebhookFreshnessCheckResult =
  | {
      ok: true;
      reason: string;
    }
  | {
      ok: false;
      reason: string;
      details?: Record<string, unknown>;
    };

export interface WebhookProvider {
  verifySignature(req: Request): boolean;
  parseEvent(req: Request): WebhookEvent;
  verifyFreshness?: (req: Request) => WebhookFreshnessCheckResult;
}
