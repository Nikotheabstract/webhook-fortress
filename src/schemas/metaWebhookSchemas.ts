import { z } from 'zod';

export const MetaReferralSchema = z
  .object({
    source: z.string().optional(),
    referrer_uri: z.string().optional(),
    referrerUri: z.string().optional(),
    post_id: z.string().optional(),
    postId: z.string().optional(),
    ads_context_data: z
      .object({
        post_id: z.string().optional(),
        postId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    adsContextData: z
      .object({
        post_id: z.string().optional(),
        postId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const MetaAttachmentSchema = z
  .object({
    type: z.string().optional(),
    payload: z
      .object({
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const MetaMessageSchema = z
  .object({
    mid: z.string().optional(),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    referral: MetaReferralSchema.optional(),
    attachments: z.array(MetaAttachmentSchema).optional(),
  })
  .passthrough();

export const MetaMessagingEventSchema = z
  .object({
    sender: z
      .object({
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    recipient: z
      .object({
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    timestamp: z.number().optional(),
    message: MetaMessageSchema.optional(),
    postback: z
      .object({
        payload: z.string().optional(),
        referral: MetaReferralSchema.optional(),
      })
      .passthrough()
      .optional(),
    delivery: z.record(z.string(), z.unknown()).optional(),
    read: z.record(z.string(), z.unknown()).optional(),
    optin: z.record(z.string(), z.unknown()).optional(),
    account_linking: z.record(z.string(), z.unknown()).optional(),
    payment: z.record(z.string(), z.unknown()).optional(),
    referral: MetaReferralSchema.optional(),
  })
  .passthrough();

export const MetaChangeSchema = z
  .object({
    field: z.string().optional(),
    value: z
      .object({
        sender: z
          .object({
            id: z.string().optional(),
          })
          .passthrough()
          .optional(),
        recipient: z
          .object({
            id: z.string().optional(),
          })
          .passthrough()
          .optional(),
        timestamp: z.union([z.number(), z.string()]).optional(),
        referral: MetaReferralSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const MetaEntrySchema = z
  .object({
    id: z.string().optional(),
    time: z.number().optional(),
    messaging: z.array(MetaMessagingEventSchema).optional(),
    changes: z.array(MetaChangeSchema).optional(),
  })
  .passthrough();

export const MetaWebhookChallengeSchema = z.union([
  z
    .object({
      'hub.mode': z.string(),
      'hub.verify_token': z.string(),
      'hub.challenge': z.union([z.string(), z.number()]),
    })
    .passthrough(),
  z
    .object({
      hub: z
        .object({
          mode: z.string(),
          verify_token: z.string(),
          challenge: z.union([z.string(), z.number()]),
        })
        .passthrough(),
    })
    .passthrough(),
]);

export const MetaWebhookNotificationSchema = z
  .object({
    object: z.enum(['page', 'instagram']),
    entry: z.array(MetaEntrySchema).default([]),
  })
  .passthrough();

export const MetaWebhookPayloadSchema = z.union([
  MetaWebhookChallengeSchema,
  MetaWebhookNotificationSchema,
]);

export type MetaWebhookChallengePayload = z.infer<typeof MetaWebhookChallengeSchema>;
export type MetaWebhookNotificationPayload = z.infer<typeof MetaWebhookNotificationSchema>;
export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;
export type MetaEntry = z.infer<typeof MetaEntrySchema>;
export type MetaMessagingEvent = z.infer<typeof MetaMessagingEventSchema>;
export type MetaChange = z.infer<typeof MetaChangeSchema>;
