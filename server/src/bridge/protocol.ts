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

export type ServerMessage =
  | { type: 'welcome' }
  | { type: 'subscribe'; entities: string[] }
  | {
      type: 'call_service';
      id: string;
      domain: string;
      service: string;
      data: Record<string, unknown>;
      target?: { entity_id: string | string[] };
    }
  | { type: 'error'; reason: string };
