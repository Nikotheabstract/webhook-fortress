import 'dotenv/config';
import express from 'express';
import { createWebhookFortress, MetaWebhookProvider, postgresStore } from '../../dist/index.js';
import { client } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

const webhooks = createWebhookFortress({
  provider: 'meta',
  providers: {
    meta: new MetaWebhookProvider({
      secret: process.env.META_APP_SECRET,
    }),
  },
  store: postgresStore({ client }),
  handler: async (event) => {
    console.log('Processing event:', event.id, event.type);
  },
});

app.get('/health', async (_req, res) => {
  await client.query('SELECT 1');
  res.json({ ok: true });
});

app.post('/webhooks/meta', express.raw({ type: 'application/json' }), webhooks.handleRequest);

app.listen(port, () => {
  console.log(`Webhook Postgres example running on port ${port}`);
});
