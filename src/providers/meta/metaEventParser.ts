export type MetaChannel = 'messenger' | 'instagram';

export type MetaMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  referral?: MetaReferral;
  reply_to?: Record<string, unknown>;
  replyTo?: Record<string, unknown>;
  story?: Record<string, unknown>;
  reel?: Record<string, unknown>;
  post?: Record<string, unknown>;
  attachments?: Array<{
    type?: string;
    payload?: {
      url?: string;
    };
  }>;
};

export type InstagramContext = {
  type: 'instagram_story' | 'instagram_post' | 'instagram_reel';
  story_id?: string;
  post_id?: string;
  reel_id?: string;
  media_id?: string;
  source?: string;
  attachments?: MetaMessage['attachments'] | null;
};

export type MetaAdsContextData = {
  post_id?: string;
  postId?: string;
};

export type MetaReferral = {
  source?: string;
  referrer_uri?: string;
  referrerUri?: string;
  post_id?: string;
  postId?: string;
  ads_context_data?: MetaAdsContextData;
  adsContextData?: MetaAdsContextData;
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

export type MetaReferralChangeValue = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  referral?: MetaReferral;
};

export type MetaChange = {
  field?: string;
  value?: MetaReferralChangeValue;
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

export const isMessengerPayload = (payload: MetaWebhookPayload) => payload.object === 'page';
export const isInstagramPayload = (payload: MetaWebhookPayload) => payload.object === 'instagram';

export const resolveChannel = (payload: MetaWebhookPayload): MetaChannel | null => {
  if (isMessengerPayload(payload)) return 'messenger';
  if (isInstagramPayload(payload)) return 'instagram';
  return null;
};

export const hasMessageContent = (message?: MetaMessage) => {
  if (!message) return false;
  if (typeof message.text === 'string' && message.text.trim().length > 0) {
    return true;
  }
  return Array.isArray(message.attachments) && message.attachments.length > 0;
};

export const getMessageFlags = (event: MetaMessagingEvent) => {
  const hasText = typeof event.message?.text === 'string' && event.message.text.trim().length > 0;
  const hasAttachments = Array.isArray(event.message?.attachments) && event.message.attachments.length > 0;
  const hasReferral = Boolean(event.message?.referral || event.postback?.referral);
  return { hasText, hasAttachments, hasReferral };
};

export const hasFallbackAttachment = (message?: MetaMessage) => {
  if (!message?.attachments || message.attachments.length === 0) {
    return false;
  }
  return message.attachments.some((attachment) => attachment?.type === 'fallback');
};

export const buildAttachmentPlaceholder = (message: MetaMessage | undefined) => {
  if (!message?.attachments || message.attachments.length === 0) {
    return null;
  }
  const attachment = message.attachments[0];
  const type = attachment.type ?? 'attachment';
  const url = attachment.payload?.url;
  if (url) {
    return `[attachment] ${type} ${url}`;
  }
  return `[attachment] ${type}`;
};

export const shouldIgnoreEcho = (event: MetaMessagingEvent) => {
  const senderId = event.sender?.id ?? '';
  const recipientId = event.recipient?.id ?? '';
  return Boolean(event.message?.is_echo) || (senderId !== '' && senderId === recipientId);
};

export const buildExternalConversationId = (params: { channel: MetaChannel; recipientId: string; senderId: string }) =>
  `meta:${params.channel}:${params.recipientId}:${params.senderId}`;

export const normalizeMetadata = (metadata: unknown): Record<string, unknown> => {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
};

const getConversationReferralSnapshot = (metadata: unknown) => {
  const root = normalizeMetadata(metadata);
  const referral =
    root.instagram_referral && typeof root.instagram_referral === 'object' && !Array.isArray(root.instagram_referral)
      ? (root.instagram_referral as Record<string, unknown>)
      : null;
  if (!referral) {
    return null;
  }
  const snapshot = {
    last_referral_type: typeof referral.last_referral_type === 'string' ? referral.last_referral_type : undefined,
    last_referral_id: typeof referral.last_referral_id === 'string' ? referral.last_referral_id : undefined,
    last_referral_source:
      typeof referral.last_referral_source === 'string' ? referral.last_referral_source : undefined,
    last_referral_received_at:
      typeof referral.last_referral_received_at === 'string' ? referral.last_referral_received_at : undefined,
  };
  if (!snapshot.last_referral_type && !snapshot.last_referral_id && !snapshot.last_referral_source) {
    return null;
  }
  return snapshot;
};

export const attachInstagramReferralSnapshot = (context: Record<string, unknown> | null, conversationMetadata: unknown) => {
  const snapshot = getConversationReferralSnapshot(conversationMetadata);
  if (!snapshot) {
    return context;
  }
  const base = context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {};
  const existingInstagram =
    base.instagram && typeof base.instagram === 'object' && !Array.isArray(base.instagram)
      ? (base.instagram as Record<string, unknown>)
      : {};
  if (
    existingInstagram.type ||
    existingInstagram.story_id ||
    existingInstagram.post_id ||
    existingInstagram.reel_id ||
    existingInstagram.media_id
  ) {
    return context;
  }
  base.instagram = {
    ...existingInstagram,
    ...snapshot,
  };
  return base;
};

export const attachFallbackFlag = (context: { type?: string } | null, hasFallback: boolean) => {
  if (!hasFallback) {
    return context;
  }
  if (context && typeof context === 'object') {
    return { ...context, has_fallback_attachment: true };
  }
  return { has_fallback_attachment: true };
};

export const resolveInstagramContext = (message?: MetaMessage): InstagramContext | null => {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const replyTo =
    (message.reply_to && typeof message.reply_to === 'object' ? message.reply_to : null) ||
    (message.replyTo && typeof message.replyTo === 'object' ? message.replyTo : null);
  const story =
    (replyTo as Record<string, unknown> | null)?.story ??
    (message.story && typeof message.story === 'object' ? message.story : null);
  const reel =
    (replyTo as Record<string, unknown> | null)?.reel ??
    (message.reel && typeof message.reel === 'object' ? message.reel : null);
  const post =
    (replyTo as Record<string, unknown> | null)?.post ??
    (message.post && typeof message.post === 'object' ? message.post : null) ??
    (replyTo as Record<string, unknown> | null)?.media;

  const storyId =
    (story && typeof story === 'object' && typeof (story as Record<string, unknown>).id === 'string'
      ? (story as Record<string, unknown>).id
      : null) ||
    (replyTo as Record<string, unknown> | null)?.story_id ||
    null;
  if (typeof storyId === 'string' && storyId) {
    return { type: 'instagram_story', story_id: storyId, source: 'reply_to' };
  }

  const reelId =
    (reel && typeof reel === 'object' && typeof (reel as Record<string, unknown>).id === 'string'
      ? (reel as Record<string, unknown>).id
      : null) ||
    (replyTo as Record<string, unknown> | null)?.reel_id ||
    null;
  if (typeof reelId === 'string' && reelId) {
    return { type: 'instagram_reel', reel_id: reelId, source: 'reply_to' };
  }

  const postId =
    (post && typeof post === 'object' && typeof (post as Record<string, unknown>).id === 'string'
      ? (post as Record<string, unknown>).id
      : null) ||
    (replyTo as Record<string, unknown> | null)?.post_id ||
    (replyTo as Record<string, unknown> | null)?.media_id ||
    null;
  if (typeof postId === 'string' && postId) {
    return { type: 'instagram_post', post_id: postId, media_id: postId, source: 'reply_to' };
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    const payload = attachment?.payload;
    const mediaId =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>).ig_post_media_id : null;
    if (typeof mediaId === 'string' && mediaId) {
      return { type: 'instagram_post', post_id: mediaId, media_id: mediaId, source: 'attachment' };
    }
  }

  return null;
};

