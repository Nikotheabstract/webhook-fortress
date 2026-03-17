# Webhook Fortress

Webhook Fortress is a webhook ingestion engine focused on reliable and idempotent event processing.

It was extracted from a larger private application to isolate reusable webhook reliability concerns into a standalone library.

## Why this project exists

Webhook providers are typically **at-least-once** systems. The same event can be delivered multiple times due to retries, timeouts, or concurrent delivery paths, which can easily trigger duplicate side effects if not handled correctly.

Webhook Fortress is an open-source reference implementation of reliable ingestion patterns that demonstrates:

- idempotent event processing
- concurrency safety
- failure tracking

```text
Webhook request
→ signature verification
→ provider parsing
→ idempotency processor
→ handler
```

## Project Status

Webhook Fortress is a **0.x reliability library and reference implementation** for webhook ingestion patterns.

It is production-oriented in architecture and testing approach, while still evolving as new providers, store adapters, and operational patterns are added.

## Design Goals

- Deterministic event processing: stable event identity prevents ambiguous reprocessing decisions.
- Idempotent execution: retries and duplicates do not produce repeated side effects.
- Provider abstraction: signature/parsing differences stay isolated from domain logic.
- Pluggable storage adapters: teams can choose memory, Postgres, or Redis based on runtime needs.
- Minimal operational complexity: a narrow API and explicit lifecycle keep integration simple.
- Strong test coverage: behavioral guarantees are protected as the project evolves.

## Architecture Overview

Webhook Fortress separates transport concerns, execution guarantees, and persistence concerns.  
Providers handle signature verification and payload normalization.  
The event processor enforces dedupe + lock semantics before invoking the handler.  
Store adapters persist processed/failure state and lock primitives, while business side effects remain in the host application's handler code.

## Features

- Provider adapters (Meta implemented)
- Signature verification
- Normalized webhook events
- Idempotent execution
- Concurrency-safe processing
- Lock renewal for long-running handlers
- Pluggable storage adapters
- Failure tracking

## Quick Start

Example with default in-memory store:

```ts
import express from "express"
import { createWebhookFortress, MetaWebhookProvider } from "webhook-fortress"

const app = express()

const webhooks = createWebhookFortress({
  provider: "meta",
  providers: {
    meta: new MetaWebhookProvider({
      secret: process.env.META_APP_SECRET
    })
  },
  handler: async (event) => {
    console.log(event)
  }
})

app.post(
  "/webhooks/meta",
  express.raw({ type: "application/json" }),
  webhooks.handleRequest
)
```

> [!WARNING]
> Signature verification depends on the exact raw request body bytes.  
> For Express integrations, use `express.raw({ type: "application/json" })` on the webhook route.

## Security Model

Webhook Fortress applies three security boundaries before handler execution:

- **HMAC verification**: Meta signatures are validated with HMAC-SHA256 over raw bytes and compared using `timingSafeEqual`.
- **Contract-first payload validation**: Meta notification payloads are parsed with Zod schemas before normalization.
- **Replay-window enforcement**: Meta requests are rejected with `401` when the request timestamp is stale, too far in the future, or missing.

Freshness tolerance is controlled by `WEBHOOK_TOLERANCE_SECONDS` (default: `300` seconds).

Example with explicit Postgres-backed idempotency state:

```ts
import express from "express"
import { Pool } from "pg"
import { createWebhookFortress, MetaWebhookProvider, postgresStore } from "webhook-fortress"

const app = express()
const client = new Pool({ connectionString: process.env.DATABASE_URL })

const webhooks = createWebhookFortress({
  provider: "meta",
  providers: {
    meta: new MetaWebhookProvider({
      secret: process.env.META_APP_SECRET
    })
  },
  store: postgresStore({
    client: {
      query: (text, params) => client.query(text, params)
    }
  }),
  handler: async (event) => {
    console.log(event)
  }
})

app.post(
  "/webhooks/meta",
  express.raw({ type: "application/json" }),
  webhooks.handleRequest
)
```

## Installation

Webhook Fortress is currently used from source in this repository.

Local setup:

```bash
git clone https://github.com/Nikotheabstract/webhook-fortress.git
cd webhook-fortress
npm install
npm run build
```

For now, use the included examples under `examples/` (they import from `dist/`).

When an npm release is published, installation will be:

```bash
npm install webhook-fortress
```

Webhook Fortress is **ESM-only** (`"type": "module"`).

## Install via GitHub

Install directly from the public GitHub repository:

```bash
npm install github:Nikotheabstract/webhook-fortress#v0.1.0
```

Requirements:

- Node >=20
- ESM environment
- Webhook routes must use raw body middleware such as `express.raw({ type: "application/json" })`

For stable installs, prefer version tags such as:

- `v0.1.0`
- `v0.1.1`

That allows consumers to pin an explicit release instead of tracking the default branch.

## Documentation

- [docs/architecture.md](./docs/architecture.md): module boundaries, lifecycle, and extension points.
- [docs/idempotency.md](./docs/idempotency.md): dedupe and locking behavior.
- [docs/providers.md](./docs/providers.md): provider contract and adapter guidance.
- [docs/stores.md](./docs/stores.md): memory/Postgres/Redis adapter behavior.
- [docs/operations.md](./docs/operations.md): runtime guidance and operational considerations.
- [docs/testing.md](./docs/testing.md): test strategy and verification scope.

## Examples

The repository includes runnable examples that demonstrate integration patterns:

- [express-meta-basic](./examples/express-meta-basic) -> minimal webhook server.
- [express-meta-postgres](./examples/express-meta-postgres) -> production-style configuration with persistent idempotency.

See the [examples directory](./examples) for setup instructions.

## Who This Is For

- Developers building webhook consumers.
- Teams that need idempotent processing guarantees.
- Apps running multiple workers/processes.

## Stores

- `memoryStore()` for local development and tests.
- `postgresStore({ client })` for durable production persistence.
- `redisStore({ client })` for distributed locking and low-latency state checks.

See [docs/stores.md](./docs/stores.md) for adapter details and selection guidance.

## Reliability Model (At-Least-Once)

Webhook Fortress enforces idempotency and per-event locking, but webhook processing remains **at-least-once** end-to-end.

Crash window to be aware of:

1. Handler side effects run.
2. Process crashes before `markProcessed(eventId)`.
3. Provider retries and the event is replayed.

Recommended side-effect safety patterns:

- Use `event.id` as a unique key in downstream writes.
- Prefer upserts/unique constraints for side-effectful DB operations.
- Make outbound operations idempotent where possible (for example with idempotency keys).
- Keep retry logic enabled for failed events; failed events are intentionally left unprocessed.

## License

MIT. See [LICENSE](./LICENSE).
