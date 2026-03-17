import { createHmac } from 'crypto';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const withFreshEntryTimestamp = <T>(payload: T): T => {
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

export const signRawBody = (rawBody: string, secret: string) =>
  createHmac('sha256', secret).update(rawBody).digest('hex');

export const signMetaPayload = (
  payload: unknown,
  secret: string,
  options?: { preservePayloadTimestamp?: boolean }
) => {
  const normalizedPayload = options?.preservePayloadTimestamp ? payload : withFreshEntryTimestamp(payload);
  const raw = JSON.stringify(normalizedPayload);
  const signature = signRawBody(raw, secret);

  return {
    raw,
    signature,
    signatureHeader: `sha256=${signature}`,
  };
};

export const createMetaRequest = (rawBody: string, signatureHeader?: string | string[]) => ({
  body: Buffer.from(rawBody, 'utf8'),
  headers: signatureHeader === undefined ? {} : { 'x-hub-signature-256': signatureHeader },
  header: (name: string) => (name.toLowerCase() === 'x-hub-signature-256' ? signatureHeader : undefined),
});

export const createSignedMetaRequest = (
  payload: unknown,
  secret: string,
  options?: { preservePayloadTimestamp?: boolean; signatureOverride?: string | string[] }
) => {
  const { raw, signatureHeader } = signMetaPayload(payload, secret, {
    preservePayloadTimestamp: options?.preservePayloadTimestamp,
  });

  return createMetaRequest(raw, options?.signatureOverride ?? signatureHeader);
};
