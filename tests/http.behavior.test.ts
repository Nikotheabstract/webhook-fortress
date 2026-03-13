import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const withFreshEntryTimestamp = (payload: unknown): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : null;
  if (!entries) {
    return payload;
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const normalizedEntries = entries.map((entry) => {
    if (!isRecord(entry)) {
      return entry;
    }

    if (typeof entry.time === 'number') {
      return entry;
    }

    return {
      ...entry,
      time: nowSeconds,
    };
  });

  return {
    ...payload,
    entry: normalizedEntries,
  };
};

const signPayload = (payload: unknown, secret: string, options?: { preservePayloadTimestamp?: boolean }) => {
  const normalizedPayload = options?.preservePayloadTimestamp ? payload : withFreshEntryTimestamp(payload);
  const raw = JSON.stringify(normalizedPayload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');

  return {
    raw,
    signatureHeader: `sha256=${signature}`,
  };
};

const createRequest = (
  payload: unknown,
  secret: string,
  options?: { signatureOverride?: string; preservePayloadTimestamp?: boolean }
) => {
  const { raw, signatureHeader } = signPayload(payload, secret, {
    preservePayloadTimestamp: options?.preservePayloadTimestamp,
  });
  const resolvedSignature = options?.signatureOverride ?? signatureHeader;

  return {
    body: Buffer.from(raw, 'utf8'),
    headers: {
      'x-hub-signature-256': resolvedSignature,
    },
    header: (name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? resolvedSignature : undefined),
  };
};

const createResponse = () => ({
  sendStatus: vi.fn((statusCode: number) => statusCode),
});

describe('Webhook Fortress HTTP behavior', () => {
  it('returns 401 for invalid signature and does not execute handler', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const req = createRequest(
      {
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ message: { mid: 'mid.401' } }] }],
      },
      'meta-secret',
      { signatureOverride: 'sha256=deadbeef' }
    );
    const res = createResponse();

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 400 for payload without supported object/channel', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const req = createRequest({ entry: [] }, 'meta-secret');
    const res = createResponse();

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 500 when handler throws', async () => {
    const handler = vi.fn(async () => {
      throw new Error('handler failure');
    });

    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const req = createRequest(
      {
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [{ message: { mid: 'mid.500', text: 'hello' } }],
          },
        ],
      },
      'meta-secret'
    );
    const res = createResponse();

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(500);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when webhook timestamp is outside tolerance window', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const staleTimestampSeconds = Math.floor(Date.now() / 1_000) - 1_000;
    const req = createRequest(
      {
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: staleTimestampSeconds,
            messaging: [{ message: { mid: 'mid.stale.401' } }],
          },
        ],
      },
      'meta-secret'
    );
    const res = createResponse();

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 401 when request has no timestamp signal for replay protection', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const req = createRequest(
      {
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ message: { mid: 'mid.no.timestamp.401' } }] }],
      },
      'meta-secret',
      { preservePayloadTimestamp: true }
    );
    const res = createResponse();

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
