# Providers

Providers isolate source-specific webhook behavior from the core engine.

## Provider Interface

```ts
interface WebhookProvider {
  verifySignature(req: Request): boolean
  parseEvent(req: Request): WebhookEvent
}
```

## Provider Boundary

Providers are responsible for protocol correctness, not business execution.

Providers should:

- verify signatures against raw body data
- parse source payloads
- normalize into `WebhookEvent`
- generate deterministic event IDs

Providers should not:

- write to databases directly
- implement retry orchestration
- manage persistence or lock state
- execute domain side effects

## Provider Checklist

- Verify raw-body signature correctly.
- Normalize events consistently.
- Generate deterministic event IDs.
- Avoid domain side effects.

## Current Provider

- Meta provider (`src/providers/meta`) is implemented.

## Adding A Second Provider (Sketch)

1. Create `src/providers/<provider>/MyProvider.ts`.
2. Implement `verifySignature(req)`.
3. Implement `parseEvent(req)` returning normalized `WebhookEvent`.
4. Add provider registration in `createWebhookFortress()`.
5. Add tests for:
   - signature validation
   - parsing/normalization
   - deterministic event IDs and fallback behavior
