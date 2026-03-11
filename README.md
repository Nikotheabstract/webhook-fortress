# Webhook Fortress

Webhook providers are typically **at-least-once** systems. The same event can be delivered multiple times, retried after timeouts, or received concurrently by multiple workers. Without guardrails, this causes repeated side effects.

Webhook Fortress is a framework-agnostic webhook ingestion engine for reliable event handling. It provides a focused runtime for signature verification, normalized events, idempotent processing, and pluggable persistence.

```text
Webhook Request
  -> Signature Verification
  -> Provider Parsing
  -> Idempotency Processor
  -> Handler
```

## Features

- Provider adapters (Meta implemented)
- Signature verification
- Normalized webhook events
- Idempotent execution
- Concurrency-safe processing
- Pluggable storage adapters
- Failure tracking

## Quick Start

Example with default in-memory store:

```ts
import { createWebhookFortress } from "webhook-fortress"

const webhooks = createWebhookFortress({
  provider: "meta",
  secret: process.env.META_APP_SECRET,
  handler: async (event) => {
    console.log(event)
  }
})

app.post("/webhooks/meta", webhooks.handleRequest)
```

Example with explicit Postgres-backed idempotency state:

```ts
const webhooks = createWebhookFortress({
  provider: "meta",
  secret: process.env.META_APP_SECRET,
  store: postgresStore({ client }),
  handler: async (event) => {
    console.log(event)
  }
})
```

## Who This Is For

- Developers building webhook consumers.
- Teams that need idempotent processing guarantees.
- Apps running multiple workers/processes.

## How It Works

Each incoming request is processed through these steps:

1. Verify provider signature against the raw body.
2. Parse and normalize payload into `WebhookEvent`.
3. Run idempotency processor (`hasProcessed` + lock + re-check).
4. Execute handler once and mark processed (or record failure).

## Where To Start Reading

- [Architecture](./docs/architecture.md)
- [Idempotency](./docs/idempotency.md)
- [Stores](./docs/stores.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)

## Installation (Placeholder)

```bash
npm install webhook-fortress
```

Note: this module currently lives under `extractions/webhook-fortress` in this repository.

## Examples

See [examples/meta-messenger-handler.ts](./examples/meta-messenger-handler.ts).

This example demonstrates Meta webhook setup, signature validation, event normalization, and handler invocation.

## Stores

- `memoryStore()` for local development and tests.
- `postgresStore({ client })` for durable production persistence.
- `redisStore({ client })` for distributed locking and low-latency state checks.

See [docs/stores.md](./docs/stores.md) for adapter details and selection guidance.

## License

TBD.
