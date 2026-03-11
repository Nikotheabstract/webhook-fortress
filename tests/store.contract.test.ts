import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/stores/memoryStore.js';
import { postgresStore, type PostgresClient } from '../src/stores/postgresStore.js';
import { redisStore, type RedisClient } from '../src/stores/redisStore.js';
import type { WebhookStore } from '../src/stores/WebhookStore.js';

type StoreFactory = () => WebhookStore;

class MockPostgresClient implements PostgresClient {
  private readonly processedEvents = new Set<string>();
  private readonly lockTimestamps = new Map<string, number>();

  async query(sql: string, params: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT 1 FROM')) {
      const eventId = String(params[0] ?? '');
      if (this.processedEvents.has(eventId)) {
        return { rowCount: 1, rows: [{ ok: 1 }] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (normalized.includes('processed_at') && normalized.includes('ON CONFLICT (event_id) DO NOTHING')) {
      const eventId = String(params[0] ?? '');
      this.processedEvents.add(eventId);
      return { rowCount: 1, rows: [] };
    }

    if (normalized.includes('error_message') && normalized.includes('failed_at')) {
      return { rowCount: 1, rows: [] };
    }

    if (normalized.includes('ON CONFLICT (event_id) DO UPDATE') && normalized.includes('locked_at')) {
      const eventId = String(params[0] ?? '');
      const lockTtlSeconds = Number(params[1] ?? 60);
      const current = Date.now();
      const existingTimestamp = this.lockTimestamps.get(eventId);

      if (existingTimestamp === undefined) {
        this.lockTimestamps.set(eventId, current);
        return { rowCount: 1, rows: [{ event_id: eventId }] };
      }

      const ttlMs = lockTtlSeconds * 1000;
      if (current - existingTimestamp > ttlMs) {
        this.lockTimestamps.set(eventId, current);
        return { rowCount: 1, rows: [{ event_id: eventId }] };
      }

      return { rowCount: 0, rows: [] };
    }

    if (normalized.startsWith('DELETE FROM')) {
      const eventId = String(params[0] ?? '');
      this.lockTimestamps.delete(eventId);
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unhandled SQL in MockPostgresClient: ${normalized}`);
  }
}

class MockRedisClient implements RedisClient {
  private readonly values = new Map<string, string>();
  private readonly expiries = new Map<string, number>();

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    const options = this.parseSetOptions(args);
    this.expireIfNeeded(key);

    if (options.nx && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);

    if (typeof options.px === 'number') {
      this.expiries.set(key, Date.now() + options.px);
    } else {
      this.expiries.delete(key);
    }

    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.expireIfNeeded(key);
    return this.values.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    this.expiries.delete(key);
    return this.values.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    this.expireIfNeeded(key);
    return this.values.has(key) ? 1 : 0;
  }

  async eval(_script: string, ...args: unknown[]): Promise<unknown> {
    const parsed = this.parseEvalArgs(args);
    if (!parsed) {
      return 0;
    }

    const current = await this.get(parsed.key);
    if (current === parsed.token) {
      return this.del(parsed.key);
    }

    return 0;
  }

  private expireIfNeeded(key: string) {
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && Date.now() > expiry) {
      this.expiries.delete(key);
      this.values.delete(key);
    }
  }

  private parseSetOptions(args: unknown[]) {
    let nx = false;
    let px: number | undefined;

    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const objectOptions = first as { NX?: unknown; PX?: unknown };
      nx = Boolean(objectOptions.NX);
      if (typeof objectOptions.PX === 'number') {
        px = objectOptions.PX;
      }
      return { nx, px };
    }

    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (typeof token !== 'string') {
        continue;
      }

      const upper = token.toUpperCase();
      if (upper === 'NX') {
        nx = true;
      }

      if (upper === 'PX' && typeof args[index + 1] === 'number') {
        px = args[index + 1] as number;
      }
    }

    return { nx, px };
  }

  private parseEvalArgs(args: unknown[]): { key: string; token: string } | null {
    if (typeof args[0] === 'number') {
      const key = args[1];
      const token = args[2];
      if (typeof key === 'string' && typeof token === 'string') {
        return { key, token };
      }
      return null;
    }

    const objectArgs = args[0];
    if (objectArgs && typeof objectArgs === 'object') {
      const parsed = objectArgs as { keys?: unknown; arguments?: unknown };
      const key = Array.isArray(parsed.keys) ? parsed.keys[0] : undefined;
      const token = Array.isArray(parsed.arguments) ? parsed.arguments[0] : undefined;

      if (typeof key === 'string' && typeof token === 'string') {
        return { key, token };
      }
    }

    return null;
  }
}

const runStoreContractSuite = (label: string, createStore: StoreFactory) => {
  describe(`${label} store contract`, () => {
    it('prevents concurrent lock acquisition and allows acquisition after release', async () => {
      const store = createStore();

      expect(await store.acquireLock('evt.lock.1')).toBe(true);
      expect(await store.acquireLock('evt.lock.1')).toBe(false);

      await store.releaseLock('evt.lock.1');

      expect(await store.acquireLock('evt.lock.1')).toBe(true);
      await store.releaseLock('evt.lock.1');
    });

    it('reflects markProcessed and keeps failures independent from processed state', async () => {
      const store = createStore();

      expect(await store.hasProcessed('evt.process.1')).toBe(false);

      await store.recordFailure('evt.process.1', new Error('failed once'));
      expect(await store.hasProcessed('evt.process.1')).toBe(false);

      await store.markProcessed('evt.process.1');
      expect(await store.hasProcessed('evt.process.1')).toBe(true);
    });
  });
};

runStoreContractSuite('memory', () => memoryStore());
runStoreContractSuite('postgres', () => postgresStore({ client: new MockPostgresClient() }));
runStoreContractSuite('redis', () => redisStore({ client: new MockRedisClient(), keyPrefix: 'wf-test' }));
