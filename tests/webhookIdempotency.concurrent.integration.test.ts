import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';
import { createSignedMetaRequest } from './utils/metaSignedRequest.js';

describe('Webhook idempotency - concurrent duplicate delivery', () => {
  it('processes duplicate deliveries exactly once', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: Date.now(),
              message: {
                mid: 'mid.duplicate.1',
                text: 'Hello from concurrent webhook',
              },
            },
          ],
        },
      ],
    };

    const reqA = createSignedMetaRequest(payload, 'meta-secret');
    const reqB = createSignedMetaRequest(payload, 'meta-secret');
    const resA = { sendStatus: vi.fn((code: number) => code) };
    const resB = { sendStatus: vi.fn((code: number) => code) };

    await Promise.all([webhook.handleRequest(reqA, resA), webhook.handleRequest(reqB, resB)]);

    expect(resA.sendStatus).toHaveBeenCalledWith(200);
    expect(resB.sendStatus).toHaveBeenCalledWith(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.id).toBe('meta:messenger:page-1:mid.duplicate.1');
  });
});
