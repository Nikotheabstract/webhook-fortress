# Contributing

Thanks for contributing to Webhook Fortress.

## Project Philosophy

- Reliability first.
- Deterministic behavior over implicit heuristics.
- Narrow responsibilities per module.
- Tests must protect behavioral guarantees.

## Development Setup

Install dependencies from the monorepo root/backend as needed, then run tests from `backend` with the extraction Vitest config.

## Run Tests

From repository root:

```bash
cd backend
npx tsc -p ../extractions/webhook-fortress/tsconfig.json --noEmit
npx vitest run --config ../extractions/webhook-fortress/vitest.config.ts
```

## Adding Providers

1. Add provider folder under `src/providers/<provider>/`.
2. Implement `WebhookProvider` contract:
   - `verifySignature(req)`
   - `parseEvent(req)`
3. Map raw payload to normalized `WebhookEvent`.
4. Ensure deterministic event IDs for idempotency.
5. Register provider in `createWebhookFortress()`.
6. Add tests for signature, parsing, and event ID stability.

## Adding Stores

1. Implement `WebhookStore`:
   - `hasProcessed`
   - `markProcessed`
   - `recordFailure`
   - `acquireLock`
   - `releaseLock`
2. Keep lock and dedupe behavior atomic for your backend.
3. Ensure `recordFailure` never marks events as processed.
4. Add adapter contract tests using mocks/fakes.

## Code Style

- Use strict TypeScript typing.
- Keep modules focused and composable.
- Prefer deterministic behavior in parsing and event ID generation.
- Keep public API changes minimal and explicit.
- Add or update tests for every behavior change.

## Pull Request Expectations

- Include rationale and behavior impact summary.
- Include test coverage for new logic.
- Confirm all extraction tests and type checks pass.
