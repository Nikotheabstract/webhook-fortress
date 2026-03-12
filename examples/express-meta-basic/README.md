# Express Meta Basic

Minimal Express webhook server using Webhook Fortress with the Meta provider.

## What it demonstrates

- Express route wiring for Meta webhooks
- signature verification via Webhook Fortress
- normalized event handling in a simple logger

## Setup

```bash
cd examples/express-meta-basic
npm install
cp .env.example .env
```

Set `META_APP_SECRET` in `.env`.

## Run

```bash
npm run dev
```

Server runs on `http://localhost:3000`.

## Send a test request

1. Compute signature for payload with your secret:

```bash
payload='{"object":"page","entry":[{"id":"page-1","messaging":[{"message":{"mid":"mid.1","text":"hello"}}]}]}'
secret='your_secret_here'
signature=$(node -e "const crypto=require('crypto'); const p=process.argv[1]; const s=process.argv[2]; console.log('sha256='+crypto.createHmac('sha256', s).update(p).digest('hex'));" "$payload" "$secret")
```

2. Send webhook request:

```bash
curl -i \
  -X POST http://localhost:3000/webhooks/meta \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $signature" \
  --data "$payload"
```
