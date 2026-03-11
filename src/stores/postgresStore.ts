import type { WebhookStore } from './WebhookStore.js';

type QueryResult<Row = unknown> = {
  rows?: Row[];
  rowCount?: number | null;
};

export interface PostgresClient {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
}

export type PostgresStoreConfig = {
  client: PostgresClient;
  processedTable?: string;
  locksTable?: string;
  failuresTable?: string;
  lockTtlSeconds?: number;
};

const DEFAULT_PROCESSED_TABLE = 'webhook_fortress_processed_events';
const DEFAULT_LOCKS_TABLE = 'webhook_fortress_event_locks';
const DEFAULT_FAILURES_TABLE = 'webhook_fortress_failures';
const DEFAULT_LOCK_TTL_SECONDS = 60;

const validateIdentifierPart = (part: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part);

const normalizeTableIdentifier = (value: string, label: string): string => {
  const parts = value.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !validateIdentifierPart(part))) {
    throw new Error(`Invalid ${label} identifier: ${value}`);
  }
  return parts.join('.');
};

const hasRows = (result: QueryResult): boolean => {
  if (typeof result.rowCount === 'number') {
    return result.rowCount > 0;
  }
  return Array.isArray(result.rows) && result.rows.length > 0;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export class PostgresWebhookStore implements WebhookStore {
  private readonly client: PostgresClient;
  private readonly processedTable: string;
  private readonly locksTable: string;
  private readonly failuresTable: string;
  private readonly lockTtlSeconds: number;

  constructor(config: PostgresStoreConfig) {
    this.client = config.client;
    this.processedTable = normalizeTableIdentifier(
      config.processedTable ?? DEFAULT_PROCESSED_TABLE,
      'processedTable'
    );
    this.locksTable = normalizeTableIdentifier(config.locksTable ?? DEFAULT_LOCKS_TABLE, 'locksTable');
    this.failuresTable = normalizeTableIdentifier(
      config.failuresTable ?? DEFAULT_FAILURES_TABLE,
      'failuresTable'
    );
    this.lockTtlSeconds = Math.max(1, config.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS);
  }

  async hasProcessed(eventId: string): Promise<boolean> {
    const result = await this.client.query(
      `SELECT 1 FROM ${this.processedTable} WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    return hasRows(result);
  }

  async markProcessed(eventId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO ${this.processedTable} (event_id, processed_at)
       VALUES ($1, NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId]
    );
  }

  async recordFailure(eventId: string, error?: unknown): Promise<void> {
    const errorMessage = toErrorMessage(error);
    await this.client.query(
      `INSERT INTO ${this.failuresTable} (event_id, error_message, failed_at)
       VALUES ($1, $2, NOW())`,
      [eventId, errorMessage]
    );
  }

  async acquireLock(eventId: string): Promise<boolean> {
    const result = await this.client.query(
      `INSERT INTO ${this.locksTable} (event_id, locked_at)
       VALUES ($1, NOW())
       ON CONFLICT (event_id) DO UPDATE
       SET locked_at = NOW()
       WHERE ${this.locksTable}.locked_at < NOW() - ($2 * INTERVAL '1 second')
       RETURNING event_id`,
      [eventId, this.lockTtlSeconds]
    );

    return hasRows(result);
  }

  async releaseLock(eventId: string): Promise<void> {
    await this.client.query(`DELETE FROM ${this.locksTable} WHERE event_id = $1`, [eventId]);
  }
}

export const postgresStore = (config: PostgresStoreConfig) => new PostgresWebhookStore(config);
