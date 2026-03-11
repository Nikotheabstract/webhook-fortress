# Architecture

Webhook Fortress is a modular webhook ingestion engine. It separates transport concerns (signature + parsing) from execution concerns (idempotency + locking) and persistence concerns (store adapters).

## Separation Of Concerns

- **Provider**
  - Verifies signature using raw request body.
  - Parses source payload into normalized `WebhookEvent`.
  - Generates deterministic event IDs.
- **Event Processor**
  - Enforces once-only completion semantics for an event ID.
  - Coordinates dedupe checks, lock acquisition, and failure recording.
- **Store**
  - Persists processed state and failure metadata.
  - Provides lock primitives for concurrency control.
- **Handler**
  - Executes domain/business side effects.
  - Lives outside the library.

## Design Principles

- Reliability first.
- Deterministic event identity.
- Domain logic stays outside the library.
- Pluggable persistence.
- Minimal public API.

## Request Lifecycle

```text
Webhook Request
-> Provider
-> EventProcessor
-> Store
-> Handler
```

Detailed flow:

1. HTTP request arrives with raw body.
2. Provider verifies signature.
3. Provider parses payload into `WebhookEvent`.
4. EventProcessor checks `hasProcessed(eventId)`.
5. EventProcessor acquires lock for `eventId`.
6. EventProcessor re-checks `hasProcessed(eventId)` after lock.
7. Handler runs once.
8. On success: `markProcessed(eventId)`.
9. On failure: `recordFailure(eventId, error)` and propagate error.
10. Lock is released.

## Extensibility Points

- Add providers under `src/providers/<provider>/`.
- Add store adapters by implementing `WebhookStore`.
- Keep handler logic in the host application.
