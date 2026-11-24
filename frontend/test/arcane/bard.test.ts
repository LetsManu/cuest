import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectClean, fakeHass, mount, st, text } from './fake-hass';
import { CuestBardCard } from '../../src/arcane/bard';
import { parseService } from '../../src/arcane/base';
import '../../src/arcane/bard';

const TAG = 'cuest-bard-card';
const ID = 'media_player.wohnzimmer_5';
const root = (el: HTMLElement) => el.shadowRoot!;
const done = (el: HTMLElement) => (el as unknown as { updateComplete: Promise<boolean> }).updateComplete;
const btn = (el: HTMLElement, label: string) => root(el).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const css = () => CuestBardCard.styles.map((s) => (s as { cssText: string }).cssText).join('\n');
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const NOW = new Date('2026-11-24T12:00:00Z');
const player = (over: Record<string, unknown> = {}, state = 'playing') =>
  st(state, {
    friendly_name: 'Wohnzimmer 5',
    media_title: 'Lofi Radio',
    app_name: 'Music Assistant',
    media_position: 60,
    media_duration: 150,
    media_position_updated_at: '2026-11-24T11:59:30Z',
    volume_level: 0.35,
    ...over,
  });
const world = (s = player(), extra: Record<string, unknown> = {}) =>
  fakeHass({
    states: { [ID]: s },
    entities: { [ID]: { area_id: 'wz' } },
    areas: { wz: { area_id: 'wz', name: 'Wohnzimmer' } },
    ...extra,
  });
const slider = (el: HTMLElement) => root(el).querySelector<HTMLInputElement>('input[type="range"]')!;
const setVol = (el: HTMLElement, v: number) => {
  const i = slider(el);
  i.value = String(v);
  i.dispatchEvent(new Event('change', { bubbles: true }));
};
const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('parseService', () => {
  it('splits domain.service and rejects anything else', () => {
    expect(parseService('script.turn_on', TAG)).toEqual(['script', 'turn_on']);
    for (const bad of ['nope', 'a.b.c', 'Script.turn_on', '.x', 'x.', 'a b.c', '']) expect(() => parseService(bad, TAG)).toThrow(/service/);
  });
});

