import type { BridgeHub } from '../bridge/hub.js';
import type { Bus } from '../bus.js';
import { levelUp } from '../domain/levels.js';
import type { SettingsRepo } from '../repos/settings.js';

/** Flashes the house lights and starts the sprint scene. Failures are only logged. */
export class CelebrateService {
  private readonly hub: Pick<BridgeHub, 'callService'>;
  private readonly settings: SettingsRepo;
  private readonly log: (m: string) => void;

  constructor(deps: { bus: Bus; hub: Pick<BridgeHub, 'callService'>; settings: SettingsRepo; log: (m: string) => void }) {
    this.hub = deps.hub;
    this.settings = deps.settings;
    this.log = deps.log;
    deps.bus.on('quest:done', ({ reward, player }) => this.flash(levelUp(player.xp, reward.xp) ? 'long' : 'short'));
    deps.bus.on('sprint:started', () => this.safely('sprint scene', () => this.startScene()));
    deps.bus.on('sprint:finished', ({ xp, player }) => this.flash(levelUp(player.xp, xp) ? 'long' : 'short'));
    // A quick-log only celebrates when its +5 XP crossed a level.
    deps.bus.on('sprint:logged', ({ xp, player }) => {
      if (levelUp(player.xp, xp)) this.flash('long');
    });
  }

  private flash(kind: 'short' | 'long'): void {
    this.safely('celebration', () => {
      const lights = this.settings.get().celebrationLights;
      if (lights.length > 0) return this.hub.callService('light', 'turn_on', { flash: kind }, { entity_id: lights });
      return undefined;
    });
  }

  private startScene(): unknown {
    const scene = this.settings.get().sprintScene;
    return scene ? this.hub.callService('scene', 'turn_on', {}, { entity_id: scene }) : undefined;
  }

  private safely(what: string, fn: () => unknown): void {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((err: unknown) => this.log(`${what} failed: ${String(err)}`));
    } catch (err) {
      this.log(`${what} failed: ${String(err)}`);
    }
  }
}
