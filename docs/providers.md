# Providers

Providers isolate source-specific webhook behavior from the core engine.

## Provider Interface

```ts
interface WebhookProvider {
  verifySignature(req: Request): boolean
  parseEvent(req: Request): WebhookEvent
  verifyFreshness?(req: Request): { ok: boolean; reason: string }
}
```

Providers are registered in `createWebhookFortress` via a dynamic registry:

```ts
createWebhookFortress({
  provider: "meta",
  providers: {
    meta: new MetaWebhookProvider({ secret: process.env.META_APP_SECRET })
  },
  handler: async (event) => {
    // domain logic
  }
})
```

`provider: "meta"` remains the default for backward compatibility.

## Provider Boundary

Providers are responsible for protocol correctness, not business execution.

HTTP request orchestration (status codes, handler invocation, idempotency flow) lives in the factory layer.

Providers should:

- verify signatures against raw body data
- enforce provider-specific request freshness (recommended for replay defense)
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
- Verify request freshness policy (timestamp tolerance or equivalent).
- Normalize events consistently.
- Generate deterministic event IDs.
- Avoid domain side effects.

## Current Provider

- Meta provider (`src/providers/meta`) is implemented.

## Adding A Second Provider (Sketch)

1. Create `src/providers/<provider>/MyProvider.ts`.
2. Implement `verifySignature(req)`.
3. Optionally implement `verifyFreshness(req)` for replay-window protection.
4. Implement `parseEvent(req)` returning normalized `WebhookEvent`.
5. Add provider registration in `createWebhookFortress()`.
6. Add tests for:
   - signature validation
   - freshness/replay checks
   - parsing/normalization
   - deterministic event IDs and fallback behavior
