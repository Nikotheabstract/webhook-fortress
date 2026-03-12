import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  verifyRequestFreshness,
} from '../src/providers/meta/metaSignature.js';

const toBuffer = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

describe('request freshness verification', () => {
  it('rejects stale webhook timestamps from payload', () => {
    const nowSeconds = 1_700_000_000;
    const staleTimestamp = nowSeconds - (DEFAULT_WEBHOOK_TOLERANCE_SECONDS + 10);

    const result = verifyRequestFreshness({
      rawBody: toBuffer({
        object: 'page',
        entry: [{ id: 'page-1', time: staleTimestamp, messaging: [{ message: { mid: 'mid.stale.1' } }] }],
      }),
      nowSeconds,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected stale request to be rejected');
    }

    expect(result.reason).toBe('timestamp_outside_tolerance');
    expect(result.requestTimestampSeconds).toBe(staleTimestamp);
  });

  it('accepts fresh webhook timestamps from payload', () => {
    const nowSeconds = 1_700_000_000;
    const freshTimestamp = nowSeconds - 30;

    const result = verifyRequestFreshness({
      rawBody: toBuffer({
        object: 'page',
        entry: [{ id: 'page-1', time: freshTimestamp, messaging: [{ message: { mid: 'mid.fresh.1' } }] }],
      }),
      nowSeconds,
    });

    expect(result).toMatchObject({
      ok: true,
      reason: 'fresh',
      requestTimestampSeconds: freshTimestamp,
    });
  });

  it('prefers explicit timestamp header when available', () => {
    const nowSeconds = 1_700_000_000;

    const result = verifyRequestFreshness({
      timestampHeader: String(nowSeconds - 5),
      rawBody: toBuffer({
        object: 'page',
        entry: [{ id: 'page-1', time: 1, messaging: [{ message: { mid: 'mid.header.1' } }] }],
      }),
      nowSeconds,
    });

    expect(result).toMatchObject({
      ok: true,
      reason: 'fresh',
      requestTimestampSeconds: nowSeconds - 5,
    });
  });

  it('allows requests when timestamp is unavailable', () => {
    const result = verifyRequestFreshness({
      rawBody: toBuffer({
        object: 'page',
        entry: [{ id: 'page-1', messaging: [{ message: { mid: 'mid.no.timestamp' } }] }],
      }),
      nowSeconds: 1_700_000_000,
    });

    expect(result).toEqual({
      ok: true,
      reason: 'timestamp_unavailable',
      toleranceSeconds: DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
    });
  });
});
