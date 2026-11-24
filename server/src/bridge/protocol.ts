import { z } from 'zod';

export const helloMsg = z.object({ type: z.literal('hello'), secret: z.string(), version: z.string() });
export const stateMsg = z.object({
  type: z.literal('state'),
  entityId: z.string(),
  oldState: z.string().nullable(),
  newState: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export const notificationActionMsg = z.object({
  type: z.literal('notification_action'),
  action: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export const resultMsg = z.object({
  type: z.literal('result'),
  id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});

export const entityInfo = z.object({
  entityId: z.string(),
  domain: z.string(),
  deviceId: z.string().nullable(),
  deviceClass: z.string().nullable(),
  platform: z.string().nullable(),
  translationKey: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  unit: z.string().nullable(),
  name: z.string().nullable(),
  deviceName: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  state: z.string().nullable(),
});
export type EntityInfo = z.infer<typeof entityInfo>;

export const entitiesMsg = z.object({
  type: z.literal('entities'),
  chunk: z.number().int().min(0),
  last: z.boolean(),
  entities: z.array(entityInfo),
});
export const apiMsg = z.object({
  type: z.literal('api'),
  id: z.string(),
  method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']),
  path: z.string(), // must start with /api/; checked in the hub so it can answer 400
  body: z.unknown().optional(),
});

export const bridgeMessage = z.discriminatedUnion('type', [
  helloMsg,
  stateMsg,
  notificationActionMsg,
  resultMsg,
  entitiesMsg,
  apiMsg,
]);
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

export const apiResultMsg = z.object({
  type: z.literal('api_result'),
  id: z.string(),
  status: z.number().int(),
  body: z.unknown(),
});
export const snapshotPlayer = z.object({
  id: z.string(),
  name: z.string(),
  haPerson: z.string().nullable(),
  level: z.number(),
  title: z.string(),
  xp: z.number(),
  gold: z.number(),
  intoLevel: z.number(),
  toNext: z.number(),
  outfit: z.object({
    items: z.object({ hood: z.string().nullable(), scarf: z.string().nullable(), broom: z.string().nullable() }),
    palette: z.record(z.string(), z.string()),
  }),
  decor: z.array(z.string()),
  restTokens: z.number(),
  streak: z.number(),
  bestStreak: z.number(),
  boostUntil: z.string().nullable(),
});
export const snapshotQuest = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['open', 'active', 'whenever']),
  claimedBy: z.string().nullable(),
  xp: z.number(),
  minutes: z.number(),
  templateId: z.string().nullable(),
  createdAt: z.string(),
});
export type SnapshotPlayer = z.infer<typeof snapshotPlayer>;
export type SnapshotQuest = z.infer<typeof snapshotQuest>;
export const snapshotMsg = z.object({
  type: z.literal('snapshot'),
  players: z.array(snapshotPlayer),
  quests: z.array(snapshotQuest),
  questOfDay: z.string().nullable(),
});
export const fireEventMsg = z.object({
  type: z.literal('fire_event'),
  event: z.enum(['cuest_quest_opened', 'cuest_quest_done', 'cuest_level_up']),
  data: z.record(z.string(), z.unknown()),
});

export const serverMessage = z.discriminatedUnion('type', [
  welcomeMsg,
  subscribeMsg,
  callServiceMsg,
  errorMsg,
  apiResultMsg,
  snapshotMsg,
  fireEventMsg,
]);
export type ServerMessage = z.infer<typeof serverMessage>;
