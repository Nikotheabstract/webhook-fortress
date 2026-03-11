import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';

const signPayload = (payload: unknown, secret: string) => {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');

  return {
    raw,
    signatureHeader: `sha256=${signature}`,
  };
};

const createRequest = (payload: unknown, secret: string, options?: { signatureOverride?: string }) => {
  const { raw, signatureHeader } = signPayload(payload, secret);
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
});
