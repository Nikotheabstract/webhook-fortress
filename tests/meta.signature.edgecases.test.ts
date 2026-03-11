import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { MetaWebhookProvider } from '../src/providers/meta/MetaWebhookProvider.js';

const sign = (rawBody: string, secret: string) => createHmac('sha256', secret).update(rawBody).digest('hex');

const createRequest = (rawBody: string, signatureHeader?: string | string[]) => ({
  body: Buffer.from(rawBody, 'utf8'),
  headers: signatureHeader === undefined ? {} : { 'x-hub-signature-256': signatureHeader },
  header: (name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? signatureHeader : undefined),
});

describe('Meta signature verification edge cases', () => {
  it('supports multiple signature header values when first sha256 candidate is valid', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const validDigest = sign(rawBody, 'meta-secret');

    const req = createRequest(rawBody, [`sha256=${validDigest}`, 'not-a-signature']);

    expect(provider.verifySignature(req)).toBe(true);
  });

  it('rejects wrong secret', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const wrongDigest = sign(rawBody, 'wrong-secret');

    const req = createRequest(rawBody, `sha256=${wrongDigest}`);

    expect(provider.verifySignature(req)).toBe(false);
  });

  it('rejects missing signature header', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });

    const req = createRequest(rawBody);

    expect(provider.verifySignature(req)).toBe(false);
  });

  it('rejects malformed signature header', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });

    const req = createRequest(rawBody, 'sha256=not-hex');

    expect(provider.verifySignature(req)).toBe(false);
  });
});
