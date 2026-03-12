import 'dotenv/config';
import express from 'express';
import { createWebhookFortress, MetaWebhookProvider } from '../../dist/index.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

const webhooks = createWebhookFortress({
  provider: 'meta',
  providers: {
    meta: new MetaWebhookProvider({
      secret: process.env.META_APP_SECRET,
    }),
  },
  handler: async (event) => {
    console.log('Received webhook event:', {
      id: event.id,
      provider: event.provider,
      type: event.type,
      receivedAt: event.receivedAt.toISOString(),
    });
  },
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/webhooks/meta', express.raw({ type: 'application/json' }), webhooks.handleRequest);

app.listen(port, () => {
  console.log(`Webhook example running on port ${port}`);
});
