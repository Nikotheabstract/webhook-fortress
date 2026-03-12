# Testing

This guide describes how to run and extend the Webhook Fortress test suite.

## Run Typecheck And Tests

From repository root:

```bash
npm install
npm run typecheck
npm run test
```

## Current Test Coverage

The suite currently covers:

- provider behavior (Meta parsing and normalized events)
- HTTP behavior (401/400/500 flows)
- idempotency under duplicates and concurrency
- failure handling and failure recording paths
- lock renewal and lock release failure semantics
- Postgres lock ownership token behavior (stale worker renew/release safety)
- store adapter contract behavior for memory/postgres/redis
- event ID fallback determinism

## Adding Tests For A New Provider

Add tests for:

- signature verification edge cases
- payload parsing and normalization
- deterministic event ID generation
- HTTP behavior via `handleRequest` integration path

## Adding Tests For A New Store Adapter

Add contract tests that verify:

- `acquireLock` prevents concurrent execution
- `releaseLock` re-enables lock acquisition
- `hasProcessed` reflects `markProcessed`
- `recordFailure` does not mark processed

Use mocks/fakes to avoid external infra in unit-level tests.

## Why Deterministic Event IDs Must Be Tested

Idempotency is keyed by event ID. If equivalent payloads produce different IDs, duplicates will bypass dedupe. If different payloads produce the same ID, valid events may be dropped.

Always test both:

- same payload -> same event ID
- different payload -> different event ID
