/** The small slice of Home Assistant's frontend object that Cuest uses. */
export interface HassState {
  state: string;
  last_changed: string;
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassState>;
  entities?: Record<string, { platform?: string }>;
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  callApi?<T = unknown>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T>;
}
