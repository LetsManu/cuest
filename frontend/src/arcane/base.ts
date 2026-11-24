import { LitElement, html, type TemplateResult } from 'lit';
import type { HomeAssistant } from '../hass-types';
import { ARCANE_COPY, fill } from './copy';
import { arcaneBase, ensureFonts } from './theme';

export class ConfigError extends Error {}

const fail = (tag: string, key: string, what: string): never => {
  throw new ConfigError(`${tag}: "${key}" ${what}`);
};

type Raw = Record<string, unknown>;

/** Config validators. Every failure throws ConfigError("<tag>: \"<key>\" ..."). */
export const v = {
  str(raw: Raw, key: string, tag: string, required = false): string | undefined {
    const x = raw[key];
    if (x === undefined || x === null || x === '') return required ? fail(tag, key, 'is required') : undefined;
    if (typeof x !== 'string') return fail(tag, key, 'must be text');
    return x;
  },
  num(raw: Raw, key: string, tag: string, o: { def: number; min?: number; max?: number }): number {
    const x = raw[key];
    if (x === undefined || x === null) return o.def;
    if (typeof x !== 'number' || !Number.isFinite(x)) return fail(tag, key, 'must be a number');
    if ((o.min !== undefined && x < o.min) || (o.max !== undefined && x > o.max)) {
      return fail(tag, key, `must be between ${o.min ?? '-∞'} and ${o.max ?? '∞'}`);
    }
    return x;
  },
  bool(raw: Raw, key: string, tag: string, def: boolean): boolean {
    const x = raw[key];
    if (x === undefined || x === null) return def;
    if (typeof x !== 'boolean') return fail(tag, key, 'must be true or false');
    return x;
  },
  oneOf<T extends string>(raw: Raw, key: string, tag: string, values: readonly T[], def: T): T {
    const x = raw[key];
    if (x === undefined || x === null) return def;
    if (typeof x !== 'string' || !(values as readonly string[]).includes(x)) {
      return fail(tag, key, `must be one of ${values.join(', ')}`);
    }
    return x as T;
  },
  list(raw: Raw, key: string, tag: string, max?: number): unknown[] {
    const x = raw[key];
    if (x === undefined || x === null) return [];
    if (!Array.isArray(x)) return fail(tag, key, 'must be a list');
    if (max !== undefined && x.length > max) return fail(tag, key, `must have at most ${max} items`);
    return x;
  },
  entity(raw: Raw, key: string, tag: string, domains?: string[], required = false): string | undefined {
    const x = raw[key];
    if (x === undefined || x === null || x === '') return required ? fail(tag, key, 'is required') : undefined;
    const ok = typeof x === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(x) && (!domains || domains.includes(x.split('.')[0]));
    if (!ok) return fail(tag, key, domains?.length ? `must be a ${domains.join(' or ')} entity` : 'must be an entity id');
    return x as string;
  },
};

export abstract class ArcaneCard<C> extends LitElement {
  static styles = [arcaneBase];

  protected config!: C;
  protected _hass?: HomeAssistant;
  private _sig?: string;
  abstract readonly tag: string;

  protected abstract validate(raw: Raw): C;

  setConfig(raw: unknown): void {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ConfigError(`${this.tag}: config must be an object`);
    }
    this.config = this.validate(raw as Raw);
    this._sig = undefined;
    this.requestUpdate();
  }

  set hass(h: HomeAssistant) {
    this._hass = h;
    const sig = this.signature(h);
    if (sig !== this._sig) {
      this._sig = sig;
      this.requestUpdate();
    }
  }
  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  protected entityIds(): string[] {
    return [];
  }

  protected signature(h: HomeAssistant): string {
    return this.entityIds()
      .map((id) => `${id}=${h.states[id]?.state}@${h.states[id]?.last_changed}`)
      .join('|');
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions(): { columns: number | 'full'; rows: number | 'auto'; min_columns?: number; min_rows?: number } {
    return { columns: 12, rows: 'auto' };
  }

  connectedCallback(): void {
    super.connectedCallback();
    ensureFonts();
  }

  protected missing(id: string): TemplateResult {
    return html`<div class="warn" role="alert">${fill(ARCANE_COPY.missing, { id })}</div>`;
  }
}

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string; preview?: boolean }>;
  }
}

export function registerCard(
  tag: string,
  ctor: CustomElementConstructor,
  meta: { name: string; description: string },
): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
  const cards = (window.customCards = window.customCards ?? []);
  if (!cards.some((c) => c.type === tag)) cards.push({ type: tag, ...meta, preview: true });
}

export function fireMoreInfo(el: HTMLElement, entityId: string): void {
  el.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
}
