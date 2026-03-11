# Operations

This guide covers running Webhook Fortress in production-like environments.

## Store Selection For Production

- Prefer `postgresStore` when you need durable processed/failure records.
- Prefer `redisStore` when you need low-latency distributed locking across workers.
- Do not use `memoryStore` for multi-worker production.

## Locking Behavior And Contention

Webhook Fortress acquires a lock per event ID before handler execution.

Operational implications:

- only one worker executes a given event ID at a time
- concurrent duplicates wait/retry lock acquisition
- lock contention is a signal of duplicate deliveries or hot event IDs

## Failure Recording And Retry Behavior

On handler failure:

- event is not marked as processed
- failure is recorded via `recordFailure(eventId, error)`
- original error is propagated

This keeps failed events retryable.

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

## Multi-Worker Deployment Watchpoints

- Ensure all workers share the same durable/distributed store.
- Confirm clock skew is controlled when TTL-based locking is used.
- Validate that retries re-use stable event IDs.

## Common Operational Pitfalls

- Using `memoryStore` in distributed runtime.
- Non-deterministic event ID generation.
- Swallowing handler errors instead of surfacing failures.
- Missing dashboards for lock contention and repeated failures.
