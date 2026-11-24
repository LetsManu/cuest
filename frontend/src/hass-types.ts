/** The small slice of Home Assistant's frontend object that Cuest uses. */
export interface HassState {
  state: string;
  last_changed: string;
  attributes: Record<string, unknown>;
}

export interface HassEntity {
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
}

export interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  model?: string | null;
  area_id?: string | null;
}

export interface HassArea {
  area_id: string;
  name: string;
}

export interface HomeAssistant {
  states: Record<string, HassState>;
  entities?: Record<string, HassEntity>;
  devices?: Record<string, HassDevice>;
  areas?: Record<string, HassArea>;
  user?: { id: string; is_admin: boolean };
  locale?: { language: string };
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  callApi?<T = unknown>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T>;
}
