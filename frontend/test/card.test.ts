import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/cuest-card';
import type { HomeAssistant } from '../src/hass-types';

function fakeHass(over: Partial<HomeAssistant> = {}, items: unknown[] = []): HomeAssistant {
  const attrs = { cuest_player_id: 'p1', ha_person: 'person.ada' };
  return {
    states: {
      'sensor.cuest_ada_level': {
        state: '4',
        last_changed: 't',
        attributes: { ...attrs, cuest_kind: 'level', player_name: 'Ada', title: 'Hearthkeeper', into_level: 340, to_next: 400, outfit_palette: { G: '#B5523B' }, decor: ['lantern'] },
      },
      'sensor.cuest_ada_gold': { state: '15', last_changed: 't', attributes: { ...attrs, cuest_kind: 'gold' } },
      'todo.cuest_quests': { state: String(items.length), last_changed: 't', attributes: {} },
    },
    entities: {
      'sensor.cuest_ada_level': { platform: 'cuest' },
      'sensor.cuest_ada_gold': { platform: 'cuest' },
      'todo.cuest_quests': { platform: 'cuest' },
    },
    callWS: vi.fn().mockResolvedValue({ items }),
    callService: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as HomeAssistant;
}

async function mount(hass: HomeAssistant) {
  const el = document.createElement('cuest-card') as any;
  el.setConfig({});
  document.body.appendChild(el);
  el.hass = hass;
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

describe('cuest-card', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders player name and level', async () => {
    const el = await mount(fakeHass());
    const text = el.shadowRoot.textContent;
    expect(text).toContain('Ada');
    expect(text).toContain('Level 4');
    expect(text).toContain('15 gold');
    expect(text).toContain('No open quests');
  });

  it('shows remaining XP and a bar of into/to_next (mid-level)', async () => {
    const el = await mount(fakeHass());
    expect(el.shadowRoot.textContent).toContain('60 XP to next level');
    expect(el.shadowRoot.querySelector('.fill').getAttribute('style')).toContain('width:85%');
  });

  it('shows the full cost and an empty bar at a level boundary', async () => {
    const h = fakeHass();
    const a = (h.states['sensor.cuest_ada_level'] as any).attributes;
    a.into_level = 0; a.to_next = 400;
    const el = await mount(h);
    expect(el.shadowRoot.textContent).toContain('400 XP to next level');
    expect(el.shadowRoot.querySelector('.fill').getAttribute('style')).toContain('width:0%');
  });

  it('escapes quest titles', async () => {
    const el = await mount(fakeHass({}, [{ uid: 'q1', summary: '<img src=x onerror=alert(1)>', status: 'needs_action' }]));
    expect(el.shadowRoot.querySelector('img')).toBeNull();
    expect(el.shadowRoot.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('calls complete_quest on Done', async () => {
    const hass = fakeHass({}, [{ uid: 'q1', summary: 'Dishes', status: 'needs_action' }]);
    const el = await mount(hass);
    el.shadowRoot.querySelector('button').click();
    expect(hass.callService).toHaveBeenCalledWith('cuest', 'complete_quest', { quest_id: 'q1' });
  });

  it('shows the not-ready state with no players', async () => {
    const el = await mount({ states: {}, entities: {}, callWS: vi.fn(), callService: vi.fn() } as unknown as HomeAssistant);
    expect(el.shadowRoot.textContent).toContain('not ready yet');
  });

  it('registers once in customCards', () => {
    const n = (window as any).customCards.filter((c: any) => c.type === 'cuest-card').length;
    expect(n).toBe(1);
  });
});
