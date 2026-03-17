import { describe, expect, it } from 'vitest';
import { MetaWebhookProvider } from '../src/providers/meta/MetaWebhookProvider.js';
import { createMetaRequest, signRawBody } from './utils/metaSignedRequest.js';

describe('Meta signature verification edge cases', () => {
  it('supports multiple signature header values when first sha256 candidate is valid', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const validDigest = signRawBody(rawBody, 'meta-secret');

    const req = createMetaRequest(rawBody, [`sha256=${validDigest}`, 'not-a-signature']);

    expect(provider.verifySignature(req)).toBe(true);
  });

  it('rejects wrong secret', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });
    const wrongDigest = signRawBody(rawBody, 'wrong-secret');

    const req = createMetaRequest(rawBody, `sha256=${wrongDigest}`);

    expect(provider.verifySignature(req)).toBe(false);
  });

  it('rejects missing signature header', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });

    const req = createMetaRequest(rawBody);

    expect(provider.verifySignature(req)).toBe(false);
  });

  it('rejects malformed signature header', () => {
    const provider = new MetaWebhookProvider({ secret: 'meta-secret' });
    const rawBody = JSON.stringify({ object: 'page', entry: [] });

    const req = createMetaRequest(rawBody, 'sha256=not-hex');

    expect(provider.verifySignature(req)).toBe(false);
  });
});
