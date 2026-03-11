import { createWebhookFortress } from '../index.js';

const webhook = createWebhookFortress({
  provider: 'meta',
  secret: process.env.META_APP_SECRET,
  instagramSecret: process.env.INSTAGRAM_APP_SECRET,
  handler: async (event) => {
    console.log('Webhook event:', {
      id: event.id,
      provider: event.provider,
      type: event.type,
      receivedAt: event.receivedAt.toISOString(),
      payload: event.payload,
    });
  },
});

export { webhook };

/*
Example Express wiring:

import express from 'express';
import { webhook } from './meta-messenger-handler.js';

const app = express();
app.post('/webhooks/meta', express.raw({ type: 'application/json' }), webhook.handleRequest);
*/
