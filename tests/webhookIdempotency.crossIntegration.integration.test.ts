import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';

const createSignedRequest = (payload: unknown, secret: string) => {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return {
    body: Buffer.from(raw, 'utf8'),
    headers: {
      'x-hub-signature-256': `sha256=${signature}`,
    },
    header: (name: string) =>
      name.toLowerCase() === 'x-hub-signature-256' ? `sha256=${signature}` : undefined,
  };
};

describe('Webhook idempotency - cross integration isolation', () => {
  it('treats different page/integration payloads as distinct events', async () => {
    const handler = vi.fn(async () => undefined);
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler,
    });

    const payloadFor = (pageId: string) => ({
      object: 'page',
      entry: [
        {
          id: pageId,
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: pageId },
              timestamp: Date.now(),
              message: {
                mid: 'mid.shared.1',
                text: `Message for ${pageId}`,
              },
            },
          ],
        },
      ],
    });

    const reqA = createSignedRequest(payloadFor('page-A'), 'meta-secret');
    const reqB = createSignedRequest(payloadFor('page-B'), 'meta-secret');
    const resA = { sendStatus: vi.fn((code: number) => code) };
    const resB = { sendStatus: vi.fn((code: number) => code) };

    await webhook.handleRequest(reqA, resA);
    await webhook.handleRequest(reqB, resB);

    expect(resA.sendStatus).toHaveBeenCalledWith(200);
    expect(resB.sendStatus).toHaveBeenCalledWith(200);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]?.id).toBe('meta:messenger:page-A:mid.shared.1');
    expect(handler.mock.calls[1]?.[0]?.id).toBe('meta:messenger:page-B:mid.shared.1');
    expect(handler.mock.calls[0]?.[0]?.provider).toBe('meta');
    expect(handler.mock.calls[1]?.[0]?.provider).toBe('meta');
  });
});
