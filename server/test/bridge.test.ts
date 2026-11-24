import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BridgeHub } from '../src/bridge/hub.js';
import { registerBridgeRoute } from '../src/routes/bridge.js';
import type { StateEvent } from '../src/domain/types.js';

const SECRET = 'correct-horse';
let app: FastifyInstance;
let hub: BridgeHub;
let port: number;
const sockets: WebSocket[] = [];

async function setup(): Promise<void> {
  hub = new BridgeHub({ secret: SECRET, log: () => {} });
  app = await buildApp({ bridgeConnected: () => hub.isConnected() });
  await registerBridgeRoute(app, hub);
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
