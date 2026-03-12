import { describe, expect, it } from 'vitest';
import { postgresStore, type PostgresClient } from '../../src/stores/postgresStore.js';

type LockState = {
  token: string;
  lockedAt: number;
};

class LockOwnershipMockPostgresClient implements PostgresClient {
  private readonly locks = new Map<string, LockState>();

  async query(sql: string, params: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.includes('ON CONFLICT (event_id) DO UPDATE') && normalized.includes('lock_token')) {
      const eventId = String(params[0] ?? '');
      const token = String(params[1] ?? '');
      const lockTtlSeconds = Number(params[2] ?? 60);
      const now = Date.now();
      const existing = this.locks.get(eventId);

      if (!existing) {
        this.locks.set(eventId, { token, lockedAt: now });
        return { rowCount: 1, rows: [{ event_id: eventId }] };
      }

      if (now - existing.lockedAt > lockTtlSeconds * 1_000) {
        this.locks.set(eventId, { token, lockedAt: now });
        return { rowCount: 1, rows: [{ event_id: eventId }] };
      }

      return { rowCount: 0, rows: [] };
    }

    if (
      normalized.startsWith('UPDATE') &&
      normalized.includes('SET locked_at = NOW()') &&
      normalized.includes('lock_token = $2')
    ) {
      const eventId = String(params[0] ?? '');
      const token = String(params[1] ?? '');
      const existing = this.locks.get(eventId);

      if (!existing || existing.token !== token) {
        return { rowCount: 0, rows: [] };
      }

      this.locks.set(eventId, { token, lockedAt: Date.now() });
      return { rowCount: 1, rows: [{ event_id: eventId }] };
    }

    if (normalized.startsWith('DELETE FROM') && normalized.includes('lock_token = $2')) {
      const eventId = String(params[0] ?? '');
      const token = String(params[1] ?? '');
      const existing = this.locks.get(eventId);

      if (!existing || existing.token !== token) {
        return { rowCount: 0, rows: [] };
      }

      this.locks.delete(eventId);
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unhandled SQL in LockOwnershipMockPostgresClient: ${normalized}`);
  }

  forceExpire(eventId: string) {
    const existing = this.locks.get(eventId);
    if (!existing) {
      return;
    }
    this.locks.set(eventId, { ...existing, lockedAt: 0 });
  }

  hasLock(eventId: string): boolean {
    return this.locks.has(eventId);
  }
}

describe('Postgres lock ownership', () => {
  it('prevents stale worker from releasing another worker lock', async () => {
    const client = new LockOwnershipMockPostgresClient();
    const workerA = postgresStore({ client, lockTtlSeconds: 1 });
    const workerB = postgresStore({ client, lockTtlSeconds: 1 });

    expect(await workerA.acquireLock('evt.pg.release')).toBe(true);
    client.forceExpire('evt.pg.release');
    expect(await workerB.acquireLock('evt.pg.release')).toBe(true);

    await expect(workerA.releaseLock('evt.pg.release')).rejects.toThrow(
      'Lost lock ownership for event evt.pg.release'
    );
    expect(await workerB.renewLock('evt.pg.release')).toBe(true);
  });

  it('prevents stale worker from renewing another worker lock', async () => {
    const client = new LockOwnershipMockPostgresClient();
    const workerA = postgresStore({ client, lockTtlSeconds: 1 });
    const workerB = postgresStore({ client, lockTtlSeconds: 1 });

    expect(await workerA.acquireLock('evt.pg.renew')).toBe(true);
    client.forceExpire('evt.pg.renew');
    expect(await workerB.acquireLock('evt.pg.renew')).toBe(true);

    expect(await workerA.renewLock('evt.pg.renew')).toBe(false);
    expect(await workerB.renewLock('evt.pg.renew')).toBe(true);
  });

  it('allows correct worker to release its own lock', async () => {
    const client = new LockOwnershipMockPostgresClient();
    const workerA = postgresStore({ client, lockTtlSeconds: 1 });
    const workerB = postgresStore({ client, lockTtlSeconds: 1 });

    expect(await workerA.acquireLock('evt.pg.success')).toBe(true);
    await expect(workerA.releaseLock('evt.pg.success')).resolves.toBeUndefined();
    expect(client.hasLock('evt.pg.success')).toBe(false);
    expect(await workerB.acquireLock('evt.pg.success')).toBe(true);
  });
});
