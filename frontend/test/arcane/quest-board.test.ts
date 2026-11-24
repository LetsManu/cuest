import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text, type FakeHass } from './fake-hass';
import '../../src/arcane/quest-board';

const TAG = 'cuest-quest-board';
const root = (el: HTMLElement) => el.shadowRoot!;
const buttons = (el: HTMLElement) => Array.from(root(el).querySelectorAll('button'));
const byText = (el: HTMLElement, t: string) => buttons(el).find((b) => b.textContent?.trim() === t);
const flush = async () => {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

interface Opts {
  admin?: boolean;
  quests?: string[];
}

/** Critical battery with an impossible reading, a 2-valve group, a low battery and an update. */
function house(o: Opts = {}) {
  const states: Record<string, ReturnType<typeof st>> = {
    'sensor.thermostat_buero_battery': st('0', { device_class: 'battery', unit_of_measurement: '%', friendly_name: 'Thermostat Büro Battery' }),
    'sensor.thermostat_buero_temperature': st('-327.7', { device_class: 'temperature', unit_of_measurement: '°C' }),
    'sensor.macbook_battery': st('14', { device_class: 'battery', unit_of_measurement: '%' }),
    'binary_sensor.valve_a': st('on', { device_class: 'problem' }),
    'binary_sensor.valve_b': st('on', { device_class: 'problem' }),
    'update.home_assistant_core_update': st('on', { friendly_name: 'Home Assistant Core Update', installed_version: '2026.11.1', latest_version: '2026.11.2' }),
    'sensor.cuest_open_quests': st('1', { quests: o.quests ?? [] }),
  };
  const entities: Record<string, { platform: string; device_id?: string; area_id?: string }> = {
    'sensor.thermostat_buero_battery': { platform: 'zha', device_id: 'd1' },
    'sensor.thermostat_buero_temperature': { platform: 'zha', device_id: 'd1' },
    'sensor.macbook_battery': { platform: 'x', device_id: 'd2' },
    'binary_sensor.valve_a': { platform: 'zha', device_id: 'd3' },
    'binary_sensor.valve_b': { platform: 'zha', device_id: 'd4' },
  };
  const devices = {
    d1: { id: 'd1', name: 'Thermostat Büro' },
    d2: { id: 'd2', name: 'MacBook' },
    d3: { id: 'd3', name: 'Valve A', model: 'Valve', area_id: 'wz' },
    d4: { id: 'd4', name: 'Valve B', model: 'Valve', area_id: 'wz' },
  };
  return fakeHass({
    states,
    entities,
    devices,
    areas: { wz: { area_id: 'wz', name: 'Wohnzimmer' } },
    user: { id: 'u1', is_admin: o.admin ?? false },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('quest board full', () => {
  it('renders scrolls in order with XP and a pulsing first badge', async () => {
    const el = await mount(TAG, {}, house());
    const scrolls = Array.from(root(el).querySelectorAll('.scroll'));
    expect(scrolls).toHaveLength(4);
    const t = scrolls.map((s) => s.textContent!.replace(/\s+/g, ' '));
    expect(t[0]).toContain('Change the Thermostat Büro battery');
    expect(t[0]).toContain('+30 XP');
    expect(t[1]).toContain('Check 2 Valve devices');
    expect(t[1]).toContain('+20 XP');
    expect(t[2]).toContain('Charge or change the MacBook battery');
    expect(t[2]).toContain('+5 XP');
    expect(t[3]).toContain('Home Assistant Core Update');
    expect(t[3]).toContain('+10 XP');
    expect(scrolls[0].querySelector('.badge')!.classList.contains('pulse')).toBe(true);
    expect(scrolls[1].querySelector('.badge')!.classList.contains('pulse')).toBe(false);
    expect(scrolls[0].querySelector('.badge')!.textContent).toBe('!');
    expect(scrolls[3].querySelector('.badge')!.textContent).toBe('↑');
    expect(text(el)).toContain('Quick quests');
    expect(text(el)).toContain('Everything else is well. New problems appear here by themselves.');
    expectClean(el);
  });

  it('shows the summary panel with health, copy and non-zero chips only', async () => {
    const states: Record<string, ReturnType<typeof st>> = {};
    const batt = (n: number, v: string) => (states[`sensor.b${n}_battery`] = st(v, { device_class: 'battery', unit_of_measurement: '%', friendly_name: `B${n}` }));
    batt(1, '3');
    batt(2, '15');
    for (let i = 3; i <= 8; i++) batt(i, '90');
    states['update.core'] = st('on', { friendly_name: 'Core' });
    states['update.os'] = st('off', { friendly_name: 'OS' });
    const el = await mount(TAG, { show_summary: true }, fakeHass({ states }));
    const t = text(el);
    expect(t).toContain('Health 70%');
    expect(t).toContain('3 small quests. Nothing urgent.');
    expect(t).toContain('2 batteries');
    expect(t).toContain('1 update');
    expect(t).not.toContain('devices');
    expect(t).not.toContain('sensors');
    expect(root(el).querySelector('svg.orb')!.getAttribute('width')).toBe('80');
    expectClean(el);
  });

  it('uses the singular summary for one quest', async () => {
    const states = { 'update.core': st('on', { friendly_name: 'Core' }) };
    const el = await mount(TAG, { show_summary: true }, fakeHass({ states }));
    expect(text(el)).toContain('1 small quest. Nothing urgent.');
    expect(text(el)).not.toContain('1 small quests');
  });

  it('has no summary by default', async () => {
    const el = await mount(TAG, {}, house());
    expect(text(el)).not.toContain('Health');
  });

  it('shows the well-done panel when nothing needs care', async () => {
    const el = await mount(TAG, {}, fakeHass({ states: {} }));
    expect(text(el)).toContain('Everything is well.');
    expect(root(el).querySelectorAll('.scroll')).toHaveLength(0);
  });

  it('never uses shame words', async () => {
    const el = await mount(TAG, { show_summary: true }, house({ admin: true }));
    expect(text(el)).not.toMatch(/broken|offline|error|fault|dead|overdue|failed/i);
  });

  it('renders device names as text', async () => {
    const h = house();
    h.devices!.d2.name = '<b>x</b>';
    const el = await mount(TAG, {}, h);
    const scroll = Array.from(root(el).querySelectorAll('.scroll')).find((s) => s.textContent!.includes('<b>x</b>'))!;
    expect(scroll).toBeTruthy();
    expect(scroll.querySelector('b')).toBeNull();
  });

  it('rejects an unknown variant and a bad threshold', () => {
    const el = document.createElement(TAG) as HTMLElement & { setConfig(c: unknown): void };
    expect(() => el.setConfig({ variant: 'big' })).toThrow(/cuest-quest-board: "variant" must be one of full, compact/);
    expect(() => el.setConfig({ battery_threshold: 0 })).toThrow(/battery_threshold/);
  });

  it('reports grid, size and stub', async () => {
    const el = await mount<{ getGridOptions(): object; getCardSize(): number }>(TAG, {}, house());
    expect(el.getGridOptions()).toEqual({ columns: 12, rows: 'auto' });
    expect(el.getCardSize()).toBe(6);
    const ctor = customElements.get(TAG) as unknown as { getStubConfig(): object };
    expect(ctor.getStubConfig()).toEqual({});
  });
});

describe('quest board add flow', () => {
  it('posts the quest once for two quick taps, then shows added', async () => {
    const h = house({ admin: true });
    let release!: () => void;
    h.callApi.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const el = await mount(TAG, {}, h);
    const b = byText(el, 'Add to my Cuest quests')!;
    b.click();
    b.click();
    expect(h.callApi).toHaveBeenCalledTimes(1);
    expect(h.callApi).toHaveBeenCalledWith('POST', 'cuest/quests', { title: 'Change the Thermostat Büro battery', energy: 'low', minutes: 5, xp: 30 });
    release();
    await flush();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('Added to your quests');
    expectClean(el);
  });

  it('shows a kind message and re-enables the button when the API rejects', async () => {
    const h = house({ admin: true });
    h.callApi.mockRejectedValueOnce(new Error('nope'));
    const el = await mount(TAG, {}, h);
    byText(el, 'Add to my Cuest quests')!.click();
    await flush();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(text(el)).toContain('Cuest could not take it right now. Try again soon.');
    const again = byText(el, 'Add to my Cuest quests')!;
    expect(again.disabled).toBe(false);
    again.click();
    expect(h.callApi).toHaveBeenCalledTimes(2);
  });

  it('shows already and makes no call when the title is on the quest list', async () => {
    const h = house({ admin: true, quests: ['Change the Thermostat Büro battery'] });
    const el = await mount(TAG, {}, h);
    byText(el, 'Add to my Cuest quests')!.click();
    await flush();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(h.callApi).not.toHaveBeenCalled();
    expect(text(el)).toContain('Already on your quest list');
  });

  it('keeps added after later hass updates', async () => {
    const h = house({ admin: true });
    const el = await mount<{ hass: FakeHass; updateComplete: Promise<boolean> }>(TAG, {}, h);
    byText(el, 'Add to my Cuest quests')!.click();
    await flush();
    el.hass = house({ admin: true });
    await el.updateComplete;
    expect(text(el)).toContain('Added to your quests');
  });

  it('shows Add and Install only to admins and not when allow_add is false', async () => {
    const non = await mount(TAG, {}, house({ admin: false }));
    expect(buttons(non)).toHaveLength(0);
    expect(text(non)).toContain('+10 XP');
    const off = await mount(TAG, { allow_add: false }, house({ admin: true }));
    expect(byText(off, 'Add to my Cuest quests')).toBeUndefined();
  });

  it('Install calls update.install once and swaps the XP badge', async () => {
    const h = house({ admin: true });
    let release!: () => void;
    h.callService.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const el = await mount(TAG, {}, h);
    const scroll = Array.from(root(el).querySelectorAll('.scroll')).find((s) => s.textContent!.includes('Core Update'))!;
    expect(scroll.textContent).not.toContain('XP');
    const b = byText(el, 'Install')!;
    b.click();
    b.click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    expect(h.callService).toHaveBeenCalledWith('update', 'install', { entity_id: 'update.home_assistant_core_update' });
    release();
    await flush();
  });

  it('re-enables Install when the call rejects', async () => {
    const h = house({ admin: true });
    h.callService.mockRejectedValueOnce(new Error('x'));
    const el = await mount(TAG, {}, h);
    byText(el, 'Install')!.click();
    await flush();
    await (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(byText(el, 'Install')!.disabled).toBe(false);
    expect(text(el)).toContain('Cuest could not take it right now. Try again soon.');
  });

  it('gives every button a 44px min-height rule and the class that carries it', async () => {
    const el = await mount(TAG, { variant: 'full' }, house({ admin: true }));
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    const rule = /(?:^|[}\s,])\.btn\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
    expect(rule).toBeTruthy();
    expect(Number(rule![1])).toBeGreaterThanOrEqual(44);
    const bs = buttons(el);
    expect(bs.length).toBeGreaterThan(0);
    for (const b of bs) expect(b.classList.contains('btn')).toBe(true);
  });
});

describe('quest board compact', () => {
  function five() {
    const states: Record<string, ReturnType<typeof st>> = {};
    for (let i = 1; i <= 5; i++) states[`update.u${i}`] = st('on', { friendly_name: `Update ${i}` });
    return fakeHass({ states });
  }

  it('shows the first two rows, a link and the more line', async () => {
    const el = await mount(TAG, { variant: 'compact', more_path: '/arcane-quests' }, five());
    expect(root(el).querySelectorAll('.row')).toHaveLength(2);
    expect(text(el)).toContain('Quest board');
    expect(text(el)).toContain('All 5 →');
    expect(text(el)).toContain('+ 3 more on the board →');
    expectClean(el);
  });

  it('navigates when a row is tapped', async () => {
    const seen = vi.fn();
    window.addEventListener('location-changed', seen);
    const el = await mount(TAG, { variant: 'compact', more_path: '/arcane-quests' }, five());
    (root(el).querySelector('.row') as HTMLElement).click();
    expect(location.pathname).toBe('/arcane-quests');
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('location-changed', seen);
  });

  it('has no link and no more line without more_path or remaining faults', async () => {
    const el = await mount(TAG, { variant: 'compact', limit: 5 }, five());
    expect(root(el).querySelectorAll('.row')).toHaveLength(5);
    expect(text(el)).not.toContain('All 5');
    expect(text(el)).not.toContain('more on the board');
  });

  it('sizes the card by the shown scrolls and shows the empty panel', async () => {
    const el = await mount<{ getCardSize(): number }>(TAG, { variant: 'compact' }, five());
    expect(el.getCardSize()).toBe(4);
    const none = await mount(TAG, { variant: 'compact' }, fakeHass({ states: {} }));
    expect(text(none)).toContain('Everything is well.');
  });

  it('compact rows are at least 44px tall by rule', async () => {
    const css = (customElements.get(TAG) as unknown as { elementStyles: { cssText: string }[] }).elementStyles.map((s) => s.cssText).join('\n');
    const rule = /(?:^|[}\s,])\.row\s*\{[^}]*min-height:\s*(\d+)px/.exec(css);
    expect(Number(rule![1])).toBeGreaterThanOrEqual(44);
  });
});
