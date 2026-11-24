/** WebAudio-only fanfares (no audio files). Off until the player taps "Sound on". */
const KEY = 'cuest.sound';

export function isSoundOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setSoundOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: just don't remember */ }
}

export type Fanfare = 'done' | 'level' | 'loot';

const NOTES: Record<Fanfare, number[]> = {
  done: [523.25, 659.25, 783.99],
  loot: [659.25, 783.99, 987.77, 1318.51],
  level: [523.25, 659.25, 783.99, 1046.5, 1318.51],
};

/** A short square-wave arpeggio. Never throws, even where AudioContext is missing. */
export function playFanfare(kind: Fanfare): void {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const AC = Ctx.AudioContext ?? Ctx.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t0 = ctx.currentTime;
    NOTES[kind].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = t0 + i * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
    setTimeout(() => { void ctx.close().catch(() => {}); }, 1500);
  } catch { /* sound is a nicety only */ }
}
