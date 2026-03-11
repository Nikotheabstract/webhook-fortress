import { randomUUID } from 'crypto';
import type { WebhookStore } from './WebhookStore.js';

export interface RedisClient {
  set: (key: string, value: string, ...args: unknown[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
  exists?: (key: string) => Promise<number>;
  eval?: (script: string, ...args: unknown[]) => Promise<unknown>;
}

export type RedisStoreConfig = {
  client: RedisClient;
  keyPrefix?: string;
  lockTtlMs?: number;
  processedTtlMs?: number;
  failureTtlMs?: number;
};

const DEFAULT_PREFIX = 'webhook-fortress';
const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_FAILURE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const isRedisOk = (value: unknown) => {
  if (typeof value === 'string') {
    return value.toUpperCase() === 'OK';
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  return false;
};

const serializeFailure = (error: unknown) => {
  const failedAt = new Date().toISOString();

  if (error instanceof Error) {
    return JSON.stringify({
      failedAt,
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }

  if (typeof error === 'string') {
    return JSON.stringify({
      failedAt,
      message: error,
    });
  }

  try {
    return JSON.stringify({
      failedAt,
      error,
    });
  } catch {
    return JSON.stringify({
      failedAt,
      error: String(error),
    });
  }
};

const releaseScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class RedisWebhookStore implements WebhookStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;
  private readonly lockTtlMs: number;
  private readonly processedTtlMs?: number;
  private readonly failureTtlMs: number;
  private readonly ownedLockTokens = new Map<string, string>();

  constructor(config: RedisStoreConfig) {
    this.client = config.client;
    this.keyPrefix = (config.keyPrefix ?? DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
    this.lockTtlMs = Math.max(1_000, config.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);
    this.processedTtlMs =
      typeof config.processedTtlMs === 'number' && config.processedTtlMs > 0
        ? config.processedTtlMs
        : undefined;
    this.failureTtlMs = Math.max(1_000, config.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS);
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    const key = this.getProcessedKey(eventId);

    if (typeof this.client.exists === 'function') {
      const count = await this.client.exists(key);
      return count > 0;
    }

    const value = await this.client.get(key);
    return value !== null;
  }

  async markProcessed(eventId: string): Promise<void> {
    const key = this.getProcessedKey(eventId);

    if (this.processedTtlMs) {
      try {
        await this.client.set(key, '1', { PX: this.processedTtlMs });
        return;
      } catch {
        await this.client.set(key, '1', 'PX', this.processedTtlMs);
        return;
      }
    }

    await this.client.set(key, '1');
  }

  async recordFailure(eventId: string, error?: unknown): Promise<void> {
    const key = this.getFailureKey(eventId);
    const value = serializeFailure(error);

    try {
      await this.client.set(key, value, { PX: this.failureTtlMs });
    } catch {
      await this.client.set(key, value, 'PX', this.failureTtlMs);
    }
  }

  async acquireLock(eventId: string): Promise<boolean> {
    const key = this.getLockKey(eventId);
    const token = randomUUID();

    const acquired = await this.trySetLock(key, token);
    if (!acquired) {
      return false;
    }

    this.ownedLockTokens.set(eventId, token);
    return true;
  }

  async releaseLock(eventId: string): Promise<void> {
    const key = this.getLockKey(eventId);
    const token = this.ownedLockTokens.get(eventId);

    if (!token) {
      return;
    }

    try {
      if (typeof this.client.eval === 'function') {
        try {
          await this.client.eval(releaseScript, 1, key, token);
          return;
        } catch {
          await this.client.eval(releaseScript, {
            keys: [key],
            arguments: [token],
          });
          return;
        }
      }

      const current = await this.client.get(key);
      if (current === token) {
        await this.client.del(key);
      }
    } finally {
      this.ownedLockTokens.delete(eventId);
    }
  }

  private getProcessedKey(eventId: string): string {
    return `${this.keyPrefix}:processed:${eventId}`;
  }

  private getLockKey(eventId: string): string {
    return `${this.keyPrefix}:lock:${eventId}`;
  }

  private getFailureKey(eventId: string): string {
    return `${this.keyPrefix}:failures:${eventId}`;
  }

  private async trySetLock(key: string, token: string): Promise<boolean> {
    try {
      const result = await this.client.set(key, token, { NX: true, PX: this.lockTtlMs });
      return isRedisOk(result);
    } catch {
      const result = await this.client.set(key, token, 'PX', this.lockTtlMs, 'NX');
      return isRedisOk(result);
    }
  }
}

export const redisStore = (config: RedisStoreConfig) => new RedisWebhookStore(config);
