import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { StateEvent } from '../domain/types.js';
import { bridgeMessage, type ServerMessage } from './protocol.js';

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(ev: 'message' | 'close', fn: (...args: any[]) => void): void;
}

export interface BridgeHubOptions {
  secret: string;
  log: (msg: string) => void;
}

const AUTH_TIMEOUT_MS = 5000;
const MAX_MESSAGE_BYTES = 64 * 1024;

function secretMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class BridgeHub {
  private active: WebSocketLike | null = null;
  private subscriptions: string[] = [];
  private stateHandlers: Array<(ev: StateEvent) => void> = [];
  private actionHandlers: Array<(action: string) => void> = [];

  constructor(private readonly opts: BridgeHubOptions) {}

  attach(socket: WebSocketLike): void {
    let authed = false;
    const timer = setTimeout(() => {
      if (!authed) this.reject(socket, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    socket.on('message', (raw: unknown) => {
      const text = this.toText(raw);
      if (text === null) {
        if (!authed) {
          clearTimeout(timer);
          this.reject(socket, 'bad message');
        } else {
          this.opts.log('bridge: oversized or unreadable message ignored');
        }
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        if (!authed) {
          clearTimeout(timer);
          this.reject(socket, 'bad message');
        } else {
          this.opts.log('bridge: invalid JSON ignored');
        }
        return;
      }
      const parsed = bridgeMessage.safeParse(json);

      if (!authed) {
        clearTimeout(timer);
        if (!parsed.success || parsed.data.type !== 'hello' || !secretMatches(this.opts.secret, parsed.data.secret)) {
          this.reject(socket, 'unauthorized');
          return;
        }
        authed = true;
        this.promote(socket);
        return;
      }

      if (!parsed.success) {
        this.opts.log('bridge: unknown message ignored');
        return;
      }
      if (this.active !== socket) return;
      const msg = parsed.data;
      switch (msg.type) {
        case 'state': {
          const at = new Date(msg.at);
          if (Number.isNaN(at.getTime())) {
            this.opts.log('bridge: state with invalid timestamp ignored');
            return;
          }
          const ev: StateEvent = { entityId: msg.entityId, oldState: msg.oldState, newState: msg.newState, at };
          for (const fn of this.stateHandlers) fn(ev);
          return;
        }
        case 'notification_action':
          for (const fn of this.actionHandlers) fn(msg.action);
          return;
        case 'result':
          if (!msg.ok) this.opts.log(`bridge: service call ${msg.id} failed: ${msg.error ?? 'unknown'}`);
          return;
        case 'hello':
          return;
      }
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (this.active === socket) this.active = null;
    });
  }

  isConnected(): boolean {
    return this.active !== null;
  }

  setSubscriptions(entities: string[]): void {
    this.subscriptions = [...entities];
    if (this.active) this.send(this.active, { type: 'subscribe', entities: this.subscriptions });
  }

  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    target?: { entity_id: string | string[] },
  ): boolean {
    if (!this.active) {
      this.opts.log(`bridge: not connected, dropping ${domain}.${service}`);
      return false;
    }
    const msg: ServerMessage = { type: 'call_service', id: randomUUID(), domain, service, data };
    if (target) msg.target = target;
    return this.send(this.active, msg);
  }

  onState(fn: (ev: StateEvent) => void): void {
    this.stateHandlers.push(fn);
  }

  onNotificationAction(fn: (action: string) => void): void {
    this.actionHandlers.push(fn);
  }

  private promote(socket: WebSocketLike): void {
    const previous = this.active;
    this.active = socket;
    if (previous) {
      try {
        previous.close(4002, 'replaced');
      } catch {
        // already closing
      }
    }
    this.send(socket, { type: 'welcome' });
    this.send(socket, { type: 'subscribe', entities: this.subscriptions });
  }

  private reject(socket: WebSocketLike, reason: string): void {
    this.send(socket, { type: 'error', reason });
    try {
      socket.close(4001, reason);
    } catch {
      // already closed
    }
  }

  private send(socket: WebSocketLike, msg: ServerMessage): boolean {
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      this.opts.log(`bridge: send failed: ${String(err)}`);
      return false;
    }
  }

  private toText(raw: unknown): string | null {
    let buf: Buffer;
    if (typeof raw === 'string') buf = Buffer.from(raw);
    else if (Buffer.isBuffer(raw)) buf = raw;
    else if (Array.isArray(raw)) buf = Buffer.concat(raw as Buffer[]);
    else if (raw instanceof ArrayBuffer) buf = Buffer.from(raw);
    else return null;
    if (buf.length > MAX_MESSAGE_BYTES) return null;
    return buf.toString('utf8');
  }
}
