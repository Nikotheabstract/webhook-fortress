import { createEventProcessor, type EventProcessHandler, type EventProcessResult, type EventProcessorOptions } from './src/idempotency/eventProcessor.js';
import type { WebhookEventHandler } from './src/handlers/WebhookEventHandler.js';
import { memoryStore } from './src/stores/memoryStore.js';
import type { WebhookStore } from './src/stores/WebhookStore.js';
import type { WebhookProvider } from './src/providers/WebhookProvider.js';
import type { Request, Response } from './src/types.js';
import {
  MetaWebhookProvider,
  type MetaWebhookProviderConfig,
  type WebhookEventHandlerFn,
} from './src/providers/meta/MetaWebhookProvider.js';

export type WebhookFortressConfig = {
  provider?: 'meta';
  secret?: string;
  instagramSecret?: string;
  forcedChannel?: 'messenger' | 'instagram';
  providers?: {
    meta?: MetaWebhookProvider;
  };
  handler?: WebhookEventHandler | WebhookEventHandlerFn;
  store?: WebhookStore;
  idempotency?: EventProcessorOptions;
  meta?: MetaWebhookProviderConfig;
};

export type WebhookFortress = {
  providers: {
    meta: MetaWebhookProvider;
  };
  process: (eventId: string, handler: EventProcessHandler) => Promise<EventProcessResult>;
  handleRequest: (req: Request, res: Response) => Promise<unknown>;
  getProvider: (provider: 'meta') => WebhookProvider;
  getFailures?: () => ReadonlyMap<string, unknown>;
};

type FailureReadableStore = WebhookStore & {
  getFailures: () => ReadonlyMap<string, unknown>;
};

const hasFailureReader = (store: WebhookStore): store is FailureReadableStore =>
  typeof (store as { getFailures?: unknown }).getFailures === 'function';

const resolveEventHandler = (handler?: WebhookEventHandler | WebhookEventHandlerFn): WebhookEventHandler => {
  if (!handler) {
    return { handle: async () => undefined };
  }

  if (typeof handler === 'function') {
    return {
      handle: async (event) => {
        await handler(event);
      },
    };
  }

  return handler;
};

export function createWebhookFortress(config: WebhookFortressConfig = {}): WebhookFortress {
  const resolvedHandler = resolveEventHandler(config.meta?.handler ?? config.handler);
  const store = config.store ?? memoryStore();
  const processor = createEventProcessor(store, config.idempotency);
  const failureReader = hasFailureReader(store) ? store.getFailures.bind(store) : undefined;

  const metaProvider =
    config.providers?.meta ??
    new MetaWebhookProvider({
      secret: config.meta?.secret ?? config.secret,
      instagramSecret: config.meta?.instagramSecret ?? config.instagramSecret,
      forcedChannel: config.meta?.forcedChannel ?? config.forcedChannel,
      handler: resolvedHandler,
    });

  const providers = {
    meta: metaProvider,
  };

  const selectedProvider = config.provider ?? 'meta';
  const process = (eventId: string, handler: EventProcessHandler) => processor.process(eventId, handler);

  return {
    providers,
    process,
    handleRequest: async (req, res) => {
      const provider = providers[selectedProvider];

      if (!provider.verifySignature(req)) {
        return res.sendStatus(401);
      }

      let event;
      try {
        event = provider.parseEvent(req);
      } catch {
        return res.sendStatus(400);
      }

      try {
        await process(event.id, async () => {
          await resolvedHandler.handle(event);
        });
        return res.sendStatus(200);
      } catch {
        return res.sendStatus(500);
      }
    },
    getProvider: (provider) => providers[provider],
    getFailures: failureReader,
  };
}

export { MetaWebhookProvider } from './src/providers/meta/MetaWebhookProvider.js';
export { EventProcessor, createEventProcessor } from './src/idempotency/eventProcessor.js';
export { memoryStore, MemoryWebhookStore } from './src/stores/memoryStore.js';
export { postgresStore, PostgresWebhookStore } from './src/stores/postgresStore.js';
export { redisStore, RedisWebhookStore } from './src/stores/redisStore.js';
export type { WebhookProvider } from './src/providers/WebhookProvider.js';
export type { WebhookEventHandler } from './src/handlers/WebhookEventHandler.js';
export type { WebhookStore } from './src/stores/WebhookStore.js';
export type { WebhookEvent } from './src/types.js';
