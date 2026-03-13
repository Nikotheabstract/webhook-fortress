import { createHash } from 'crypto';
import { ZodError } from 'zod';
import type { WebhookEventHandler } from '../../handlers/WebhookEventHandler.js';
import type { Request, Response, WebhookEvent } from '../../types.js';
import type { WebhookFreshnessCheckResult, WebhookProvider } from '../WebhookProvider.js';
import type {
  MetaChannel,
} from './metaEventParser.js';
import { resolveChannel } from './metaEventParser.js';
import type { WebhookSecretCandidate } from './metaSignature.js';
import {
  resolveWebhookToleranceSeconds,
  verifyRequestFreshness,
  verifyWebhookSignature,
} from './metaSignature.js';
import type {
  MetaChange,
  MetaEntry,
  MetaMessagingEvent,
  MetaWebhookNotificationPayload,
} from '../../schemas/metaWebhookSchemas.js';
import { MetaWebhookNotificationSchema } from '../../schemas/metaWebhookSchemas.js';

export type WebhookEventHandlerFn = (event: WebhookEvent) => Promise<void> | void;

export type ParsedMetaWebhookEvent = WebhookEvent & {
  type: `meta.${MetaChannel}`;
  payload: {
    channel: MetaChannel;
    entries: MetaEntry[];
    messagingEvents: MetaMessagingEvent[];
    referralChanges: MetaChange[];
    payloadObject: string | null;
  };
};

export type MetaWebhookProviderConfig = {
  secret?: string;
  instagramSecret?: string;
  forcedChannel?: MetaChannel;
  webhookToleranceSeconds?: number;
  /**
   * @deprecated Keeping this true weakens replay protection.
   */
  allowMissingTimestamp?: boolean;
  handler?: WebhookEventHandler | WebhookEventHandlerFn;
};

const coerceHeaderValue = (value: unknown): string | string[] | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value;
  }
  return undefined;
};

const resolvePrimaryEntryId = (entries: MetaEntry[]): string | null => {
  for (const entry of entries) {
    if (typeof entry?.id === 'string' && entry.id.trim().length > 0) {
      return entry.id;
    }
  }

  return null;
};

const resolvePrimaryMessageId = (messagingEvents: MetaMessagingEvent[]): string | null => {
  for (const event of messagingEvents) {
    if (typeof event?.message?.mid === 'string' && event.message.mid.trim().length > 0) {
      return event.message.mid;
    }
  }

  return null;
};

const resolveEventId = (
  channel: MetaChannel,
  entries: MetaEntry[],
  messagingEvents: MetaMessagingEvent[],
  payloadDigest: string
) => {
  const entryId = resolvePrimaryEntryId(entries);
  const messageId = resolvePrimaryMessageId(messagingEvents);

  if (entryId && messageId) {
    return `meta:${channel}:${entryId}:${messageId}`;
  }

  if (messageId) {
    return `meta:${channel}:${messageId}`;
  }

  if (entryId) {
    return `meta:${channel}:${entryId}:${payloadDigest}`;
  }

  return `meta:${channel}:${payloadDigest}`;
};

const logValidationError = (error: unknown) => {
  if (error instanceof ZodError) {
    // Security logging: capture schema issues without logging full raw payload content.
    console.error('[Webhook Fortress] Meta webhook validation failed', {
      issues: error.issues,
    });
    return;
  }

  console.error('[Webhook Fortress] Meta webhook payload parse failed', error);
};

export class MetaWebhookProvider implements WebhookProvider {
  private readonly config: MetaWebhookProviderConfig;
  private readonly handler: WebhookEventHandler;

  constructor(config: MetaWebhookProviderConfig = {}) {
    this.config = config;
    this.handler = this.resolveHandler(config.handler);
  }

  verifySignature(req: Request): boolean {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody) {
      return false;
    }

