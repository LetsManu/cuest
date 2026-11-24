import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { EntityInfo } from '../src/bridge/protocol.js';
import { makeDeps } from './helpers.js';

const ent = (o: Partial<EntityInfo> & { entityId: string }): EntityInfo => ({
  domain: o.entityId.split('.')[0]!, deviceId: null, deviceClass: null, platform: null, translationKey: null,
  options: null, unit: null, name: null, deviceName: null, manufacturer: null, model: null, state: null, ...o,
});
const washer = ent({
  entityId: 'sensor.w_state', deviceId: 'd1', deviceName: 'Washer', translationKey: 'operation_state',
  options: ['inactive', 'run', 'finished'],
});

let app: FastifyInstance;
let changed: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  changed = vi.fn<() => void>();
  app = await buildApp(makeDeps({ getEntities: () => [washer], onTemplatesChanged: changed }));
});
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/suggestions/accept', payload: payload as object });
const list = async () => (await app.inject({ method: 'GET', url: '/api/suggestions' })).json().suggestions;

describe('suggestions API', () => {
  it('lists suggestions and marks added after accept', async () => {
    expect((await list())[0]).toMatchObject({ key: 'finished_state:sensor.w_state', added: false });
    const res = await post({ keys: ['finished_state:sensor.w_state'] });
    expect(res.statusCode).toBe(201);
    expect(res.json().templates).toHaveLength(1);
    expect((await list())[0]!.added).toBe(true);
  });

  it('accepting twice creates templates once', async () => {
    await post({ keys: ['finished_state:sensor.w_state'] });
    const again = await post({ keys: ['finished_state:sensor.w_state'] });
    expect(again.statusCode).toBe(201);
    expect(again.json().templates).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/templates' })).json()).toHaveLength(1);
    expect(changed).toHaveBeenCalled();
  });

  it('unknown key is 400', async () => {
    const res = await post({ keys: ['finished_state:sensor.w_state', 'nope'] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unknown_suggestion', keys: ['nope'] });
    expect((await app.inject({ method: 'GET', url: '/api/templates' })).json()).toEqual([]);
  });
});
