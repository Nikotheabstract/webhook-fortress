# Stores

Stores back idempotency, failure tracking, and event-level locking.

## Store Interface

```ts
interface WebhookStore {
  hasProcessed(eventId: string): Promise<boolean>
  markProcessed(eventId: string): Promise<void>
  recordFailure(eventId: string, error?: unknown): Promise<void>
  acquireLock(eventId: string): Promise<boolean>
  releaseLock(eventId: string): Promise<void>
}
```

## Built-in Adapters

### Comparison

| Adapter | Durability | Distributed Locking | Local Dev Suitability | Production Suitability |
| --- | --- | --- | --- | --- |
| `memoryStore` | No | No (single process only) | Excellent | Limited |
| `postgresStore` | Yes | Yes (DB-backed lock rows/constraints) | Good | Strong |
| `redisStore` | Usually ephemeral/configurable | Yes (`SET NX PX`) | Good | Strong |

### `memoryStore()`

Best for local development and tests. State is process-local and non-durable.

### `postgresStore({ client })`

Best when you want durable processed/failure records and SQL-backed operational visibility.

### `redisStore({ client })`

Best for distributed workers that need low-latency locking and state checks.

## How To Choose

- Start with `memoryStore` for local iteration.
- Use `postgresStore` when durability and auditability matter most.
- Use `redisStore` when throughput and distributed lock performance are primary.
- In multi-worker production, avoid `memoryStore`.

## Custom Stores

You can implement a custom adapter by conforming to `WebhookStore`.

Requirements:

- lock acquisition must prevent concurrent execution for the same event ID
- `markProcessed` must be durable enough for your reliability requirements
- `recordFailure` must not mark the event as processed
