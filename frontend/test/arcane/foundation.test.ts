import { describe, expect, it, vi } from 'vitest';
import { html } from 'lit';
import { ARCANE_COPY, fill } from '../../src/arcane/copy';
import { clockLine, fmtNumber, fmtPercent, fmtTemp, num, toCelsius } from '../../src/arcane/format';
import { ArcaneCard, ConfigError, fireMoreInfo, navigate, registerCard, v } from '../../src/arcane/base';
import { ARCANE, arcaneBase, ensureFonts } from '../../src/arcane/theme';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';

describe('format', () => {
  it('formats temperatures', () => {
    expect(fmtTemp(21.46)).toBe('21.5°');
    expect(fmtTemp(23)).toBe('23°');
    expect(fmtTemp(-0.7)).toBe('-0.7°');
    expect(fmtTemp(null)).toBe('—');
  });
  it('parses numbers', () => {
    expect(num('unavailable')).toBeNull();
    expect(num('12.5')).toBe(12.5);
    expect(num('')).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num(7)).toBe(7);
  });
  it('converts Fahrenheit', () => {
    expect(toCelsius(212, '°F')).toBe(100);
    expect(toCelsius(21, '°C')).toBe(21);
  });
  it('formats numbers and percents', () => {
    expect(fmtNumber(null)).toBe('—');
    expect(fmtNumber(1.234, 'en', 2)).toBe('1.23');
    expect(fmtNumber(-0.04)).toBe('0');
    expect(fmtPercent(88)).toBe('88%');
    expect(fmtPercent(null)).toBe('—');
  });
  it('builds the clock line', () => {
    expect(clockLine(new Date(2026, 10, 24, 16, 40), 'en')).toBe('Tuesday 16:40');
  });
});

describe('copy', () => {
  it('fills placeholders', () => {
    expect(fill('{n}-day streak', { n: 6 })).toBe('6-day streak');
  });
  it('is kind and emoji free', () => {
    const bad = /\b(overdue|late|failed|missed|penalty|broken|dead|offline|error|fault)\b/i;
    const walk = (x: unknown, path: string): void => {
      if (typeof x === 'string') {
        expect(x, path).not.toMatch(bad);
        expect(x, path).not.toMatch(/\p{Extended_Pictographic}/u);
      } else {
        for (const [k, val] of Object.entries(x as object)) walk(val, `${path}.${k}`);
      }
    };
    walk(ARCANE_COPY, 'copy');
  });
});

/** Declaration body of the first top-level `.cls{...}` rule. */
function rule(css: string, cls: string): string {
  const m = new RegExp(`(?:^|[}\\s])\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for .${cls}`);
  return m[1];
}
function reducedBlock(css: string): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unterminated media block');
}

const ANIMS: Array<[string, RegExp]> = [
  ['wave', /animation:\s*wave 3\.2s linear infinite(?!\s*reverse)/],
  ['wave2', /animation:\s*wave 5s linear infinite reverse/],
  ['spin', /animation:\s*spin 18s linear infinite/],
  ['spinr', /animation:\s*spinr 9s linear infinite/],
  ['draw', /stroke-dasharray:\s*1000[^}]*animation:\s*draw 2\.4s ease-out both/],
  ['pulse', /animation:\s*pulse 2\.4s ease-in-out infinite/],
  ['star', /animation:\s*twinkle 3s ease-in-out infinite/],
  ['win', /animation:\s*flicker 4s ease-in-out infinite/],
  ['shimmer', /animation:\s*shimmer 3s ease-in-out infinite/],
  ['spark', /animation:\s*rise 3\.6s ease-in infinite/],
  ['eq', /animation:\s*eq 1\.1s ease-in-out infinite/],
  ['lit', /animation:\s*glow 3s ease-in-out infinite/],
];

