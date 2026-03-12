# Examples

Available examples:

- `express-meta-basic` -> minimal webhook server
- `express-meta-postgres` -> production-style idempotent processing with Postgres

## Quick start

Build the library once before running examples:

```bash
npm run build
```

### 1) express-meta-basic

```bash
cd examples/express-meta-basic
npm install
cp .env.example .env
npm run dev
```

### 2) express-meta-postgres

```bash
cd examples/express-meta-postgres
npm install
cp .env.example .env
psql "$DATABASE_URL" -f schema.sql
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres META_APP_SECRET=your_secret_here npm run dev
```

Both examples call `createWebhookFortress(...)` and expose `/webhooks/meta` routes using Express.

## Real integration pattern

Use `event.id` in your domain writes to keep downstream side effects idempotent:

```ts
handler: async (event) => {
  await db.upsert({
    event_id: event.id,
    payload: event.payload
  })
}
```
