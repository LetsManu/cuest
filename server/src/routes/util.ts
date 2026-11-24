import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { copy } from '../copy.js';
import { QuestError } from '../services/quests.js';

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const nonNegInt = z.number().int().min(0);

/** Parse a body; on failure send 400 and return null. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
  const r = schema.safeParse(body ?? {});
  if (r.success) return r.data;
  void reply.code(400).send({ error: 'invalid', issues: r.error.issues });
  return null;
}

/** Drop keys whose value is undefined so repo `update` spreads don't clobber fields. */
export function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function sendQuestError(e: unknown, reply: FastifyReply): FastifyReply {
  if (!(e instanceof QuestError)) throw e;
  if (e.code === 'already_claimed') return reply.code(409).send({ error: e.code, message: copy.alreadyClaimed });
  if (e.code === 'already_done') return reply.code(409).send({ error: e.code, message: copy.alreadyDone });
  return reply.code(404).send({ error: e.code, message: copy.notFound });
}
