import { afterEach, describe, expect, it } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import '../../src/arcane/allies';

const TAG = 'cuest-allies-card';
const root = (el: HTMLElement) => el.shadowRoot!;

/** Builds `total` entities for a platform, `down` of them unavailable. */
function ally(states: Record<string, ReturnType<typeof st>>, entities: Record<string, { platform: string }>, platform: string, total: number, down: number) {
  for (let i = 0; i < total; i++) {
    const id = `sensor.${platform}_${i}`;
    states[id] = st(i < down ? 'unavailable' : '1');
    entities[id] = { platform };
  }
}

function house(extra?: (s: Record<string, ReturnType<typeof st>>, e: Record<string, { platform: string }>) => void) {
  const states: Record<string, ReturnType<typeof st>> = {};
  const entities: Record<string, { platform: string }> = {};
  ally(states, entities, 'fritz', 122, 122);
  ally(states, entities, 'music_assistant', 8, 6);
  ally(states, entities, 'hue', 20, 0);
  extra?.(states, entities);
  return fakeHass({ states, entities });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('allies card', () => {
  it('renders rows with names, bars and counts', async () => {
    const el = await mount(TAG, {}, house());
    expect(text(el)).toContain('Resting allies');
    const rows = Array.from(root(el).querySelectorAll('.ally'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('FRITZ!Box');
    expect(rows[0].textContent).toContain('0 of 122');
    const f0 = rows[0].querySelector<HTMLElement>('.fill')!;
    expect(f0.style.width).toBe('4%');
    expect(f0.style.background).toMatch(/#FFB27A|rgb\(255, 178, 122\)/i);
    expect(rows[1].textContent).toContain('Music Assistant');
    expect(rows[1].textContent).toContain('2 of 8');
    const f1 = rows[1].querySelector<HTMLElement>('.fill')!;
    expect(f1.style.width).toBe('25%');
    expect(f1.style.background).toMatch(/#8FDCFF|rgb\(143, 220, 255\)/i);
    expect(rows[0].querySelector('.num')).toBeTruthy();
    expectClean(el);
  });

  it('limits rows, expands in place and uses the singular', async () => {
    const h = house((s, e) => ally(s, e, 'tuya', 4, 4));
    const el = await mount(TAG, { limit: 2 }, h);
    expect(root(el).querySelectorAll('.ally')).toHaveLength(2);
    const more = Array.from(root(el).querySelectorAll('button')).find((b) => b.textContent!.trim() === '+ 1 more ally')!;
    expect(more).toBeTruthy();
    expect(text(el)).not.toContain('1 more allies');
    more.click();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(root(el).querySelectorAll('.ally')).toHaveLength(3);
    expect(root(el).querySelector('button')).toBeNull();
  });

  it('uses the plural for several hidden allies', async () => {
    const h = house((s, e) => {
      ally(s, e, 'tuya', 4, 4);
      ally(s, e, 'smartthings', 4, 4);
    });
    const el = await mount(TAG, { limit: 2 }, h);
    expect(text(el)).toContain('+ 2 more allies');
  });

  it('shows the well-done line with no allies resting', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: {}, entities: {} }));
    expect(text(el)).toContain('All allies are awake.');
    expect(root(el).querySelectorAll('.ally')).toHaveLength(0);
  });

  it('honours ignore, min_entities and names', async () => {
    const el = await mount(TAG, { ignore: ['fritz'], names: { music_assistant: 'Jukebox' } }, house());
    expect(text(el)).toContain('Jukebox');
    expect(text(el)).not.toContain('FRITZ!Box');
    const big = await mount(TAG, { min_entities: 10 }, house());
    expect(text(big)).not.toContain('Music Assistant');
  });

  it('never uses shame words', async () => {
    const el = await mount(TAG, {}, house());
    expect(text(el)).not.toMatch(/broken|offline|error|fault|dead|failed/i);
  });

  it('validates config', () => {
    const el = document.createElement(TAG) as HTMLElement & { setConfig(c: unknown): void };
    expect(() => el.setConfig({ limit: 0 })).toThrow(/cuest-allies-card: "limit"/);
    expect(() => el.setConfig({ ignore: 'x' })).toThrow(/ignore/);
  });

  it('reports grid and stub', async () => {
    const el = await mount<{ getGridOptions(): object }>(TAG, {}, house());
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    const ctor = customElements.get(TAG) as unknown as { getStubConfig(): object };
    expect(ctor.getStubConfig()).toEqual({});
  });

  it('gives the more button a 44px min-height rule and the class', async () => {
    const h = house();
    const el = await mount(TAG, { limit: 1 }, h);
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    const rule = /(?:^|[}\s,])\.more\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
    expect(Number(rule![1])).toBeGreaterThanOrEqual(44);
    expect(root(el).querySelector('button')!.classList.contains('more')).toBe(true);
  });
});
