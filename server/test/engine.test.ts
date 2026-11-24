import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { FakeClock } from '../src/clock.js';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { createEngine } from '../src/engine.js';

type Engine = Awaited<ReturnType<typeof createEngine>>;
let engine: Engine | undefined;
let ws: WebSocket | undefined;

afterEach(async () => {
  ws?.close();
  await engine?.app.close();
});

const config: Config = { port: 0, dataDir: ':memory:', bridgeSecret: 'sekrit', tz: 'UTC', tickSeconds: 30 };

describe('engine', () => {
  it('end-to-end washer flow through a fake bridge', async () => {
    const clock = new FakeClock(new Date('2026-03-02T12:00:00Z'));
    const db = openDb(':memory:');
    migrate(db);
    engine = await createEngine({ db, clock, config, log: () => {} });
    const { app } = engine;

    const player = (
      await app.inject({ method: 'POST', url: '/api/players', payload: { name: 'Ana', notifyService: 'mobile_app_ana' } })
    ).json();
    const preset = await app.inject({
      method: 'POST',
      url: '/api/templates/presets',
      payload: { preset: 'washer_power', entityId: 'sensor.washer_power' },
    });
    expect(preset.statusCode).toBe(201);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`);
    const received: any[] = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws!.on('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', secret: 'sekrit', version: '1' }));

    const waitFor = async (pred: (m: any) => boolean): Promise<any> => {
      for (let i = 0; i < 100; i++) {
        const m = received.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timeout; got ${JSON.stringify(received)}`);
    };

    const sub = await waitFor((m) => m.type === 'subscribe' && m.entities.includes('sensor.washer_power'));
    expect(sub.entities).toContain('sensor.washer_power');

    const send = (oldState: string, newState: string): void =>
      ws!.send(
        JSON.stringify({ type: 'state', entityId: 'sensor.washer_power', oldState, newState, at: clock.now().toISOString() }),
      );
    send('0', '1800');
    await new Promise((r) => setTimeout(r, 50));
    send('1800', '2');
    await new Promise((r) => setTimeout(r, 50));
    clock.advance(3);
    engine.tick();

    const call = await waitFor((m) => m.type === 'call_service' && m.domain === 'notify');
    expect(call.service).toBe('mobile_app_ana');
    const start = call.data.data.actions.find((a: any) => a.action.startsWith('CUEST|START|'));
    ws.send(JSON.stringify({ type: 'notification_action', action: start.action, at: clock.now().toISOString() }));

    let active: any[] = [];
    for (let i = 0; i < 100; i++) {
      active = (await app.inject({ method: 'GET', url: '/api/quests' })).json().active;
      if (active.length > 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: 'active', claimedBy: player.id });
  });

  it('tick keeps going when one step throws', async () => {
    const logs: string[] = [];
    const db = openDb(':memory:');
    migrate(db);
    engine = await createEngine({ db, clock: new FakeClock(new Date('2026-03-02T12:00:00Z')), config, log: (m) => logs.push(m) });
    db.exec('DROP TABLE quest_templates');
    expect(() => engine!.tick()).not.toThrow();
    expect(logs.length).toBeGreaterThan(0);
  });
});