describe('full bard', () => {
  it('shows the area name, the track, progress and a pause button while playing', async () => {
    const el = await mount(TAG, { entity: ID }, world());
    expect(text(el)).toContain('Bard · Wohnzimmer');
    expect(text(el)).toContain('Lofi Radio · Music Assistant');
    const bar = root(el).querySelector<HTMLElement>('.fill')!;
    expect(bar.style.width).toBe('60%');
    expect(root(el).querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('60');
    expect(root(el).querySelectorAll('.eq').length).toBe(5);
    expect(btn(el, 'Pause')).toBeTruthy();
    expectClean(el);
  });

  it('is calm when paused: idle line, play button, still bars', async () => {
    const el = await mount(TAG, { entity: ID }, world(player({}, 'paused')));
    expect(text(el)).toContain('Ready to play');
    expect(text(el)).not.toContain('Lofi Radio');
    expect(btn(el, 'Play')).toBeTruthy();
    expect(root(el).querySelectorAll('.eq').length).toBe(0);
    expect(root(el).querySelectorAll('.bars i').length).toBe(5);
    expect(root(el).querySelector<HTMLElement>('.fill')!.style.width).toBe('40%');
  });

  it('name config wins, friendly name is the fallback', async () => {
    const a = await mount(TAG, { entity: ID, name: 'Küche' }, world());
    expect(text(a)).toContain('Bard · Küche');
    const b = await mount(TAG, { entity: ID }, fakeHass({ states: { [ID]: player() } }));
    expect(text(b)).toContain('Bard · Wohnzimmer 5');
  });

  it('prefers the artist over the app and falls back to the title alone', async () => {
    const a = await mount(TAG, { entity: ID }, world(player({ media_artist: 'Nujabes' })));
    expect(text(a)).toContain('Lofi Radio · Nujabes');
    expect(text(a)).not.toContain('Music Assistant');
    const b = await mount(TAG, { entity: ID }, world(player({ app_name: undefined })));
    expect(root(b).querySelector('.sub')!.textContent!.trim()).toBe('Lofi Radio');
    const c = await mount(TAG, { entity: ID }, world(player({ media_title: undefined })));
    expect(text(c)).toContain('Ready to play');
    expectClean(c);
  });

  it('progress edge cases: clamped, hidden without duration, no drift while paused', async () => {
    const over = await mount(TAG, { entity: ID }, world(player({ media_position: 400 })));
    expect(root(over).querySelector<HTMLElement>('.fill')!.style.width).toBe('100%');
    const none = await mount(TAG, { entity: ID }, world(player({ media_duration: undefined })));
    expect(root(none).querySelector('[role="progressbar"]')).toBeNull();
    const zero = await mount(TAG, { entity: ID }, world(player({ media_duration: 0 })));
    expect(root(zero).querySelector('[role="progressbar"]')).toBeNull();
    const nopos = await mount(TAG, { entity: ID }, world(player({ media_position: undefined, media_position_updated_at: undefined })));
    expect(root(nopos).querySelector<HTMLElement>('.fill')!.style.width).toBe('0%');
    const noStamp = await mount(TAG, { entity: ID }, world(player({ media_position_updated_at: 'garbage' })));
    expect(root(noStamp).querySelector<HTMLElement>('.fill')!.style.width).toBe('40%');
    for (const e of [over, none, zero, nopos, noStamp]) expectClean(e);
  });

  it('transport buttons call the media_player services', async () => {
    const h = world();
    const el = await mount(TAG, { entity: ID }, h);
    btn(el, 'Next').click();
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'media_next_track', { entity_id: ID });
    btn(el, 'Previous').click();
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'media_previous_track', { entity_id: ID });
    btn(el, 'Pause').click();
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'media_play_pause', { entity_id: ID });
    expect(h.callService).toHaveBeenCalledTimes(3);
  });

  it('a double tap sends one call; a rejection re-enables the button with kind copy', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    btn(el, 'Next').click();
    btn(el, 'Next').click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    await done(el);
    expect(btn(el, 'Next').getAttribute('aria-disabled')).toBe('true');
    expect(btn(el, 'Next').disabled).toBe(false);
    d.reject(new Error('boom'));
    await flush();
    await done(el);
    expect(btn(el, 'Next').hasAttribute('aria-disabled')).toBe(false);
    expect(text(el)).toContain('could not do that right now');
    expect(text(el)).not.toMatch(/error|failed|broken/i);
    btn(el, 'Next').click();
    expect(h.callService).toHaveBeenCalledTimes(2);
    await flush();
    await done(el);
    expect(text(el)).not.toContain('could not do that');
  });

  it('volume change sends volume_level as a fraction', async () => {
    const h = world(player({ volume_level: 0.5 }));
    const el = await mount(TAG, { entity: ID }, h);
    expect(slider(el).value).toBe('50');
    expect(slider(el).min).toBe('0');
    expect(slider(el).max).toBe('100');
    setVol(el, 35);
    expect(h.callService).toHaveBeenCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0.35 });
    await flush();
    setVol(el, 0);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0 });
    await flush();
    setVol(el, 100);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 1 });
  });

  it('volume: while a call is in flight only the final value is sent next, even if it equals an older one', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 40);
    setVol(el, 60);
    setVol(el, 20);
    expect(h.callService).toHaveBeenCalledTimes(1);
    d.resolve();
    await flush();
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0.2 });
    await flush();
    setVol(el, 40); // back to a value sent earlier, not the last one: must still go out
    expect(h.callService).toHaveBeenCalledTimes(3);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0.4 });
  });

  it('volume: a queued value equal to the one in flight is not sent twice', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 40);
    setVol(el, 60);
    setVol(el, 40);
    d.resolve();
    await flush();
    expect(h.callService).toHaveBeenCalledTimes(1);
  });

  it('volume rejection shows kind copy and the slider goes back to the real level', async () => {
    const h = world(player({ volume_level: 0.5 }));
    h.callService.mockRejectedValueOnce(new Error('x'));
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 10);
    await done(el);
    await flush();
    await done(el);
    expect(slider(el).value).toBe('50');
    expect(text(el)).toContain('could not do that right now');
    setVol(el, 10);
    expect(h.callService).toHaveBeenCalledTimes(2);
  });

  it('a rejected in-flight volume call still sends the newer queued value; only the final failure reverts', async () => {
    const d1 = deferred();
    const d2 = deferred();
    const h = world(player({ volume_level: 0.5 }));
    h.callService.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 40);
    setVol(el, 60);
    d1.reject(new Error('x'));
    await flush();
    await done(el);
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0.6 });
    expect(slider(el).value).toBe('60');
    expect(text(el)).not.toContain('could not do that');
    d2.reject(new Error('y'));
    await flush();
    await done(el);
    expect(slider(el).value).toBe('50');
    expect(text(el)).toContain('could not do that right now');
  });

  it('after a call resolves an external change shows and the same value can be set again', async () => {
    const h = world(player({ volume_level: 0.5 }));
    const el = await mount<CuestBardCard>(TAG, { entity: ID }, h);
    setVol(el, 40);
    await flush();
    setVol(el, 40);
    expect(h.callService).toHaveBeenCalledTimes(2);
    await flush();
    h.states[ID] = player({ volume_level: 0.9 });
    el.hass = { ...h };
    await done(el);
    vi.advanceTimersByTime(3000);
    await done(el);
    expect(slider(el).value).toBe('90');
    setVol(el, 40);
    expect(h.callService).toHaveBeenCalledTimes(3);
  });

  it('sends a queued volume when the card leaves the page', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 40);
    setVol(el, 70);
    expect(h.callService).toHaveBeenCalledTimes(1);
    el.remove();
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'volume_set', { entity_id: ID, volume_level: 0.7 });
    d.resolve();
    await flush();
    expect(h.callService).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a late resolve after removal arms no timer and a reconnect starts clean', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    setVol(el, 40);
    el.remove();
    d.resolve();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    document.body.appendChild(el);
    await done(el);
    setVol(el, 70);
    expect(h.callService).toHaveBeenCalledTimes(2);
  });

  it('keeps keyboard focus on a busy control', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID }, h);
    btn(el, 'Next').focus();
    btn(el, 'Next').click();
    await done(el);
    expect(root(el).activeElement).toBe(btn(el, 'Next'));
    expect(btn(el, 'Next').getAttribute('aria-disabled')).toBe('true');
    d.resolve();
    await flush();
  });

  it('labels come from the copy table', async () => {
    const { ARCANE_COPY: C } = await import('../../src/arcane/copy');
    const el = await mount(TAG, { entity: ID }, world());
    expect(C.bardPause).toBe('Pause');
    expect(C.bardPlay).toBe('Play');
    expect(C.bardPrev).toBe('Previous');
    expect(C.bardNext).toBe('Next');
    expect(btn(el, C.bardPrev)).toBeTruthy();
  });

  it('volume without a level shows 0 and stays clean', async () => {
    const el = await mount(TAG, { entity: ID }, world(player({ volume_level: undefined })));
    expect(slider(el).value).toBe('0');
    expectClean(el);
  });

  it('source buttons call their service with exactly their data', async () => {
    const h = world();
    const el = await mount(
      TAG,
      {
        entity: ID,
        sources: [
          { name: 'Radio', service: 'media_player.play_media', data: { entity_id: ID, media_content_id: 'x', media_content_type: 'music' } },
          { name: 'Friendflix', service: 'script.turn_on', data: { entity_id: 'script.friendflix' } },
          { name: 'Bare', service: 'script.friendflix' },
        ],
      },
      h,
    );
    const names = Array.from(root(el).querySelectorAll('.src')).map((b) => b.textContent!.trim());
    expect(names).toEqual(['Radio', 'Friendflix', 'Bare']);
    const src = (n: string) => Array.from(root(el).querySelectorAll<HTMLButtonElement>('.src')).find((b) => b.textContent!.trim() === n)!;
    src('Friendflix').click();
    expect(h.callService).toHaveBeenLastCalledWith('script', 'turn_on', { entity_id: 'script.friendflix' });
    src('Bare').click();
    expect(h.callService).toHaveBeenLastCalledWith('script', 'friendflix', {});
    src('Radio').click();
    expect(h.callService).toHaveBeenLastCalledWith('media_player', 'play_media', { entity_id: ID, media_content_id: 'x', media_content_type: 'music' });
  });

  it('a source button double tap sends once and re-enables after a rejection', async () => {
    const d = deferred();
    const h = world();
    h.callService.mockImplementationOnce(() => d.promise);
    const el = await mount(TAG, { entity: ID, sources: [{ name: 'Radio', service: 'script.radio' }] }, h);
    const b = () => root(el).querySelector<HTMLButtonElement>('.src')!;
    b().click();
    b().click();
    expect(h.callService).toHaveBeenCalledTimes(1);
    d.reject(new Error('x'));
    await flush();
    await done(el);
    expect(b().hasAttribute('aria-disabled')).toBe(false);
    expect(text(el)).toContain('could not do that right now');
  });

  it('tapping the title opens more-info for the player', async () => {
    const el = await mount(TAG, { entity: ID }, world());
    const seen: string[] = [];
    document.body.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail.entityId));
    root(el).querySelector<HTMLButtonElement>('button.title')!.click();
    expect(seen).toEqual([ID]);
  });

  it.each(['unavailable', 'off', 'unknown'])('rests when %s: copy, disabled controls, clean', async (state) => {
    const h = world(st(state, { friendly_name: 'Wohnzimmer 5', media_title: 'Stale', volume_level: 0.3 }));
    const el = await mount(TAG, { entity: ID, sources: [{ name: 'Radio', service: 'script.radio' }] }, h);
    expect(text(el)).toContain('The bard is resting');
    expect(text(el)).not.toContain('Stale');
    const all = Array.from(root(el).querySelectorAll<HTMLButtonElement>('button:not(.title)'));
    expect(all.length).toBe(4);
    expect(all.every((b) => b.disabled)).toBe(true);
    expect(slider(el).disabled).toBe(true);
    expect(root(el).querySelectorAll('.eq').length).toBe(0);
    all[0].click();
    expect(h.callService).not.toHaveBeenCalled();
    expectClean(el);
  });

  it('re-renders when the player reports something new', async () => {
    const h = world();
    const el = await mount<CuestBardCard>(TAG, { entity: ID }, h);
    h.states[ID] = player({ volume_level: 0.8, media_title: 'Jazz' }, 'paused');
    el.hass = { ...h };
    await done(el);
    expect(slider(el).value).toBe('80');
    expect(text(el)).toContain('Ready to play');
    h.states[ID] = player({ volume_level: 0.8, media_title: 'Jazz' }, 'playing');
    el.hass = { ...h };
    await done(el);
    expect(text(el)).toContain('Jazz');
    expect(root(el).querySelectorAll('.eq').length).toBe(5);
  });

  it('leaves no timer behind when removed', async () => {
    const el = await mount(TAG, { entity: ID }, world());
    setVol(el, 20);
    await flush();
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('missing entity shows the warning panel, not a throw', async () => {
    const el = await mount(TAG, { entity: 'media_player.nowhere' }, fakeHass());
    expect(text(el)).toContain('Entity not found: media_player.nowhere');
  });

  it('valid markup, targets and labels', async () => {
    const el = await mount(TAG, { entity: ID, sources: [{ name: 'Radio', service: 'script.radio' }] }, world());
    expect(root(el).querySelector('button div, span div')).toBeNull();
    for (const b of Array.from(root(el).querySelectorAll('button'))) {
      expect(b.textContent!.trim() !== '' || b.getAttribute('aria-label')).toBeTruthy();
    }
    expect(slider(el).getAttribute('aria-label')).toBe('Volume');
    expect(root(el).querySelectorAll('svg:not([aria-hidden="true"])').length).toBe(0);
    expect(btn(el, 'Next').className).toContain('ctl');
    expect(btn(el, 'Pause').className).toContain('main');
    expect(root(el).querySelector('.src')!.className).toContain('src');
    expect(css()).toMatch(/\.ctl\{[^}]*min-width:48px[^}]*min-height:48px/);
    expect(css()).toMatch(/\.main\{[^}]*width:62px[^}]*height:62px/);
    expect(css()).toMatch(/\.src\{[^}]*min-height:44px/);
    expect(css()).toMatch(/\.title\{[^}]*min-height:44px/);
    expect(css()).toMatch(/input\[type="range"\]\{[^}]*min-height:44px/);
  });

  it('title text is Pixelify, numbers stay tabular', () => {
    expect(css()).toMatch(/\.name\{[^}]*font-family:'Pixelify Sans'/);
    expect(css()).toMatch(/\.num\{[^}]*tabular-nums/);
  });

  it('grid options and stub', () => {
    const full = document.createElement(TAG) as unknown as CuestBardCard;
    full.setConfig({ entity: ID });
    expect(full.getGridOptions()).toEqual({ columns: 12, rows: 5 });
    const compact = document.createElement(TAG) as unknown as CuestBardCard;
    compact.setConfig({ entity: ID, variant: 'compact' });
    expect(compact.getGridOptions()).toEqual({ columns: 12, rows: 2 });
    const h = fakeHass({ states: { 'light.a': st('on'), 'media_player.tv': st('off'), 'media_player.b': st('on') } });
    expect(CuestBardCard.getStubConfig(h)).toEqual({ entity: 'media_player.tv' });
    expect(CuestBardCard.getStubConfig()).toEqual({ entity: '' });
  });
});

