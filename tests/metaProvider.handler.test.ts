import { describe, expect, it, vi } from 'vitest';
import { MetaWebhookProvider } from '../src/providers/meta/MetaWebhookProvider.js';
import { createSignedMetaRequest } from './utils/metaSignedRequest.js';

describe('MetaWebhookProvider', () => {
  it('delivers parsed event to handler', async () => {
    const handler = vi.fn(async () => undefined);
    const provider = new MetaWebhookProvider({
      secret: 'meta-secret',
      handler,
    });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid.1',
                text: 'Hello',
              },
            },
          ],
        },
      ],
    };

    const req = createSignedMetaRequest(payload, 'meta-secret');

    const res = {
      sendStatus: vi.fn((code: number) => code),
    };

    await provider.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(handler).toHaveBeenCalledTimes(1);

    const event = handler.mock.calls[0]?.[0];
    expect(event.provider).toBe('meta');
    expect(event.type).toBe('meta.messenger');
    expect(event.id).toBe('meta:messenger:page-1:mid.1');
    expect(event.receivedAt instanceof Date).toBe(true);
  });

  it('rejects requests without timestamp signals in legacy handleRequest path', async () => {
    const handler = vi.fn(async () => undefined);
    const provider = new MetaWebhookProvider({
      secret: 'meta-secret',
      handler,
    });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              message: {
                mid: 'mid.no.timestamp',
                text: 'Hello',
              },
            },
          ],
        },
      ],
    };

    const req = createSignedMetaRequest(payload, 'meta-secret', {
      preservePayloadTimestamp: true,
    });

    const res = {
      sendStatus: vi.fn((code: number) => code),
    };

    await provider.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
