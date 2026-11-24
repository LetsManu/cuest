import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import '../../src/arcane/stamina';

const TAG = 'cuest-stamina-card';
const root = (el: HTMLElement) => el.shadowRoot!;
const B = (v: string, extra: Record<string, unknown> = {}) => st(v, { device_class: 'battery', unit_of_measurement: '%', ...extra });
const rows = (el: HTMLElement) => Array.from(root(el).querySelectorAll('.stamina-row'));
const colour = (s: Element) => ((s as HTMLElement).style.background || '').toLowerCase();
const isColour = (s: Element, hex: string) => {
  const c = colour(s);
  const n = parseInt(hex.slice(1), 16);
  return c === hex.toLowerCase() || c === `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

function house() {
  return fakeHass({
    states: {
      'sensor.a_battery': B('0', { friendly_name: 'A Battery' }),
      'sensor.b_battery': B('14', { friendly_name: 'B Battery' }),
      'sensor.c_battery': B('40', { friendly_name: 'C Battery' }),
      'sensor.d_battery': B('100', { friendly_name: 'D Battery' }),
      'sensor.e_battery': B('unknown', { friendly_name: 'E Battery' }),
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stamina card', () => {
  it('lists batteries lowest first with a title', async () => {
    const el = await mount(TAG, {}, house());
    expect(text(el)).toContain('Stamina');
    expect(rows(el).map((r) => r.querySelector('.name')!.textContent)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows(el).map((r) => r.querySelector('.pct')!.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['0 %', '14 %', '40 %', '100 %']);
    expect(rows(el)[0].querySelector('.pct .num')!.textContent).toBe('0');
    expectClean(el);
  });

  it('fills ceil(pct/20) segments with the right colours', async () => {
    const el = await mount(TAG, {}, house());
    const segs = (i: number) => Array.from(rows(el)[i].querySelectorAll('.seg'));
    expect(segs(0)).toHaveLength(5);
    expect(segs(0).filter((s) => !isColour(s, '#2C3256'))).toHaveLength(0);
    const b = segs(1);
    expect(isColour(b[0], '#FF8A7A')).toBe(true);
    expect(b.slice(1).every((s) => isColour(s, '#2C3256'))).toBe(true);
    expect(b[0].classList.contains('pulse')).toBe(true);
    const c = segs(2);
    expect(c.slice(0, 2).every((s) => isColour(s, '#7FD17E'))).toBe(true);
    expect(c.slice(2).every((s) => isColour(s, '#2C3256'))).toBe(true);
    expect(root(el).querySelectorAll('.pulse')).toHaveLength(2); // the 0 % and 14 % rows
    expect(segs(3).every((s) => isColour(s, '#7FD17E'))).toBe(true);
  });

  it('threshold: low at exactly the threshold, ok one over; 0 % pulses too', async () => {
    const h = fakeHass({ states: { 'sensor.x_battery': B('20', { friendly_name: 'x Battery' }), 'sensor.y_battery': B('21', { friendly_name: 'y Battery' }), 'sensor.z_battery': B('0', { friendly_name: 'z Battery' }) } });
    const el = await mount(TAG, {}, h);
    const first = (name: string) => rows(el).find((r) => r.querySelector('.name')!.textContent === name)!.querySelector('.seg')!;
    expect(isColour(first("x"), "#FF8A7A")).toBe(true);
    expect(first('x').classList.contains('pulse')).toBe(true);
    expect(isColour(first('y'), '#7FD17E')).toBe(true);
    expect(first('y').classList.contains('pulse')).toBe(false);
    expect(first('z').classList.contains('pulse')).toBe(true);
    const own = await mount(TAG, { threshold: 21 }, h);
    const f2 = rows(own).find((r) => r.querySelector('.name')!.textContent === 'y')!.querySelector('.seg')!;
    expect(isColour(f2, '#FF8A7A')).toBe(true);
  });

  it('meter semantics with a real label', async () => {
    const el = await mount(TAG, {}, house());
    const m = rows(el)[1];
    expect(m.getAttribute('role')).toBe('meter');
    expect(m.getAttribute('aria-valuenow')).toBe('14');
    expect(m.getAttribute('aria-valuemin')).toBe('0');
    expect(m.getAttribute('aria-valuemax')).toBe('100');
    expect(m.getAttribute('aria-label')).toBe('B battery 14 percent');
  });

  it('limit shows that many rows; default 8', async () => {
    const el = await mount(TAG, { limit: 2 }, house());
    expect(rows(el)).toHaveLength(2);
    const states: Record<string, ReturnType<typeof st>> = {};
    for (let i = 0; i < 10; i++) states[`sensor.n${i}_battery`] = B(String(10 * i));
    const many = await mount(TAG, {}, fakeHass({ states }));
    expect(rows(many)).toHaveLength(8);
  });

  it('skips unknown and unavailable states; nothing left shows the resting copy', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: { 'sensor.q_battery': B('unknown'), 'sensor.r_battery': B('unavailable') } }));
    expect(rows(el)).toHaveLength(0);
    expect(text(el)).toContain('Every battery is full of stamina.');
    expectClean(el);
  });

  it('entities restricts and exclude removes', async () => {
    const only = await mount(TAG, { entities: ['sensor.a_battery'] }, house());
    expect(rows(only)).toHaveLength(1);
    const ex = await mount(TAG, { exclude: ['sensor.a_*'] }, house());
    expect(rows(ex).map((r) => r.querySelector('.name')!.textContent)).toEqual(['B', 'C', 'D']);
  });

  it('clamps out-of-range readings and rounds the label', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: { 'sensor.h_battery': B('130', { friendly_name: 'h Battery' }), 'sensor.l_battery': B('-5', { friendly_name: 'l Battery' }), 'sensor.m_battery': B('33.6', { friendly_name: 'm Battery' }) } }));
    const labels = rows(el).map((r) => r.getAttribute('aria-label'));
    expect(labels).toEqual(['l battery 0 percent', 'm battery 34 percent', 'h battery 100 percent']);
    expect(rows(el)[2].querySelectorAll('.seg')).toHaveLength(5);
    expectClean(el);
  });

  it('custom title, heading text, no div in span', async () => {
    const el = await mount(TAG, { title: 'Kraft' }, house());
    expect(root(el).querySelector('h2')!.textContent).toBe('Kraft');
    expect(root(el).querySelectorAll('span div')).toHaveLength(0);
  });

  it('row, name and percent widths follow the design by rule', async () => {
    await mount(TAG, {}, house());
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    expect(/\.name\s*\{[^}]*width:\s*120px/.test(css)).toBe(true);
    expect(/\.pct\s*\{[^}]*width:\s*40px/.test(css)).toBe(true);
    expect(/\.pct\s*\{[^}]*white-space:\s*nowrap/.test(css)).toBe(true);
    expect(/\.seg\s*\{[^}]*height:\s*12px/.test(css)).toBe(true);
  });

  it('rejects bad config, stub and grid', async () => {
    const el = await mount<{ getGridOptions(): unknown; getCardSize(): number }>(TAG, {}, house());
    const bad = (c: unknown) => () => (document.createElement(TAG) as unknown as { setConfig(c: unknown): void }).setConfig(c);
    expect(bad({ limit: 0 })).toThrow(/cuest-stamina-card: "limit"/);
    expect(bad({ threshold: 'x' })).toThrow(/"threshold" must be a number/);
    expect(bad({ entities: 'x' })).toThrow(/"entities" must be a list/);
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    expect(el.getCardSize()).toBe(5);
    expect((customElements.get(TAG) as unknown as { getStubConfig(): object }).getStubConfig()).toEqual({});
  });
});
