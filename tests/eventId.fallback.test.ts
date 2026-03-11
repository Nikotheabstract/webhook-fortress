import { describe, expect, it } from 'vitest';
import { MetaWebhookProvider } from '../src/providers/meta/MetaWebhookProvider.js';

const createRequest = (payload: unknown) => ({
  body: Buffer.from(JSON.stringify(payload), 'utf8'),
  headers: {},
});

describe('Meta eventId fallback generation', () => {
  it('generates digest-based fallback id when message id is missing', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'user-1' },
              recipient: { id: 'page-1' },
              message: { text: 'no mid available' },
            },
          ],
        },
      ],
    };

    const event = provider.parseEvent(createRequest(payload));

    expect(event.id).toMatch(/^meta:messenger:page-1:[a-f0-9]{64}$/);
  });

  it('generates identical eventId for identical payloads without message id', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [{ message: { text: 'same payload' } }],
        },
      ],
    };

    const eventA = provider.parseEvent(createRequest(payload));
    const eventB = provider.parseEvent(createRequest(payload));

    expect(eventA.id).toBe(eventB.id);
  });

  it('generates different eventIds for different payloads without message id', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });

    const payloadA = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [{ message: { text: 'payload A' } }],
        },
      ],
    };

    const payloadB = {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [{ message: { text: 'payload B' } }],
        },
      ],
    };

    const eventA = provider.parseEvent(createRequest(payloadA));
    const eventB = provider.parseEvent(createRequest(payloadB));

    expect(eventA.id).not.toBe(eventB.id);
  });
});
