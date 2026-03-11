export type HeaderValue = string | string[] | undefined;

export interface Request {
  body?: unknown;
  headers: Record<string, unknown>;
  header?: (name: string) => HeaderValue;
}

export interface Response {
  sendStatus: (statusCode: number) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  status?: (statusCode: number) => Response;
  json?: (body: unknown) => unknown;
}

export interface WebhookEvent {
  id: string;
  provider: string;
  type: string;
  payload: unknown;
  receivedAt: Date;
}