export const mergeInstagramContext = (base: Record<string, unknown> | null, message: MetaMessage | undefined) => {
  const context = resolveInstagramContext(message);
  const attachments = Array.isArray(message?.attachments) ? message?.attachments : null;
  if (!context && !attachments) {
    return base;
  }
  const baseObj = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  const existingInstagram =
    typeof baseObj.instagram === 'object' && baseObj.instagram !== null && !Array.isArray(baseObj.instagram)
      ? (baseObj.instagram as Record<string, unknown>)
      : {};
  baseObj.instagram = {
    ...existingInstagram,
    ...(context ?? {}),
    ...(attachments ? { attachments } : {}),
  };
  return baseObj;
};

export const normalizeReferralContext = (referral: MetaReferral | null | undefined) => {
  if (!referral || typeof referral !== 'object') {
    return null;
  }
  const sourceRaw = typeof referral.source === 'string' ? referral.source : null;
  const referrerUri =
    (typeof referral.referrer_uri === 'string' && referral.referrer_uri) ||
    (typeof referral.referrerUri === 'string' && referral.referrerUri) ||
    null;
  const postId =
    (typeof referral.post_id === 'string' && referral.post_id) ||
    (typeof referral.postId === 'string' && referral.postId) ||
    (typeof referral.ads_context_data?.post_id === 'string' && referral.ads_context_data.post_id) ||
    (typeof referral.ads_context_data?.postId === 'string' && referral.ads_context_data.postId) ||
    (typeof referral.adsContextData?.post_id === 'string' && referral.adsContextData.post_id) ||
    (typeof referral.adsContextData?.postId === 'string' && referral.adsContextData.postId) ||
    null;
  const source = sourceRaw ? sourceRaw.toUpperCase() : null;
  const isPost = source === 'POST' || source === 'SHORTLINK' || Boolean(referrerUri) || Boolean(postId);
  if (!isPost) {
    return null;
  }
  return {
    type: 'facebook_post' as const,
    post_id: postId ?? undefined,
    referrer_uri: referrerUri ?? undefined,
    source: sourceRaw ?? undefined,
  };
};

export const getMessageTimestamp = (event: MetaMessagingEvent) => {
  if (!event.timestamp) {
    return new Date().toISOString();
  }
  return new Date(event.timestamp).toISOString();
};
