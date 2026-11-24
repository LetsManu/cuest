import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_NUDGE, type QuestTemplate } from '../domain/types.js';
import { presetTemplates, type PresetName } from '../domain/presets.js';
import type { TemplatesRepo } from '../repos/templates.js';
import { defined, hhmm, nonNegInt, parseBody, ymd } from './util.js';

const rule = z.union([
  z.object({ type: z.literal('state'), entityId: z.string().min(1), to: z.array(z.string()), from: z.array(z.string()).optional() }),
  z.object({
    type: z.literal('power_below'),
    entityId: z.string().min(1),
    runningAboveW: z.number().min(0),
    idleBelowW: z.number().min(0),
    forMinutes: nonNegInt,
  }),
]);
const schedule = z.union([
  z.object({ type: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)), time: hhmm }),
  z.object({ type: z.literal('every_n_days'), n: z.number().int().min(1), time: hhmm, startDate: ymd }),
]);
const nudge = z.object({
  notify: z.boolean(),
  light: z.object({ entityId: z.string().min(1), rgb: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]) }).nullable(),
  repeatEveryMinutes: nonNegInt,
  maxRepeats: nonNegInt,
  quietStart: hhmm,
  quietEnd: hhmm,
});

const createBody = z.object({
  title: z.string().min(1),
  energy: z.enum(['low', 'medium', 'high']),
  minutes: nonNegInt,
  xp: nonNegInt,
  gold: nonNegInt,
  source: z.enum(['manual', 'recurring', 'rule']),
  rule: rule.nullable(),
  schedule: schedule.nullable(),
  nudge: nudge.optional(),
  wheneverAfterHours: nonNegInt,
  enabled: z.boolean(),
});
const patchBody = createBody.partial();
const presetBody = z.object({
  preset: z.enum([
    'washer_power', 'washer_state', 'dryer_power', 'dryer_state',
    'dishwasher_power', 'dishwasher_state', 'vacuum', 'vacuum_bin_sensor',
  ]),
  entityId: z.string().min(1),
  doneStates: z.array(z.string()).optional(),
});

export function registerTemplateRoutes(app: FastifyInstance, templates: TemplatesRepo, onChanged: () => void): void {
  app.get('/api/templates', async () => templates.list());

  app.post('/api/templates', async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return reply;
    const t = templates.create({ ...body, nudge: body.nudge ?? DEFAULT_NUDGE }, new Date());
    onChanged();
    return reply.code(201).send(t);
  });

  app.post('/api/templates/presets', async (req, reply) => {
    const body = parseBody(presetBody, req.body, reply);
    if (!body) return reply;
    const now = new Date();
    const created = presetTemplates(body.preset as PresetName, {
      entityId: body.entityId,
      ...(body.doneStates ? { doneStates: body.doneStates } : {}),
    }).map((t) => templates.create(t, now));
    onChanged();
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const body = parseBody(patchBody, req.body, reply);
    if (!body) return reply;
    const t = templates.update(req.params.id, defined(body) as Partial<QuestTemplate>);
    if (!t) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    onChanged();
    return t;
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const t = templates.update(req.params.id, { enabled: false });
    if (!t) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    onChanged();
    return t;
  });
}