describe('theme', () => {
  const css = arcaneBase.cssText;
  it('has the palette values', () => {
    expect(ARCANE.bg).toBe('#14172A');
    expect(ARCANE.goldText).toBe('#F7D27A');
  });
  it.each(ANIMS)('.%s has its animation rule', (cls, re) => {
    expect(rule(css, cls)).toMatch(re);
  });
  it('panel rules', () => {
    expect(rule(css, 'panel')).toMatch(/border-radius:\s*18px/);
    expect(css).toMatch(/\.panel\.rim\s*\{[^}]*border-color:\s*#6B5A2E/);
  });
  it('warn is a status panel', async () => {
    const el = await mount<TestCard>('cuest-test-card', {}, fakeHass({ states: {} }));
    expect(el.shadowRoot!.querySelector('.warn')?.getAttribute('role')).toBe('status');
  });
  it('shimmer slides left and draw starts at 1000', () => {
    expect(css).toMatch(/@keyframes shimmer\s*\{\s*from\s*\{\s*left:\s*-50px\s*\}\s*to\s*\{\s*left:\s*100%/);
    expect(css).toMatch(/@keyframes draw\s*\{\s*from\s*\{\s*stroke-dashoffset:\s*1000/);
    expect(rule(css, 'shimmer')).toMatch(/rgba\(255,\s*255,\s*255,\s*\.35\)/);
  });
  it('stops every animation class under reduced motion and hides spark and shimmer', () => {
    const block = reducedBlock(css);
    for (const [cls] of ANIMS) {
      expect(block, cls).toMatch(new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{[^}]*animation:\\s*none`));
    }
    expect(block).toMatch(/\.spark[^{]*\{[^}]*display:\s*none/);
    expect(block).toMatch(/\.shimmer[^{]*\{[^}]*display:\s*none/);
  });
  it('ensureFonts adds one link', () => {
    ensureFonts();
    ensureFonts();
    const links = document.head.querySelectorAll('#cuest-arcane-fonts');
    expect(links).toHaveLength(1);
    const href = (links[0] as HTMLLinkElement).href;
    expect(href).toContain('Pixelify+Sans');
    expect(href).toContain('Inter');
  });
});

const updated = vi.fn();
class TestCard extends ArcaneCard<{ hours: number; entity?: string }> {
  readonly tag = 'cuest-test-card';
  protected validate(raw: Record<string, unknown>) {
    return {
      hours: v.num(raw, 'hours', this.tag, { def: 24, min: 1, max: 168 }),
      entity: v.entity(raw, 'entity', this.tag, ['sensor']),
    };
  }
  protected entityIds(): string[] {
    return [this.config.entity ?? 'sensor.a'];
  }
  protected updated(): void {
    updated();
  }
  render() {
    const classes = ANIMS.map(([c]) => (c === 'wave2' ? 'wave2' : c));
    return html`<div class="panel rim">hello ${classes.map((c) => html`<span class=${c}></span>`)}</div>${this.missing('sensor.x')}`;
  }
}
registerCard('cuest-test-card', TestCard, { name: 'Test', description: 'Test card' });

describe('base card', () => {
  const make = () => document.createElement('cuest-test-card') as TestCard;
  it('rejects non-object config', () => {
    expect(() => make().setConfig(null)).toThrow(/cuest-test-card: config must be an object/);
    expect(() => make().setConfig([])).toThrow(ConfigError);
  });
  it('registers once', () => {
    registerCard('cuest-test-card', TestCard, { name: 'Test', description: 'Test card' });
    expect(window.customCards!.filter((c) => c.type === 'cuest-test-card')).toHaveLength(1);
    expect(window.customCards!.find((c) => c.type === 'cuest-test-card')).toMatchObject({ name: 'Test', preview: true });
  });
  it('renders classed elements and the missing panel', async () => {
    const el = await mount<TestCard>('cuest-test-card', {}, fakeHass({ states: { 'sensor.a': st('1') } }));
    for (const [cls] of ANIMS) expect(el.shadowRoot!.querySelector(`.${cls}`)?.classList.contains(cls), cls).toBe(true);
    expect(el.shadowRoot!.querySelector('.panel.rim')).not.toBeNull();
    expect(text(el)).toContain('Entity not found: sensor.x');
    expect(el.shadowRoot!.querySelector('.warn')).not.toBeNull();
    expectClean(el);
  });
  it('only re-renders when the signature changes', async () => {
    updated.mockClear();
    const el = await mount<TestCard>('cuest-test-card', {}, fakeHass({ states: { 'sensor.a': st('1') } }));
    const n = updated.mock.calls.length;
    el.hass = fakeHass({ states: { 'sensor.a': st('1'), 'sensor.other': st('9') } });
    await el.updateComplete;
    expect(updated.mock.calls.length).toBe(n);
    el.hass = fakeHass({ states: { 'sensor.a': st('2') } });
    await el.updateComplete;
    expect(updated.mock.calls.length).toBe(n + 1);
  });
  it('accepts hass before setConfig', async () => {
    const el = make();
    expect(() => {
      el.hass = fakeHass({ states: { 'sensor.a': st('1') } });
    }).not.toThrow();
    el.setConfig({});
    document.body.appendChild(el);
    await el.updateComplete;
    expect(text(el)).toContain('hello');
  });
  it('adds the fonts link once on connect', () => {
    document.getElementById('cuest-arcane-fonts')?.remove();
    const a = make();
    const b = make();
    document.body.append(a, b);
    expect(document.head.querySelectorAll('#cuest-arcane-fonts')).toHaveLength(1);
  });
  it('has default sizes', () => {
    const el = make();
    expect(el.getCardSize()).toBeGreaterThan(0);
    expect(el.getGridOptions().columns).toBe(12);
  });
  it('fires more-info and navigates', () => {
    const el = make();
    const seen: unknown[] = [];
    document.body.appendChild(el);
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    fireMoreInfo(el, 'light.x');
    expect(seen).toEqual([{ entityId: 'light.x' }]);
    const loc = vi.fn();
    window.addEventListener('location-changed', loc);
    navigate('/lovelace/quests');
    expect(loc).toHaveBeenCalledOnce();
    expect(location.pathname).toBe('/lovelace/quests');
  });
});

describe('validators', () => {
  const T = 'cuest-test-card';
  it('str', () => {
    expect(() => v.str({}, 'name', T, true)).toThrow('cuest-test-card: "name" is required');
    expect(v.str({}, 'name', T)).toBeUndefined();
    expect(v.str({ name: 'x' }, 'name', T)).toBe('x');
  });
  it('num', () => {
    expect(() => v.num({ hours: 'x' }, 'hours', T, { def: 24 })).toThrow(/"hours" must be a number/);
    expect(() => v.num({ hours: 500 }, 'hours', T, { def: 24, min: 1, max: 168 })).toThrow(/"hours" must be between 1 and 168/);
    expect(() => v.num({ n: 0 }, 'n', T, { def: 1, min: 1 })).toThrow(/"n" must be at least 1/);
    expect(() => v.num({ n: 9 }, 'n', T, { def: 1, max: 5 })).toThrow(/"n" must be at most 5/);
    expect(v.num({}, 'hours', T, { def: 24 })).toBe(24);
    expect(v.num({ hours: 12 }, 'hours', T, { def: 24, min: 1, max: 168 })).toBe(12);
  });
  it('bool', () => {
    expect(v.bool({}, 'a', T, true)).toBe(true);
    expect(() => v.bool({ a: 'yes' }, 'a', T, false)).toThrow(/"a" must be true or false/);
  });
  it('oneOf', () => {
    expect(() => v.oneOf({ c: 'x' }, 'c', T, ['a', 'b', 'c'], 'a')).toThrow(/"c" must be one of a, b, c/);
    expect(v.oneOf({}, 'c', T, ['a', 'b'], 'b')).toBe('b');
  });
  it('list', () => {
    expect(() => v.list({ l: [1, 2, 3] }, 'l', T, 2)).toThrow(/"l" must have at most 2 items/);
    expect(() => v.list({ l: 'x' }, 'l', T)).toThrow(/"l" must be a list/);
    expect(v.list({}, 'l', T)).toEqual([]);
  });
  it('entity', () => {
    expect(() => v.entity({}, 'e', T, ['climate'], true)).toThrow(/"e" is required/);
    expect(() => v.entity({ e: 'light.x' }, 'e', T, ['climate', 'sensor'])).toThrow(/"e" must be a climate or sensor entity/);
    expect(() => v.entity({ e: 'nope' }, 'e', T)).toThrow(/"e" must be an entity id/);
    expect(v.entity({ e: 'sensor.x' }, 'e', T, ['sensor'])).toBe('sensor.x');
    expect(v.entity({}, 'e', T)).toBeUndefined();
  });
  it('card validation errors carry the tag', () => {
    const el = document.createElement('cuest-test-card') as TestCard;
    expect(() => el.setConfig({ hours: 'x' })).toThrow(/cuest-test-card: "hours" must be a number/);
  });
});