    const signatureHeader = this.readSignatureHeader(req);
    const check = verifyWebhookSignature(signatureHeader, rawBody, this.buildSecretCandidates());
    return check.ok;
  }

  verifyFreshness(req: Request): WebhookFreshnessCheckResult {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
    const freshness = verifyRequestFreshness({
      signatureHeader: this.readSignatureHeader(req),
      timestampHeader: this.readTimestampHeader(req),
      rawBody,
      toleranceSeconds: resolveWebhookToleranceSeconds(this.config.webhookToleranceSeconds),
    });

    if (!freshness.ok) {
      return {
        ok: false,
        reason: freshness.reason,
        details: {
          requestTimestampSeconds: freshness.requestTimestampSeconds,
          ageSeconds: freshness.ageSeconds,
          toleranceSeconds: freshness.toleranceSeconds,
        },
      };
    }

    if (freshness.reason === 'timestamp_unavailable' && !this.config.allowMissingTimestamp) {
      return {
        ok: false,
        reason: 'timestamp_unavailable',
        details: {
          toleranceSeconds: freshness.toleranceSeconds,
        },
      };
    }

    return {
      ok: true,
      reason: freshness.reason,
    };
  }

  parseEvent(req: Request): ParsedMetaWebhookEvent {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    if (!rawBody) {
      throw new Error('Missing raw body');
    }

    let payloadCandidate: unknown;
    try {
      payloadCandidate = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON payload');
    }

    let payload: MetaWebhookNotificationPayload;
    try {
      payload = MetaWebhookNotificationSchema.parse(payloadCandidate);
    } catch (error) {
      logValidationError(error);
      throw new Error('Invalid webhook payload');
    }

    const channel = this.config.forcedChannel ?? resolveChannel(payload);
    if (!channel) {
      throw new Error('Unsupported webhook payload');
    }
    if (this.config.forcedChannel && channel !== this.config.forcedChannel) {
      throw new Error('Webhook channel mismatch');
    }

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    const messagingEvents = entries.flatMap((entry) => entry.messaging ?? []);
    const referralChanges = entries.flatMap((entry) => entry.changes ?? []);
    const payloadDigest = createHash('sha256').update(rawBody).digest('hex');

    return {
      id: resolveEventId(channel, entries, messagingEvents, payloadDigest),
      provider: 'meta',
      type: `meta.${channel}`,
      payload: {
        channel,
        entries,
        messagingEvents,
        referralChanges,
        payloadObject: payload.object ?? null,
      },
      receivedAt: new Date(),
    };
  }

  async handleRequest(req: Request, res: Response) {
    // Backward-compatible convenience wrapper.
    // Prefer createWebhookFortress(...).handleRequest for orchestration.
    if (!this.verifySignature(req)) {
      return res.sendStatus(401);
    }

    let event: ParsedMetaWebhookEvent;
    try {
      event = this.parseEvent(req);
    } catch {
      return res.sendStatus(400);
    }

    const freshness = this.verifyFreshness(req);
    if (!freshness.ok) {
      console.warn('[Webhook Fortress] Meta webhook rejected by freshness policy', {
        reason: freshness.reason,
        ...freshness.details,
      });
      return res.sendStatus(401);
    }

    try {
      await this.handler.handle(event);
      return res.sendStatus(200);
    } catch {
      return res.sendStatus(500);
    }
  }

  private readSignatureHeader(req: Request): string | string[] | undefined {
    const fromHeaders = coerceHeaderValue(req.headers['x-hub-signature-256'] ?? req.headers['x-hub-signature']);
    if (fromHeaders) {
      return fromHeaders;
    }

    if (typeof req.header === 'function') {
      const fromSha256 = coerceHeaderValue(req.header('X-Hub-Signature-256'));
      if (fromSha256) {
        return fromSha256;
      }

      const fromLegacy = coerceHeaderValue(req.header('X-Hub-Signature'));
      if (fromLegacy) {
        return fromLegacy;
      }
    }

    return undefined;
  }

  private readTimestampHeader(req: Request): string | string[] | undefined {
    const headerNames = [
      'x-webhook-timestamp',
      'x-hub-timestamp',
      'x-request-timestamp',
      'x-timestamp',
    ] as const;

    for (const headerName of headerNames) {
      const fromHeaders = coerceHeaderValue(req.headers[headerName]);
      if (fromHeaders) {
        return fromHeaders;
      }

      if (typeof req.header === 'function') {
        const fromHeaderFunction = coerceHeaderValue(req.header(headerName));
        if (fromHeaderFunction) {
          return fromHeaderFunction;
        }
      }
    }

    return undefined;
  }

  private buildSecretCandidates(): WebhookSecretCandidate[] {
    const resolvedMetaSecret = this.config.secret?.trim() || (process.env.META_APP_SECRET ?? '').trim();
    const resolvedInstagramSecret =
      this.config.instagramSecret?.trim() || (process.env.INSTAGRAM_APP_SECRET ?? '').trim();

    if (this.config.forcedChannel === 'messenger') {
      return [{ label: 'meta', value: resolvedMetaSecret }];
    }

    if (this.config.forcedChannel === 'instagram') {
      return [
        { label: 'instagram', value: resolvedInstagramSecret },
        { label: 'meta', value: resolvedMetaSecret },
      ];
    }

    return [
      { label: 'instagram', value: resolvedInstagramSecret },
      { label: 'meta', value: resolvedMetaSecret },
    ];
  }

  private resolveHandler(handler?: WebhookEventHandler | WebhookEventHandlerFn): WebhookEventHandler {
    if (!handler) {
      return { handle: async () => undefined };
    }

    if (typeof handler === 'function') {
      return {
        handle: async (event) => {
          await handler(event);
        },
      };
    }

    return handler;
  }
}
