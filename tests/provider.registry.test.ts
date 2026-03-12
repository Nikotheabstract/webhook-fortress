import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';
import type { Request, WebhookEvent } from '../src/types.js';

describe('provider registry', () => {
  it('supports dynamic provider registration', async () => {
    const handler = vi.fn(async () => undefined);
    const customEvent: WebhookEvent = {
      id: 'custom.1',
      provider: 'custom',
      type: 'custom.event',
      payload: { ok: true },
      receivedAt: new Date(),
    };

    const customProvider = {
      verifySignature: (_req: Request) => true,
      parseEvent: (_req: Request) => customEvent,
    };

    const webhooks = createWebhookFortress({
      provider: 'custom',
      providers: {
        custom: customProvider,
      },
      handler,
    });

    const res = { sendStatus: vi.fn((statusCode: number) => statusCode) };
    await webhooks.handleRequest({ headers: {}, body: Buffer.from('{}') }, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual(customEvent);
  });

  it('keeps backward compatibility for meta provider selection', () => {
    const webhooks = createWebhookFortress({ provider: 'meta' });
    expect(() => webhooks.getProvider('meta')).not.toThrow();
  });
});
