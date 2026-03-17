import type { MetaChannel, MetaWebhookPayload } from '../../schemas/metaWebhookSchemas.js';

export const isMessengerPayload = (payload: MetaWebhookPayload): boolean => payload.object === 'page';

export const isInstagramPayload = (payload: MetaWebhookPayload): boolean => payload.object === 'instagram';

export const resolveChannel = (payload: MetaWebhookPayload): MetaChannel | null => {
  if (isMessengerPayload(payload)) {
    return 'messenger';
  }

  if (isInstagramPayload(payload)) {
    return 'instagram';
  }

  return null;
};
