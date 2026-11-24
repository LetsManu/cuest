import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestHeroCard } from '../../src/arcane/hero';
import '../../src/arcane/hero';

const TAG = 'cuest-hero-card';
const root = (el: HTMLElement) => el.shadowRoot!;

function house(opts: { streak?: string; keys?: number; into?: number; toNext?: number } = {}) {
  const pl = (pid: string, person: string, name: string, level: string, title: string, into: number, toNext: number, streak: string, keys: number) => ({
    [`sensor.${pid}_level`]: st(level, { cuest_kind: 'level', cuest_player_id: pid, ha_person: person, player_name: name, title, into_level: into, to_next: toNext }),
    [`sensor.${pid}_streak`]: st(streak, { cuest_kind: 'streak', cuest_player_id: pid, ha_person: person, chest_keys: keys }),
  });
  const states = {
    ...pl('p1', 'person.ann', 'Ann', '4', 'Hearthkeeper', opts.into ?? 340, opts.toNext ?? 400, opts.streak ?? '6', opts.keys ?? 2),
    ...pl('p2', 'person.ben', 'Ben', '2', 'Squire', 10, 100, '1', 0),
    'person.ann': st('home', { user_id: 'u-ann' }),
    'person.ben': st('home', { user_id: 'u-ben' }),
  };
  const entities = Object.fromEntries(Object.keys(states).filter((k) => k.startsWith('sensor.')).map((k) => [k, { platform: 'cuest' }]));
  return { states, entities };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('hero card', () => {
  it('shows level, streak, remaining XP and keys', async () => {
    const el = await mount(TAG, {}, fakeHass(house()));
    expect(text(el)).toContain('Lv 4 Hearthkeeper');
    expect(text(el)).toContain('6-day streak');
    expect(text(el)).toContain('60 XP to level 5 · 2 chest keys');
    const bar = root(el).querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('85');
    expect(root(el).querySelector<HTMLElement>('.fill')!.style.width).toBe('85%');
    expect(root(el).querySelector('.shimmer')).toBeTruthy();
    expectClean(el);
  });

  it('uses the singular for one key and hides keys at zero', async () => {
    const one = await mount(TAG, {}, fakeHass(house({ keys: 1 })));
    expect(text(one)).toContain('60 XP to level 5 · 1 chest key');
    expect(text(one)).not.toContain('1 chest keys');
    const none = await mount(TAG, {}, fakeHass(house({ keys: 0 })));
    expect(text(none)).toContain('60 XP to level 5');
    expect(text(none)).not.toContain('chest key');
  });

  it('hides the streak at zero', async () => {
    const el = await mount(TAG, {}, fakeHass(house({ streak: '0' })));
    expect(text(el)).not.toContain('streak');
  });

  it('keeps the bar empty when the level span is zero', async () => {
    const el = await mount(TAG, {}, fakeHass(house({ into: 0, toNext: 0 })));
    expect(root(el).querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    expectClean(el);
  });

  it('asks the player to set Cuest up when there is no hero', async () => {
    const el = await mount(TAG, {}, fakeHass());
    expect(text(el)).toContain('Your hero is not here yet. Set up Cuest first.');
    expect(root(el).querySelector('[role="progressbar"]')).toBeNull();
  });

  it('picks the configured player, then the signed-in user', async () => {
    const h = house();
    const ben = await mount(TAG, { player: 'p2' }, fakeHass(h));
    expect(text(ben)).toContain('Lv 2 Squire');
    const me = await mount(TAG, {}, fakeHass({ ...h, user: { id: 'u-ben', is_admin: false } }));
    expect(text(me)).toContain('Lv 2 Squire');
  });

  it('grid, size, stub and styles', () => {
    const el = document.createElement(TAG) as unknown as CuestHeroCard;
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 2 });
    expect(el.getCardSize()).toBe(2);
    expect(CuestHeroCard.getStubConfig()).toEqual({});
    const css = CuestHeroCard.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
    expect(css).toMatch(/\.bar\{[^}]*height:14px[^}]*background:#0E1124/i);
    expect(css).toMatch(/\.streak\{[^}]*color:#FFB27A/i);
    expect(css).toMatch(/\.title\{[^}]*font-size:17px/);
  });
});
