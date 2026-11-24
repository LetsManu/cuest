import type { HassState, HomeAssistant } from './hass-types';

export interface SensorPlayer {
  id: string;
  person: string | null;
  [kind: string]: HassState | string | null;
}

function cuestSensors(h: HomeAssistant): string[] {
  return Object.keys(h.states).filter((id) => id.startsWith('sensor.') && h.entities?.[id]?.platform === 'cuest');
}

/** Players grouped from Cuest sensors (by `cuest_player_id`, one sensor per `cuest_kind`). */
export function playersFromSensors(h: HomeAssistant): SensorPlayer[] {
  const players: Record<string, SensorPlayer> = {};
  for (const id of cuestSensors(h)) {
    const a = h.states[id].attributes ?? {};
    const pid = a.cuest_player_id as string | undefined;
    const kind = a.cuest_kind as string | undefined;
    if (!pid || !kind) continue;
    const p = players[pid] ?? (players[pid] = { id: pid, person: null });
    p.person = (a.ha_person as string | undefined) ?? null;
    p[kind] = h.states[id];
  }
  return Object.values(players);
}

/** Changes whenever the quests shown by any Cuest sensor change. */
export function questsSignature(h: HomeAssistant): string {
  return cuestSensors(h)
    .filter((id) => Array.isArray(h.states[id].attributes?.quests))
    .map((id) => JSON.stringify(h.states[id].attributes.quests))
    .join('|');
}

/** Changes whenever any Cuest sensor's state or quests change. */
export function cuestSignature(h: HomeAssistant): string {
  return cuestSensors(h).map((id) => `${id}=${h.states[id].state}@${h.states[id].last_changed}`).join('|') + '#' + questsSignature(h);
}
