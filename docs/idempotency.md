# Idempotency

Webhook delivery is commonly at-least-once, so duplicates are expected. Idempotency ensures duplicate deliveries do not produce duplicate side effects.

## What Can Go Wrong Without Idempotency

- Duplicate database writes.
- Repeated notifications/messages.
- Repeated billing-like side effects.

## Core Algorithm

For `process(eventId, handler)`:

1. Check `hasProcessed(eventId)`.
2. Acquire lock for `eventId`.
3. Start lock renewal heartbeat (when store supports it).
4. Re-check `hasProcessed(eventId)` after lock.
5. Execute handler.
6. Mark processed with `markProcessed(eventId)`.
7. Stop renewal heartbeat and release lock.

## Lock Renewal

For TTL-based lock stores (Redis/Postgres adapters), Webhook Fortress renews held locks while the handler is running.

- Renewal interval defaults to approximately half of lock TTL.
- Renewal failures do not interrupt handler execution.
- Renewal/release issues can be surfaced through warning observability hooks.

## Lock Ownership Tokens (Postgres)

The Postgres adapter stores lock ownership per event using `lock_token`.

- lock acquisition writes a unique token with each lock claim
- `renewLock` uses `WHERE event_id = $1 AND lock_token = $2`
- `releaseLock` uses `WHERE event_id = $1 AND lock_token = $2`

This prevents stale workers from renewing or releasing locks owned by other workers after TTL expiry/reacquisition.

If handler execution fails:

- Call `recordFailure(eventId, error)`.
- Do not mark event as processed.
- Release lock.
- Re-throw the original handler error.

## Completion vs Failure vs Retryability

- **Successful completion**: handler finishes and event is marked processed.
- **Failure recording**: handler fails and failure metadata is recorded.
- **Retryability**: failed events remain unprocessed, so they can be retried safely.

## At-Least-Once And Crash Window

Webhook Fortress is an at-least-once processing engine.  
A crash between handler side effects and `markProcessed(eventId)` can replay the event on retry.

Practical implication:

- downstream side effects must be idempotent by `event.id`
- durable unique constraints/upserts are strongly recommended
- retries are expected and are part of normal operation

## Event ID Scope Matters

Idempotency is enforced **per event ID**. Stable event ID generation is therefore critical. If event IDs are non-deterministic, duplicate deliveries cannot be deduplicated correctly.

## Guarantees

- Successful event IDs are processed once.
- Concurrent duplicate deliveries are serialized by lock.
- Failed events remain retryable.
