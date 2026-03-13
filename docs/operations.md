# Operations

This guide covers running Webhook Fortress in production-like environments.

## Store Selection For Production

- Prefer `postgresStore` when you need durable processed/failure records.
- Prefer `redisStore` when you need low-latency distributed locking across workers.
- Do not use `memoryStore` for multi-worker production.

## Locking Behavior And Contention

Webhook Fortress acquires a lock per event ID before handler execution.
For TTL-backed stores, it also renews locks while the handler is running.

Operational implications:

- only one worker executes a given event ID at a time
- concurrent duplicates wait/retry lock acquisition
- lock contention is a signal of duplicate deliveries or hot event IDs
- lock renewal/release issues may surface via lock-contention hooks

## Failure Recording And Retry Behavior

On handler failure:

- event is not marked as processed
- failure is recorded via `recordFailure(eventId, error)`
- original error is propagated

This keeps failed events retryable.

## Replay Protection

Meta provider freshness checks reject requests when timestamp age is outside tolerance or when no timestamp signal is present.

- Configure tolerance via `WEBHOOK_TOLERANCE_SECONDS` (default `300`).
- Rejected requests return `401` before event processing.
- If your provider model differs, implement provider-specific `verifyFreshness(req)`.

## Monitoring Suggestions

Track at minimum:

- count of processed events
- count of failed events
- repeated failures by `eventId`
- lock acquisition failures/timeouts
- handler latency percentiles

Useful alerts:

- failure rate spike
- repeated failures on same event ID
- sustained lock contention increase

## Optional Observability Hooks

You can attach lightweight lifecycle hooks when creating the engine:

```ts
createWebhookFortress({
  provider: "meta",
  providers: {
    meta: new MetaWebhookProvider({ secret: process.env.META_APP_SECRET })
  },
  onEventReceived: (event) => metrics.increment("wf.event.received", { provider: event.provider }),
  onDuplicate: (eventId) => metrics.increment("wf.event.duplicate", { eventId }),
  onProcessed: (event) => metrics.increment("wf.event.processed", { type: event.type }),
  onFailed: (event, error) => logger.error({ eventId: event.id, error }, "webhook processing failed"),
  onLockContention: (eventId) => metrics.increment("wf.lock.contention", { eventId }),
  onWarning: ({ type, eventId, error }) => logger.warn({ type, eventId, error }, "webhook lock warning")
})
```

Hook behavior:

- Hooks are optional.
- Hook errors are ignored by the engine.
- Hooks are for telemetry/diagnostics only; they do not alter control flow.
- `onWarning` can emit:
  - `lock-contention`
  - `lock-renewal-failed`
  - `lock-release-failed`
- `onLockContention` is preserved for backward compatibility.

## Retry And Crash Semantics

Webhook Fortress guarantees orchestration-level idempotency, but runtime failures still follow an at-least-once model:

- handler errors record failure state and keep event retryable
- crash between handler side effects and processed-state commit can replay event
- lock release failures are non-fatal and do not override handler result

Operational recommendation:

- design domain side effects around `event.id` idempotency keys
- keep durable uniqueness constraints on side-effect writes
- monitor repeated failures per `eventId`

## Multi-Worker Deployment Watchpoints

- Ensure all workers share the same durable/distributed store.
- Confirm clock skew is controlled when TTL-based locking is used.
- Validate that retries re-use stable event IDs.
- For Postgres locks, ensure schema includes `lock_token` ownership column.

## Common Operational Pitfalls

- Using `memoryStore` in distributed runtime.
- Non-deterministic event ID generation.
- Swallowing handler errors instead of surfacing failures.
- Missing dashboards for lock contention and repeated failures.
