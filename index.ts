import { createEventProcessor, type EventProcessHandler, type EventProcessResult, type EventProcessorOptions } from './src/idempotency/eventProcessor.js';
import type { WebhookEventHandler } from './src/handlers/WebhookEventHandler.js';
import { memoryStore } from './src/stores/memoryStore.js';
import type { WebhookStore } from './src/stores/WebhookStore.js';
import type { WebhookProvider } from './src/providers/WebhookProvider.js';
import type { Request, Response, WebhookEvent } from './src/types.js';
import {
  MetaWebhookProvider,
  type MetaWebhookProviderConfig,
  type WebhookEventHandlerFn,
} from './src/providers/meta/MetaWebhookProvider.js';

export type WebhookFortressConfig = {
  provider?: string;
  /**
   * @deprecated Use `providers.meta = new MetaWebhookProvider({ secret })`.
   */
  secret?: string;
  /**
   * @deprecated Use `providers.meta = new MetaWebhookProvider({ instagramSecret })`.
   */
  instagramSecret?: string;
  /**
   * @deprecated Use `providers.meta = new MetaWebhookProvider({ forcedChannel })`.
   */
  forcedChannel?: 'messenger' | 'instagram';
  providers?: Record<string, WebhookProvider> & {
    meta?: MetaWebhookProvider;
  };
  handler?: WebhookEventHandler | WebhookEventHandlerFn;
  store?: WebhookStore;
  idempotency?: EventProcessorOptions;
  /**
   * @deprecated Prefer constructing Meta provider via `providers.meta`.
   */
  meta?: MetaWebhookProviderConfig;
  onEventReceived?: (event: WebhookEvent) => void;
  onDuplicate?: (eventId: string) => void;
  onProcessed?: (event: WebhookEvent) => void;
  onFailed?: (event: WebhookEvent, error: unknown) => void;
  onLockContention?: (eventId: string) => void;
  onWarning?: EventProcessorOptions['onWarning'];
};

export type WebhookFortress = {
  providers: Record<string, WebhookProvider> & { meta: MetaWebhookProvider };
  process: (eventId: string, handler: EventProcessHandler) => Promise<EventProcessResult>;
  handleRequest: (req: Request, res: Response) => Promise<unknown>;
  getProvider: (provider?: string) => WebhookProvider;
  getFailures?: () => ReadonlyMap<string, unknown>;
};

type FailureReadableStore = WebhookStore & {
  getFailures: () => ReadonlyMap<string, unknown>;
};

const hasFailureReader = (store: WebhookStore): store is FailureReadableStore =>
  typeof (store as { getFailures?: unknown }).getFailures === 'function';

