export type MetaChannel = 'messenger' | 'instagram';

export type MetaReferral = {
  source?: string;
  referrer_uri?: string;
  referrerUri?: string;
  post_id?: string;
  postId?: string;
  ads_context_data?: {
    post_id?: string;
    postId?: string;
  };
  adsContextData?: {
    post_id?: string;
    postId?: string;
  };
};

export type MetaMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  referral?: MetaReferral;
  attachments?: Array<{
    type?: string;
    payload?: {
      url?: string;
    };
  }>;
};

export type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MetaMessage;
  postback?: { payload?: string; referral?: MetaReferral };
  delivery?: Record<string, unknown>;
  read?: Record<string, unknown>;
  optin?: Record<string, unknown>;
  account_linking?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  referral?: MetaReferral;
};

export type MetaChange = {
  field?: string;
  value?: {
    sender?: { id?: string };
    recipient?: { id?: string };
    timestamp?: number | string;
    referral?: MetaReferral;
  };
};

export type MetaEntry = {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
  changes?: MetaChange[];
};

export type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

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
