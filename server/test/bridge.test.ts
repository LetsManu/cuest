import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BridgeHub } from '../src/bridge/hub.js';
import { makeDeps } from './helpers.js';
import type { StateEvent } from '../src/domain/types.js';

const SECRET = 'correct-horse';
let app: FastifyInstance;
let hub: BridgeHub;
let port: number;
const sockets: WebSocket[] = [];

async function setup(): Promise<void> {
  hub = new BridgeHub({ secret: SECRET, log: () => {} });
  app = await buildApp(makeDeps({ bridgeConnected: () => hub.isConnected(), hub }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as { port: number }).port;
}

interface Client {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  closed: Promise<number>;
}

function connect(secret: string | null): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`);
    sockets.push(ws);
    const messages: Record<string, unknown>[] = [];
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    ws.on('open', () => {
      if (secret !== null) ws.send(JSON.stringify({ type: 'hello', secret, version: '1' }));
      resolve({ ws, messages, closed });
    });
  });
}

const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

afterEach(async () => {
  if (!app) return;
  for (const ws of sockets.splice(0)) ws.terminate();
  await app.close();
});

describe('bridge hub', () => {
  it('wrong secret is rejected', async () => {
    await setup();
    const c = await connect('nope-nope-nope');
    expect(await c.closed).toBe(4001);
    expect(hub.isConnected()).toBe(false);
  });

  it('length-mismatched secret is rejected without throwing', async () => {
    await setup();
    const c = await connect('x');
    expect(await c.closed).toBe(4001);
  });

  it('hello gets welcome and current subscriptions', async () => {
    await setup();
    hub.setSubscriptions(['sensor.washer_power']);
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 2);
    expect(c.messages[0]).toEqual({ type: 'welcome' });
    expect(c.messages[1]).toEqual({ type: 'subscribe', entities: ['sensor.washer_power'] });
    expect(hub.isConnected()).toBe(true);
  });

  it('subscriptions are re-sent on reconnect', async () => {
    await setup();
    hub.setSubscriptions(['sensor.a']);
    const c1 = await connect(SECRET);
    await until(() => c1.messages.length >= 2);
    c1.ws.close();
    await c1.closed;
    await until(() => !hub.isConnected());
    const c2 = await connect(SECRET);
    await until(() => c2.messages.length >= 2);
    expect(c2.messages[1]).toEqual({ type: 'subscribe', entities: ['sensor.a'] });
  });

  it('a new bridge replaces the previous one with 4002', async () => {
    await setup();
    const c1 = await connect(SECRET);
    await until(() => c1.messages.length >= 1);
    const c2 = await connect(SECRET);
    expect(await c1.closed).toBe(4002);
    await until(() => c2.messages.length >= 1);
    expect(hub.isConnected()).toBe(true);
  });

  it('state messages reach onState with Date at', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState((e) => events.push(e));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    c.ws.send(
      JSON.stringify({
        type: 'state',
        entityId: 'sensor.x',
        oldState: null,
        newState: 'on',
        at: '2026-01-01T10:00:00.000Z',
      }),
    );
    await until(() => events.length === 1);
    expect(events[0]!.at).toBeInstanceOf(Date);
    expect(events[0]!.at.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(events[0]!.newState).toBe('on');
  });

  it('clamps a future event time to the receive time', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState((e) => events.push(e));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    const before = Date.now();
    c.ws.send(JSON.stringify({ type: 'state', entityId: 'a', oldState: null, newState: 'on', at: '2999-01-01T00:00:00.000Z' }));
    await until(() => events.length === 1);
    expect(events[0]!.at.getTime()).toBeGreaterThanOrEqual(before);
    expect(events[0]!.at.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a state with a non-ISO timestamp', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState((e) => events.push(e));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    c.ws.send(JSON.stringify({ type: 'state', entityId: 'a', oldState: null, newState: 'on', at: 'yesterday' }));
    c.ws.send(JSON.stringify({ type: 'state', entityId: 'a', oldState: null, newState: 'on', at: '2026-01-01T10:00:00.000Z' }));
    await until(() => events.length === 1);
    expect(events[0]!.at.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('notification actions reach onNotificationAction', async () => {
    await setup();
    const actions: string[] = [];
    hub.onNotificationAction((a) => actions.push(a));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    c.ws.send(JSON.stringify({ type: 'notification_action', action: 'CUEST_DONE', at: '2026-01-01T10:00:00.000Z' }));
    await until(() => actions.length === 1);
    expect(actions[0]).toBe('CUEST_DONE');
  });

  it('state before hello never reaches handlers', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState((e) => events.push(e));
    const c = await connect(null);
    c.ws.send(
      JSON.stringify({ type: 'state', entityId: 'a', oldState: null, newState: 'on', at: '2026-01-01T10:00:00.000Z' }),
    );
    expect(await c.closed).toBe(4001);
    expect(events).toHaveLength(0);
  });

  it('callService while disconnected returns false and does not throw', async () => {
    await setup();
    expect(hub.callService('light', 'turn_on', {})).toBe(false);
  });

  it('callService sends a call_service message when connected', async () => {
    await setup();
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    expect(hub.callService('light', 'turn_on', { a: 1 }, { entity_id: 'light.x' })).toBe(true);
    await until(() => c.messages.length >= 3);
    expect(c.messages[2]).toMatchObject({
      type: 'call_service',
      domain: 'light',
      service: 'turn_on',
      data: { a: 1 },
      target: { entity_id: 'light.x' },
    });
    expect(typeof c.messages[2]!.id).toBe('string');
  });

  it('a rejected socket cannot authenticate with a later hello', async () => {
    await setup();
    const good = await connect(SECRET);
    await until(() => good.messages.length >= 1);
    const bad = await connect(null);
    bad.ws.send(JSON.stringify({ type: 'hello', secret: 'wrong-wrong', version: '1' }));
    bad.ws.send(JSON.stringify({ type: 'hello', secret: SECRET, version: '1' }));
    expect(await bad.closed).toBe(4001);
    expect(bad.messages.some((m) => m.type === 'welcome')).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(good.ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.isConnected()).toBe(true);
  });

  it('a throwing handler does not stop others or drop the connection', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState(() => {
      throw new Error('boom');
    });
    hub.onState((e) => events.push(e));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    c.ws.send(
      JSON.stringify({ type: 'state', entityId: 'a', oldState: null, newState: 'on', at: '2026-01-01T10:00:00.000Z' }),
    );
    await until(() => events.length === 1);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('constructor rejects an empty secret', () => {
    expect(() => new BridgeHub({ secret: '', log: () => {} })).toThrow();
  });

  it('garbage after auth is ignored', async () => {
    await setup();
    const events: StateEvent[] = [];
    hub.onState((e) => events.push(e));
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 1);
    c.ws.send('not json');
    c.ws.send(JSON.stringify({ type: 'bogus' }));
    c.ws.send(
      JSON.stringify({ type: 'state', entityId: 'a', oldState: 'off', newState: 'on', at: '2026-01-01T10:00:00.000Z' }),
    );
    await until(() => events.length === 1);
    expect(hub.isConnected()).toBe(true);
  });
});

describe('bridge hub auth timeout', () => {
  it('closes with 4001 when no hello arrives within 5s, and clears the timer on auth', () => {
    vi.useFakeTimers();
    try {
      const h = new BridgeHub({ secret: SECRET, log: () => {} });
      const sent: string[] = [];
      const closes: number[] = [];
      const fake = {
        send: (d: string) => void sent.push(d),
        close: (c?: number) => void closes.push(c ?? 0),
        on: () => {},
      };
      h.attach(fake);
      vi.advanceTimersByTime(5001);
      expect(closes).toEqual([4001]);
      expect(JSON.parse(sent[0]!)).toMatchObject({ type: 'error' });

      const handlers: Record<string, (...a: unknown[]) => void> = {};
      const ok = {
        send: () => {},
        close: (c?: number) => void closes.push(c ?? 0),
        on: (ev: string, fn: (...a: unknown[]) => void) => void (handlers[ev] = fn),
      };
      h.attach(ok);
      handlers.message!(JSON.stringify({ type: 'hello', secret: SECRET, version: '1' }));
      vi.advanceTimersByTime(10000);
      expect(closes).toEqual([4001]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

const ent = (entityId: string): Record<string, unknown> => ({
  entityId, domain: 'sensor', deviceId: null, deviceClass: null, platform: null, translationKey: null,
  options: null, unit: null, name: null, deviceName: null, manufacturer: null, model: null, state: null,
});

describe('bridge protocol extensions', () => {
  it('entities chunks are joined and delivered once', async () => {
    await setup();
    const got: unknown[][] = [];
    hub.onEntities((e) => got.push(e));
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'entities', chunk: 0, last: false, entities: [ent('sensor.a')] }));
    c.ws.send(JSON.stringify({ type: 'entities', chunk: 1, last: true, entities: [ent('sensor.b')] }));
    await until(() => got.length >= 1);
    expect(got).toHaveLength(1);
    expect(got[0]!.map((e) => (e as { entityId: string }).entityId)).toEqual(['sensor.a', 'sensor.b']);
  });

  it('a non-zero first chunk without a set in progress is ignored', async () => {
    await setup();
    const got: unknown[][] = [];
    hub.onEntities((e) => got.push(e));
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'entities', chunk: 1, last: true, entities: [ent('sensor.b')] }));
    c.ws.send(JSON.stringify({ type: 'entities', chunk: 0, last: true, entities: [ent('sensor.a')] }));
    await until(() => got.length >= 1);
    expect(got).toHaveLength(1);
    expect(got[0]!.map((e) => (e as { entityId: string }).entityId)).toEqual(['sensor.a']);
  });

  it('api request is answered via the handler', async () => {
    await setup();
    hub.setApiHandler(async (req) => ({ status: 200, body: { path: req.path, method: req.method } }));
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'api', id: 'r1', method: 'GET', path: '/api/players' }));
    await until(() => c.messages.some((m) => m.type === 'api_result'));
    expect(c.messages.find((m) => m.type === 'api_result')).toEqual({
      type: 'api_result', id: 'r1', status: 200, body: { path: '/api/players', method: 'GET' },
    });
  });

  it('api path outside /api is refused with 400', async () => {
    await setup();
    const handler = vi.fn(async () => ({ status: 200, body: null }));
    hub.setApiHandler(handler);
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'api', id: 'r2', method: 'GET', path: '/bridge' }));
    await until(() => c.messages.some((m) => m.type === 'api_result'));
    expect(c.messages.find((m) => m.type === 'api_result')).toMatchObject({ id: 'r2', status: 400 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handler throwing gives 500 and keeps the socket open', async () => {
    await setup();
    hub.setApiHandler(async () => {
      throw new Error('boom');
    });
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'api', id: 'r3', method: 'POST', path: '/api/x', body: {} }));
    await until(() => c.messages.some((m) => m.type === 'api_result'));
    expect(c.messages.find((m) => m.type === 'api_result')).toMatchObject({ id: 'r3', status: 500 });
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.isConnected()).toBe(true);
  });

  it('send returns false when no bridge', async () => {
    await setup();
    expect(hub.send({ type: 'snapshot', players: [], quests: [] })).toBe(false);
  });

  it('send delivers to the active bridge and onAuthenticated fires', async () => {
    await setup();
    const auth = vi.fn();
    hub.onAuthenticated(auth);
    const c = await connect(SECRET);
    await until(() => c.messages.length >= 2);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(hub.send({ type: 'fire_event', event: 'cuest_level_up', data: { a: 1 } })).toBe(true);
    await until(() => c.messages.some((m) => m.type === 'fire_event'));
  });
});

describe('bridge security', () => {
  it.each(['/api/../bridge', '/api/%2e%2e/bridge', '/api/%2E%2E/bridge', '/api/x\\..\\bridge', '/api/x\u0000y'])(
    'unsafe api path %j is refused with 400',
    async (path) => {
      await setup();
      const handler = vi.fn(async () => ({ status: 200, body: null }));
      hub.setApiHandler(handler);
      const c = await connect(SECRET);
      c.ws.send(JSON.stringify({ type: 'api', id: 'p', method: 'GET', path }));
      await until(() => c.messages.some((m) => m.type === 'api_result'));
      expect(c.messages.find((m) => m.type === 'api_result')).toMatchObject({ id: 'p', status: 400 });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('api path with a query string is accepted', async () => {
    await setup();
    hub.setApiHandler(async (req) => ({ status: 200, body: req.path }));
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'api', id: 'q', method: 'GET', path: '/api/players?x=1' }));
    await until(() => c.messages.some((m) => m.type === 'api_result'));
    expect(c.messages.find((m) => m.type === 'api_result')).toMatchObject({ status: 200, body: '/api/players?x=1' });
  });

  it('api and entities before hello are rejected and never delivered', async () => {
    await setup();
    const handler = vi.fn(async () => ({ status: 200, body: null }));
    const onEnt = vi.fn();
    hub.setApiHandler(handler);
    hub.onEntities(onEnt);
    for (const msg of [
      { type: 'api', id: 'x', method: 'GET', path: '/api/players' },
      { type: 'entities', chunk: 0, last: true, entities: [ent('sensor.a')] },
    ]) {
      const c = await connect(null);
      c.ws.send(JSON.stringify(msg));
      expect(await c.closed).toBe(4001);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(onEnt).not.toHaveBeenCalled();
  });

  it('api_result is dropped when the socket was replaced while the handler ran', async () => {
    await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    hub.setApiHandler(async () => {
      await gate;
      return { status: 200, body: 1 };
    });
    const a = await connect(SECRET);
    await until(() => a.messages.length >= 2);
    a.ws.send(JSON.stringify({ type: 'api', id: 's', method: 'GET', path: '/api/players' }));
    await new Promise((r) => setTimeout(r, 50));
    const b = await connect(SECRET);
    await until(() => b.messages.length >= 2);
    release();
    await new Promise((r) => setTimeout(r, 100));
    expect(a.messages.some((m) => m.type === 'api_result')).toBe(false);
    expect(b.messages.some((m) => m.type === 'api_result')).toBe(false);
  });

  it('api_result is dropped when the socket closed while the handler ran', async () => {
    await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    hub.setApiHandler(async () => {
      await gate;
      return { status: 200, body: 1 };
    });
    const a = await connect(SECRET);
    await until(() => a.messages.length >= 2);
    a.ws.send(JSON.stringify({ type: 'api', id: 's', method: 'GET', path: '/api/players' }));
    await new Promise((r) => setTimeout(r, 50));
    a.ws.close();
    await a.closed;
    await until(() => !hub.isConnected());
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(a.messages.some((m) => m.type === 'api_result')).toBe(false);
  });

  it('a replaced socket api and entities messages are ignored', async () => {
    const h = new BridgeHub({ secret: SECRET, log: () => {} });
    const handler = vi.fn(async () => ({ status: 200, body: null }));
    const onEnt = vi.fn();
    h.setApiHandler(handler);
    h.onEntities(onEnt);
    const mk = (): { sock: Parameters<BridgeHub['attach']>[0]; emit: (m: unknown) => void; sent: unknown[] } => {
      let onMsg: (raw: string) => void = () => {};
      const sent: unknown[] = [];
      const sock = {
        send: (d: string) => void sent.push(JSON.parse(d)),
        close: () => {},
        on: (ev: string, fn: (...a: never[]) => void) => {
          if (ev === 'message') onMsg = fn as unknown as (raw: string) => void;
        },
      };
      return { sock, emit: (m) => onMsg(JSON.stringify(m)), sent };
    };
    const a = mk();
    const b = mk();
    h.attach(a.sock);
    a.emit({ type: 'hello', secret: SECRET, version: '1' });
    h.attach(b.sock);
    b.emit({ type: 'hello', secret: SECRET, version: '1' });
    a.emit({ type: 'api', id: 'o', method: 'GET', path: '/api/players' });
    a.emit({ type: 'entities', chunk: 0, last: true, entities: [ent('sensor.a')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).not.toHaveBeenCalled();
    expect(onEnt).not.toHaveBeenCalled();
    expect(a.sent.some((m) => (m as { type: string }).type === 'api_result')).toBe(false);
  });

  it('unserializable api body gives a 500 api_result', async () => {
    await setup();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    hub.setApiHandler(async () => ({ status: 200, body: cyc }));
    const c = await connect(SECRET);
    c.ws.send(JSON.stringify({ type: 'api', id: 'u', method: 'GET', path: '/api/x' }));
    await until(() => c.messages.some((m) => m.type === 'api_result'));
    expect(c.messages.find((m) => m.type === 'api_result')).toEqual({
      type: 'api_result', id: 'u', status: 500, body: { error: 'unserializable' },
    });
  });
});
