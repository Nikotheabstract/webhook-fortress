import type { WebhookStore } from '../stores/WebhookStore.js';

export const hasEventBeenProcessed = async (store: WebhookStore, eventId: string): Promise<boolean> =>
  store.hasProcessed(eventId);

export const markEventAsProcessed = async (store: WebhookStore, eventId: string): Promise<void> => {
  await store.markProcessed(eventId);
};
