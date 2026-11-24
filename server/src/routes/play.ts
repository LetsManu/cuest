import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { copy } from '../copy.js';
import { DiceError, type DiceService } from '../services/dice.js';
import { MAX_NOTE, SprintError, SPRINT_MINUTES, type SprintService } from '../services/sprint.js';
import { parseBody, sendQuestError } from './util.js';

const energy = z.enum(['low', 'medium', 'high']);
const playerQuery = z.object({ playerId: z.string().min(1) });
const diceQuery = playerQuery.extend({ energy });
const acceptBody = z.object({
  playerId: z.string().min(1),
  suggestion: z
    .object({ title: z.string(), minutes: z.number(), xp: z.number(), energy })
    .refine(sameSuggestion, 'unknown suggestion'),
});
const startBody = z.object({
  playerId: z.string().min(1),
  minutes: z.number().refine((m) => (SPRINT_MINUTES as readonly number[]).includes(m), 'minutes must be 5, 15 or 25'),
});
const logBody = z.object({ playerId: z.string().min(1), note: z.string().trim().min(1).max(MAX_NOTE) });
const playerBody = z.object({ playerId: z.string().min(1) });

function sameSuggestion(s: { title: string; minutes: number; xp: number; energy: string }): boolean {
  const c = copy.dice.suggestion;
  return s.title === c.title && s.minutes === c.minutes && s.xp === c.xp && s.energy === c.energy;
}

const sprintStatus: Record<SprintError['code'], number> = {
  sprint_running: 409,
  log_limit: 409,
  sprint_over: 409,
  no_sprint: 404,
  unknown_player: 404,
};

function sendSprintError(e: unknown, reply: FastifyReply): FastifyReply {
  if (!(e instanceof SprintError)) throw e;
  return reply.code(sprintStatus[e.code]).send({ error: e.code, message: copy.sprint.errors[e.code] });
}

export function registerPlayRoutes(app: FastifyInstance, dice: DiceService, sprints: SprintService, playerExists: (id: string) => boolean): void {
  app.get('/api/dice', async (req, reply) => {
    const q = parseBody(diceQuery, req.query, reply);
    if (!q) return reply;
    if (!playerExists(q.playerId)) return reply.code(404).send({ error: 'unknown_player', message: copy.notFound });
    return dice.roll(q.energy);
  });

  app.post('/api/dice/accept', async (req, reply) => {
    const body = parseBody(acceptBody, req.body, reply);
    if (!body) return reply;
    if (!playerExists(body.playerId)) return reply.code(404).send({ error: 'unknown_player', message: copy.notFound });
    try {
      return reply.code(201).send(dice.accept(body.playerId, body.suggestion));
    } catch (e) {
      if (e instanceof DiceError) return reply.code(409).send({ error: e.code, message: copy.dice.errors[e.code] });
      return sendQuestError(e, reply);
    }
  });

  app.get('/api/sprint', async (req, reply) => {
    const q = parseBody(playerQuery, req.query, reply);
    if (!q) return reply;
    return { sprint: sprints.current(q.playerId) };
  });

  app.post('/api/sprint/start', async (req, reply) => {
    const body = parseBody(startBody, req.body, reply);
    if (!body) return reply;
    try {
      return reply.code(201).send(sprints.start(body.playerId, body.minutes));
    } catch (e) {
      return sendSprintError(e, reply);
    }
  });

  app.post('/api/sprint/log', async (req, reply) => {
    const body = parseBody(logBody, req.body, reply);
    if (!body) return reply;
    try {
      return sprints.log(body.playerId, body.note);
    } catch (e) {
      return sendSprintError(e, reply);
    }
  });

  app.post('/api/sprint/finish', async (req, reply) => {
    const body = parseBody(playerBody, req.body, reply);
    if (!body) return reply;
    try {
      return sprints.finish(body.playerId);
    } catch (e) {
      return sendSprintError(e, reply);
    }
  });
}
