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
3. Re-check `hasProcessed(eventId)` after lock.
4. Execute handler.
5. Mark processed with `markProcessed(eventId)`.
6. Release lock.

If handler execution fails:

- Call `recordFailure(eventId, error)`.
- Do not mark event as processed.
- Release lock.
- Re-throw the original handler error.

## Completion vs Failure vs Retryability

- **Successful completion**: handler finishes and event is marked processed.
- **Failure recording**: handler fails and failure metadata is recorded.
- **Retryability**: failed events remain unprocessed, so they can be retried safely.

## Event ID Scope Matters

Idempotency is enforced **per event ID**. Stable event ID generation is therefore critical. If event IDs are non-deterministic, duplicate deliveries cannot be deduplicated correctly.

## Guarantees

- Successful event IDs are processed once.
- Concurrent duplicate deliveries are serialized by lock.
- Failed events remain retryable.
