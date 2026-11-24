import { vi, type Mock } from 'vitest';
import type { HassArea, HassDevice, HassEntity, HassState, HomeAssistant } from '../../src/hass-types';

export function st(state: string, attributes: Record<string, unknown> = {}): HassState {
  return { state, last_changed: '2026-11-24T10:00:00+00:00', attributes };
}

export interface FakeHassOptions {
  states?: Record<string, HassState>;
  entities?: Record<string, HassEntity>;
  devices?: Record<string, HassDevice>;
  areas?: Record<string, HassArea>;
  user?: { id: string; is_admin: boolean };
  history?: Record<string, { s: string; lu: number }[]>;
  language?: string;
}

export type FakeHass = HomeAssistant & { callWS: Mock; callService: Mock; callApi: Mock };

export function fakeHass(o: FakeHassOptions = {}): FakeHass {
  const history = o.history ?? {};
  const callWS = vi.fn(async (msg: Record<string, unknown>) => {
    if (msg.type === 'history/history_during_period') {
      const ids = (msg.entity_ids as string[] | undefined) ?? [];
      const out: Record<string, { s: string; lu: number }[]> = {};
      for (const id of ids) if (history[id]) out[id] = history[id];
      return out;
    }
    return undefined;
  });
  return {
    states: o.states ?? {},
    entities: o.entities,
    devices: o.devices,
    areas: o.areas,
    user: o.user,
    locale: { language: o.language ?? 'en' },
    callWS,
    callService: vi.fn(async () => undefined),
    callApi: vi.fn(async () => undefined),
  } as unknown as FakeHass;
}

export async function mount<T>(tag: string, config: object, hass: HomeAssistant): Promise<T & HTMLElement> {
  const el = document.createElement(tag) as unknown as HTMLElement & {
    setConfig(c: unknown): void;
    hass: HomeAssistant;
    updateComplete: Promise<boolean>;
  };
  el.setConfig(config);
  el.hass = hass;
  document.body.appendChild(el);
  await el.updateComplete;
  return el as unknown as T & HTMLElement;
}

export function text(el: HTMLElement): string {
  return (el.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Fails when the card shows NaN / undefined / null as text or in any attribute. */
export function expectClean(el: HTMLElement): void {
  const bad = /\b(NaN|undefined|null)\b/;
  const t = text(el);
  if (bad.test(t)) throw new Error(`rendered text contains NaN/undefined/null: ${t}`);
  const walk = (n: Element): void => {
    for (const a of Array.from(n.attributes)) {
      if (bad.test(a.value)) throw new Error(`attribute ${a.name}="${a.value}" on <${n.localName}> contains NaN/undefined/null`);
    }
    for (const c of Array.from(n.children)) walk(c);
  };
  if (el.shadowRoot) for (const c of Array.from(el.shadowRoot.children)) walk(c);
}
