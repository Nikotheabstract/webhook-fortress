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
  return {
    ...payload,
    entry: entries.map((entry) => {
      if (!isRecord(entry) || typeof entry.time === 'number') {
        return entry;
      }

      return {
        ...entry,
        time: nowSeconds,
      };
    }),
  };
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const createSignedRequest = (payload: unknown, secret: string) => {
  const raw = JSON.stringify(withFreshEntryTimestamp(payload));
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

describe('observability hooks', () => {
  it('invokes onEventReceived and onProcessed for successful requests', async () => {
    const onEventReceived = vi.fn();
    const onProcessed = vi.fn();
    const onFailed = vi.fn();

    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler: async () => undefined,
      onEventReceived,
      onProcessed,
      onFailed,
    });

    const req = createSignedRequest(
      {
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ message: { mid: 'mid.hooks.1' } }] }],
      },
      'meta-secret'
    );
    const res = { sendStatus: vi.fn((statusCode: number) => statusCode) };

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(onEventReceived).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('invokes onFailed when handler throws and ignores hook errors', async () => {
    const onEventReceived = vi.fn(() => {
      throw new Error('hook error');
    });
    const onFailed = vi.fn(() => {
      throw new Error('failed hook error');
    });

    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      handler: async () => {
        throw new Error('handler failed');
      },
      onEventReceived,
      onFailed,
    });

    const req = createSignedRequest(
      {
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ message: { mid: 'mid.hooks.2' } }] }],
      },
      'meta-secret'
    );
    const res = { sendStatus: vi.fn((statusCode: number) => statusCode) };

    await webhook.handleRequest(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(500);
    expect(onEventReceived).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('invokes onDuplicate and onLockContention during concurrent processing', async () => {
    const onDuplicate = vi.fn();
    const onLockContention = vi.fn();
    const onWarning = vi.fn();

    const webhook = createWebhookFortress({
      provider: 'meta',
      secret: 'meta-secret',
      onDuplicate,
      onLockContention,
      onWarning,
    });

    const first = webhook.process('evt.hooks.concurrent', async () => {
      await sleep(40);
    });

    await sleep(5);

    const second = webhook.process('evt.hooks.concurrent', async () => undefined);

    const [resultA, resultB] = await Promise.all([first, second]);

    const processedCount = [resultA, resultB].filter((result) => result.processed).length;
    const duplicateCount = [resultA, resultB].filter((result) => !result.processed).length;

    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(1);
    expect(onLockContention).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith({
      type: 'lock-contention',
      eventId: 'evt.hooks.concurrent',
    });
  });
});
