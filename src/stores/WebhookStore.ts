export interface WebhookStore {
  hasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
  recordFailure(eventId: string, error?: unknown): Promise<void>;
  acquireLock(eventId: string): Promise<boolean>;
  releaseLock(eventId: string): Promise<void>;
}