const invokeHookSafely = <TArgs extends unknown[]>(
  hook: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
) => {
  if (!hook) {
    return;
  }

  try {
    const maybePromise = hook(...args);
    if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
      void (maybePromise as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Hooks are observational and must never alter request processing.
  }
};

type ProcessWithWarningState = typeof process & {
  __webhookFortressEmittedWarnings?: Set<string>;
};

const processWithWarningState = process as ProcessWithWarningState;
const emittedWarnings =
  processWithWarningState.__webhookFortressEmittedWarnings ?? new Set<string>();
processWithWarningState.__webhookFortressEmittedWarnings = emittedWarnings;

const emitWarningOnce = (code: string, message: string) => {
  if (emittedWarnings.has(code)) {
    return;
  }
  emittedWarnings.add(code);

  if (typeof process.emitWarning === 'function') {
    process.emitWarning(message, { code });
    return;
  }

  // Fallback for non-Node runtimes that still execute this module.
  console.warn(message);
};

const warnLegacyMetaConfig = (config: WebhookFortressConfig) => {
  const usesLegacyTopLevelMetaFields =
    typeof config.secret === 'string' ||
    typeof config.instagramSecret === 'string' ||
    typeof config.forcedChannel === 'string';
  const usesLegacyMetaObject = typeof config.meta === 'object' && config.meta !== null;

  if (!usesLegacyTopLevelMetaFields && !usesLegacyMetaObject) {
    return;
  }

  emitWarningOnce(
    'WF_LEGACY_META_CONFIG',
    'Webhook Fortress legacy Meta config fields are deprecated. Prefer `providers.meta = new MetaWebhookProvider({...})`.'
  );
};

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
  warnLegacyMetaConfig(config);

  const resolvedHandler = resolveEventHandler(config.meta?.handler ?? config.handler);
  const store = config.store ?? memoryStore();
  const processor = createEventProcessor(store, {
    ...config.idempotency,
    onDuplicate: config.onDuplicate ?? config.idempotency?.onDuplicate,
    onLockContention: config.onLockContention ?? config.idempotency?.onLockContention,
    onWarning: config.onWarning ?? config.idempotency?.onWarning,
  });
  const failureReader = hasFailureReader(store) ? store.getFailures.bind(store) : undefined;

  const defaultMetaProvider = new MetaWebhookProvider({
      secret: config.meta?.secret ?? config.secret,
      instagramSecret: config.meta?.instagramSecret ?? config.instagramSecret,
      forcedChannel: config.meta?.forcedChannel ?? config.forcedChannel,
    });

  const configuredProviders = config.providers ?? {};
  const providers = {
    ...configuredProviders,
    meta: configuredProviders.meta ?? defaultMetaProvider,
  } as Record<string, WebhookProvider> & { meta: MetaWebhookProvider };

  const selectedProvider = config.provider ?? 'meta';
  const activeProvider = providers[selectedProvider];
  if (!activeProvider) {
    throw new Error(`Unknown webhook provider: ${selectedProvider}`);
  }

  const process = (eventId: string, handler: EventProcessHandler) => processor.process(eventId, handler);

  return {
    providers,
    process,
    handleRequest: async (req, res) => {
      if (!activeProvider.verifySignature(req)) {
        return res.sendStatus(401);
      }

      let event: WebhookEvent;
      try {
        event = activeProvider.parseEvent(req);
      } catch {
        return res.sendStatus(400);
      }

      if (typeof activeProvider.verifyFreshness === 'function') {
        const freshness = activeProvider.verifyFreshness(req);
        if (!freshness.ok) {
          console.warn('[Webhook Fortress] Webhook rejected by provider freshness policy', {
            provider: selectedProvider,
            reason: freshness.reason,
            ...freshness.details,
          });
          return res.sendStatus(401);
        }
      }

      invokeHookSafely(config.onEventReceived, event);

      try {
        const result = await process(event.id, async () => {
          await resolvedHandler.handle(event);
        });

        if (result.processed) {
          invokeHookSafely(config.onProcessed, event);
        }

        return res.sendStatus(200);
      } catch (error) {
        invokeHookSafely(config.onFailed, event, error);
        return res.sendStatus(500);
      }
    },
    getProvider: (provider = selectedProvider) => {
      const resolved = providers[provider];
      if (!resolved) {
        throw new Error(`Unknown webhook provider: ${provider}`);
      }
      return resolved;
    },
    getFailures: failureReader,
  };
}

export { MetaWebhookProvider } from './src/providers/meta/MetaWebhookProvider.js';
export { EventProcessor, createEventProcessor } from './src/idempotency/eventProcessor.js';
export type { LockWarning, LockWarningType } from './src/idempotency/locking.js';
export { memoryStore, MemoryWebhookStore } from './src/stores/memoryStore.js';
export { postgresStore, PostgresWebhookStore } from './src/stores/postgresStore.js';
export { redisStore, RedisWebhookStore } from './src/stores/redisStore.js';
export type { WebhookProvider } from './src/providers/WebhookProvider.js';
export type { WebhookEventHandler } from './src/handlers/WebhookEventHandler.js';
export type { WebhookStore } from './src/stores/WebhookStore.js';
export type { WebhookEvent } from './src/types.js';
