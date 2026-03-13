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

export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

const TIMESTAMP_TOKEN_PATTERN = /\b(?:t|ts|timestamp)=(-?\d{10,16})\b/i;
const DIGITS_ONLY_PATTERN = /^-?\d{10,16}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeEpochSeconds = (value: number): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return null;
  }

  // Most webhook timestamps are unix seconds; 13+ digits are typically milliseconds.
  return Math.abs(rounded) >= 1e12 ? Math.floor(rounded / 1_000) : rounded;
};

const parseTimestampTokenSeconds = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (DIGITS_ONLY_PATTERN.test(trimmed)) {
    return normalizeEpochSeconds(Number(trimmed));
  }

  const tokenMatch = trimmed.match(TIMESTAMP_TOKEN_PATTERN);
  if (!tokenMatch?.[1]) {
    return null;
  }

  return normalizeEpochSeconds(Number(tokenMatch[1]));
};

const extractTimestampFromCandidates = (candidates: string[]): number | null => {
  for (const candidate of candidates) {
    const parsed = parseTimestampTokenSeconds(candidate);
    if (typeof parsed === 'number') {
      return parsed;
    }
  }

  return null;
};

const extractTimestampFromPayload = (rawBody: Buffer | undefined): number | null => {
  if (!rawBody) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const rootTimestampCandidates = [parsed.timestamp, parsed.time];
  for (const candidate of rootTimestampCandidates) {
    if (typeof candidate === 'number') {
      const normalized = normalizeEpochSeconds(candidate);
      if (typeof normalized === 'number') {
        return normalized;
      }
    }
  }

  const entries = Array.isArray(parsed.entry) ? parsed.entry : [];
  for (const entryCandidate of entries) {
    if (!isRecord(entryCandidate)) {
      continue;
    }

    if (typeof entryCandidate.time === 'number') {
      const normalized = normalizeEpochSeconds(entryCandidate.time);
      if (typeof normalized === 'number') {
        return normalized;
      }
    }

    const messagingEvents = Array.isArray(entryCandidate.messaging) ? entryCandidate.messaging : [];
    for (const messagingCandidate of messagingEvents) {
      if (!isRecord(messagingCandidate)) {
        continue;
      }

      if (typeof messagingCandidate.timestamp === 'number') {
        const normalized = normalizeEpochSeconds(messagingCandidate.timestamp);
        if (typeof normalized === 'number') {
          return normalized;
        }
      }
    }

    const changes = Array.isArray(entryCandidate.changes) ? entryCandidate.changes : [];
    for (const changeCandidate of changes) {
      if (!isRecord(changeCandidate) || !isRecord(changeCandidate.value)) {
        continue;
      }

      const maybeChangeTimestamp = changeCandidate.value.timestamp;
      if (typeof maybeChangeTimestamp === 'number') {
        const normalized = normalizeEpochSeconds(maybeChangeTimestamp);
        if (typeof normalized === 'number') {
          return normalized;
        }
      }

      if (typeof maybeChangeTimestamp === 'string') {
        const normalized = parseTimestampTokenSeconds(maybeChangeTimestamp);
        if (typeof normalized === 'number') {
          return normalized;
        }
      }
    }
  }

  return null;
};

export type RequestFreshnessResult =
  | {
      ok: true;
      reason: 'fresh' | 'timestamp_unavailable';
      requestTimestampSeconds?: number;
      ageSeconds?: number;
      toleranceSeconds: number;
    }
  | {
      ok: false;
      reason: 'timestamp_outside_tolerance';
      requestTimestampSeconds: number;
      ageSeconds: number;
      toleranceSeconds: number;
    };

export type RequestFreshnessInput = {
  signatureHeader?: string | string[];
  timestampHeader?: string | string[];
  rawBody?: Buffer;
  nowSeconds?: number;
  toleranceSeconds?: number;
};

export const resolveWebhookToleranceSeconds = (
  value: string | number | undefined = process.env.WEBHOOK_TOLERANCE_SECONDS
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  }

  return Math.floor(parsed);
};

const resolveRequestTimestampSeconds = (input: RequestFreshnessInput): number | null => {
  const timestampHeaderCandidates = normalizeSignatureCandidates(input.timestampHeader);
  const fromTimestampHeader = extractTimestampFromCandidates(timestampHeaderCandidates);
  if (typeof fromTimestampHeader === 'number') {
    return fromTimestampHeader;
  }

  const signatureHeaderCandidates = normalizeSignatureCandidates(input.signatureHeader);
  const fromSignatureHeader = extractTimestampFromCandidates(signatureHeaderCandidates);
  if (typeof fromSignatureHeader === 'number') {
    return fromSignatureHeader;
  }

  return extractTimestampFromPayload(input.rawBody);
};

export const verifyRequestFreshness = (input: RequestFreshnessInput): RequestFreshnessResult => {
  const toleranceSeconds = Math.max(1, Math.floor(input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS));
  const requestTimestampSeconds = resolveRequestTimestampSeconds(input);
  if (typeof requestTimestampSeconds !== 'number') {
    return { ok: true, reason: 'timestamp_unavailable', toleranceSeconds };
  }

  const nowSeconds = Math.floor(input.nowSeconds ?? Date.now() / 1_000);
  const ageSeconds = nowSeconds - requestTimestampSeconds;

  // Security boundary: reject stale or far-future requests to limit replay windows.
  if (Math.abs(ageSeconds) > toleranceSeconds) {
    return {
      ok: false,
      reason: 'timestamp_outside_tolerance',
      requestTimestampSeconds,
      ageSeconds,
      toleranceSeconds,
    };
  }

  return {
    ok: true,
    reason: 'fresh',
    requestTimestampSeconds,
    ageSeconds,
    toleranceSeconds,
  };
};

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
