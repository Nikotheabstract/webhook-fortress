import { describe, expect, it, vi } from 'vitest';
import { createWebhookFortress } from '../index.js';

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe('EventProcessor concurrency', () => {
  it('executes handler once for concurrent duplicate process calls', async () => {
    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
    });

    const handler = vi.fn(async () => {
      await sleep(40);
    });

    await Promise.all([
      webhook.process('evt.concurrent.1', handler),
      webhook.process('evt.concurrent.1', handler),
      webhook.process('evt.concurrent.1', handler),
      webhook.process('evt.concurrent.1', handler),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
