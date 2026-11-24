import { z } from 'zod';

export const helloMsg = z.object({ type: z.literal('hello'), secret: z.string(), version: z.string() });
export const stateMsg = z.object({
  type: z.literal('state'),
  entityId: z.string(),
  oldState: z.string().nullable(),
  newState: z.string(),
  at: z.string(),
});
export const notificationActionMsg = z.object({
  type: z.literal('notification_action'),
  action: z.string(),
  at: z.string(),
});
export const resultMsg = z.object({
  type: z.literal('result'),
  id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});

export const bridgeMessage = z.discriminatedUnion('type', [helloMsg, stateMsg, notificationActionMsg, resultMsg]);
export type BridgeMessage = z.infer<typeof bridgeMessage>;

export const welcomeMsg = z.object({ type: z.literal('welcome') });
export const subscribeMsg = z.object({ type: z.literal('subscribe'), entities: z.array(z.string()) });
export const callServiceMsg = z.object({
  type: z.literal('call_service'),
  id: z.string(),
  domain: z.string(),
  service: z.string(),
  data: z.record(z.string(), z.unknown()),
  target: z.object({ entity_id: z.union([z.string(), z.array(z.string())]) }).optional(),
});
export const errorMsg = z.object({ type: z.literal('error'), reason: z.string() });

export const serverMessage = z.discriminatedUnion('type', [welcomeMsg, subscribeMsg, callServiceMsg, errorMsg]);
export type ServerMessage = z.infer<typeof serverMessage>;
