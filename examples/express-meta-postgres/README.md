# Express Meta Postgres

Express webhook server using Webhook Fortress with a Postgres-backed idempotency store.

## What it demonstrates

- Meta webhook handling in Express
- persistent idempotency via `postgresStore({ client })`
- failure/processed tracking tables in Postgres

## Prerequisites

- PostgreSQL running locally or remotely
- `DATABASE_URL` and `META_APP_SECRET` environment variables

## Database setup

Run schema:

```bash
cd examples/express-meta-postgres
cp .env.example .env
psql "$DATABASE_URL" -f schema.sql
```

## Install and run

```bash
cd examples/express-meta-postgres
npm install
npm run build:library
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
META_APP_SECRET=your_secret_here \
PORT=3001 \
npm run dev
```

Server runs on `http://localhost:3001`.

## Notes

- The library build step is run automatically by `npm run dev`.
- Duplicate deliveries are deduplicated using Postgres state/locking tables.
