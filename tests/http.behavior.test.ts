import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';
import { createSignedMetaRequest } from './utils/metaSignedRequest.js';

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

    const req = createSignedMetaRequest(
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

    const req = createSignedMetaRequest({ entry: [] }, 'meta-secret');
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

    const req = createSignedMetaRequest(
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
    const req = createSignedMetaRequest(
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

    const req = createSignedMetaRequest(
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
