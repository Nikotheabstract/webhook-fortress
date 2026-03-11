import crypto from 'crypto';

const normalizeSignatureCandidates = (signatureHeader: string | string[] | undefined): string[] => {
  if (!signatureHeader) {
    return [];
  }
  if (Array.isArray(signatureHeader)) {
    return signatureHeader.flatMap((value) => value.split(',')).map((value) => value.trim());
  }
  return signatureHeader.split(',').map((value) => value.trim());
};

const extractSha256Digest = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const match = candidate.match(/sha256=([a-fA-F0-9]{64})/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
};

export type WebhookSecretCandidate = { label: 'instagram' | 'meta'; value: string };

export const verifyWebhookSignature = (
  signatureHeader: string | string[] | undefined,
  rawBody: Buffer,
  secrets: WebhookSecretCandidate[]
) => {
  const rawCandidates = normalizeSignatureCandidates(signatureHeader);
  const receivedHex = extractSha256Digest(rawCandidates);
  if (!receivedHex) {
    return { ok: false, reason: 'missing_signature' as const, receivedHex: '' };
  }

  const expectedByLabel: Record<string, string> = {};
  let matchedLabel: WebhookSecretCandidate['label'] | null = null;
  let hasSecret = false;

  for (const secret of secrets) {
    const trimmed = secret.value.trim();
    if (!trimmed) {
      continue;
    }
    hasSecret = true;
    // Use the exact raw Buffer instance supplied by express.raw().
    const expectedHex = crypto.createHmac('sha256', trimmed).update(rawBody).digest('hex');
    expectedByLabel[secret.label] = expectedHex;

    const expectedBuffer = Buffer.from(expectedHex, 'hex');
    const receivedBuffer = Buffer.from(receivedHex, 'hex');
    if (expectedBuffer.length !== receivedBuffer.length) {
      continue;
    }
    if (crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      matchedLabel = secret.label;
      break;
    }
  }

  if (matchedLabel) {
    return { ok: true, matchedLabel, receivedHex, expectedByLabel };
  }

  if (!hasSecret) {
    return { ok: false, reason: 'missing_app_secret' as const, receivedHex, expectedByLabel };
  }

  return { ok: false, reason: 'signature_mismatch' as const, receivedHex, expectedByLabel };
};

