import type { BridgeHub } from '../bridge/hub.js';
import type { Bus } from '../bus.js';
import { levelForXp } from '../domain/levels.js';
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
    deps.bus.on('quest:done', ({ reward, player }) => {
      const levelUp = levelForXp(player.xp).level > levelForXp(player.xp - reward.xp).level;
      this.flash(levelUp ? 'long' : 'short');
    });
    deps.bus.on('sprint:started', () => this.safely('sprint scene', () => this.startScene()));
    deps.bus.on('sprint:finished', () => this.flash('short'));
  }

  private flash(kind: 'short' | 'long'): void {
    this.safely('celebration', () => {
      const lights = this.settings.get().celebrationLights;
      if (lights.length > 0) this.hub.callService('light', 'turn_on', { flash: kind }, { entity_id: lights });
    });
  }

  private startScene(): void {
    const scene = this.settings.get().sprintScene;
    if (scene) this.hub.callService('scene', 'turn_on', {}, { entity_id: scene });
  }

  private safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log(`${what} failed: ${String(err)}`);
    }
  }
}