describe('compact bard', () => {
  it('shows 4 pulsing bars, the track and one 48px play button, nothing else', async () => {
    const el = await mount(TAG, { entity: ID, variant: 'compact', sources: [{ name: 'Radio', service: 'script.radio' }] }, world());
    expect(root(el).querySelectorAll('.pulse').length).toBe(4);
    expect(text(el)).toContain('Bard · Wohnzimmer');
    expect(text(el)).toContain('Lofi Radio · Music Assistant');
    expect(root(el).querySelector('input')).toBeNull();
    expect(root(el).querySelector('.src')).toBeNull();
    expect(btn(el, 'Next')).toBeNull();
    expect(btn(el, 'Pause').className).toContain('main');
    expect(css()).toMatch(/\.compact \.main\{[^}]*width:48px[^}]*height:48px/);
    expectClean(el);
  });

  it('is calm when idle and plays on tap', async () => {
    const h = world(player({}, 'paused'));
    const el = await mount(TAG, { entity: ID, variant: 'compact' }, h);
    expect(text(el)).toContain('Ready to play');
    expect(root(el).querySelectorAll('.pulse').length).toBe(0);
    btn(el, 'Play').click();
    expect(h.callService).toHaveBeenCalledWith('media_player', 'media_play_pause', { entity_id: ID });
  });

  it('rests when unavailable', async () => {
    const el = await mount(TAG, { entity: ID, variant: 'compact' }, world(st('unavailable')));
    expect(text(el)).toContain('The bard is resting');
    expect(btn(el, 'Play').disabled).toBe(true);
    expectClean(el);
  });
});

describe('bard config', () => {
  const mk = (c: unknown) => () => (document.createElement(TAG) as unknown as CuestBardCard).setConfig(c);
  it('rejects bad config with the tag in the message', () => {
    expect(mk({})).toThrow(/cuest-bard-card.*entity.*required/);
    expect(mk({ entity: 'light.x' })).toThrow(/cuest-bard-card.*media_player/);
    expect(mk({ entity: ID, variant: 'big' })).toThrow(/variant.*one of full, compact/);
    expect(mk({ entity: ID, sources: 'x' })).toThrow(/sources/);
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, service: 'script.turn_on' }));
    expect(mk({ entity: ID, sources: five })).toThrow(/at most 4/);
    expect(mk({ entity: ID, sources: five.slice(0, 4) })).not.toThrow();
    expect(mk({ entity: ID, sources: [{ name: 'A', service: 'nope' }] })).toThrow(/service/);
    expect(mk({ entity: ID, sources: [{ service: 'script.turn_on' }] })).toThrow(/name/);
    expect(mk({ entity: ID, sources: [{ name: 'A', service: 'script.turn_on', data: 'x' }] })).toThrow(/data/);
    expect(mk({ entity: ID, sources: ['x'] })).toThrow(/sources/);
  });
});
