import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { StateEvent } from '../domain/types.js';
import { bridgeMessage, type EntityInfo, type ServerMessage } from './protocol.js';

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

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}
export type ApiHandler = (req: ApiRequest) => Promise<{ status: number; body: unknown }>;

/** Gate for the api tunnel: only plain /api/... paths, no traversal or encoded separators. */
function isSafeApiPath(path: string): boolean {
  if (!path.startsWith('/api/')) return false;
  if (/[\x00-\x1f\x7f\\]/.test(path)) return false;
  if (/%(2e|2f|5c)/i.test(path)) return false;
  const pathname = path.split('?')[0]!;
  if (pathname.split('/').includes('..')) return false;
  try {
    const url = new URL(path, 'http://x');
    return url.pathname.startsWith('/api/') && url.pathname === pathname;
  } catch {
    return false;
  }
}

export class BridgeHub {
  private active: WebSocketLike | null = null;
  private subscriptions: string[] = [];
  private stateHandlers: Array<(ev: StateEvent) => void> = [];
  private actionHandlers: Array<(action: string) => void> = [];
  private entityHandlers: Array<(entities: EntityInfo[]) => void> = [];
  private authHandlers: Array<() => void> = [];
  private apiHandler: ApiHandler | null = null;
  private chunkSocket: WebSocketLike | null = null;
  private chunks: EntityInfo[] = [];

  constructor(private readonly opts: BridgeHubOptions) {
    if (!opts.secret) throw new Error('BridgeHub requires a non-empty secret');
  }

  attach(socket: WebSocketLike): void {
    let state: 'pending' | 'authed' | 'rejected' = 'pending';
    const timer = setTimeout(() => {
      if (state === 'pending') {
        state = 'rejected';
        this.reject(socket, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);
    const deny = (reason: string): void => {
      clearTimeout(timer);
      state = 'rejected';
      this.reject(socket, reason);
    };

    socket.on('message', (raw: unknown) => {
      if (state === 'rejected') return;
      const authed = state === 'authed';
      const text = this.toText(raw);
      if (text === null) {
        if (!authed) {
          deny('bad message');
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
          deny('bad message');
        } else {
          this.opts.log('bridge: invalid JSON ignored');
        }
        return;
      }
      const parsed = bridgeMessage.safeParse(json);

      if (!authed) {
        if (!parsed.success || parsed.data.type !== 'hello' || !secretMatches(this.opts.secret, parsed.data.secret)) {
          deny('unauthorized');
          return;
        }
        clearTimeout(timer);
        state = 'authed';
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
          // A slow HA clock must not be able to shorten timers: never trust a time in the future.
          const at = new Date(Math.min(new Date(msg.at).getTime(), Date.now()));
          const ev: StateEvent = { entityId: msg.entityId, oldState: msg.oldState, newState: msg.newState, at };
          for (const fn of this.stateHandlers) this.safe(() => fn(ev));
          return;
        }
        case 'notification_action':
          for (const fn of this.actionHandlers) this.safe(() => fn(msg.action));
          return;
        case 'result':
          if (!msg.ok) this.opts.log(`bridge: service call ${msg.id} failed: ${msg.error ?? 'unknown'}`);
          return;
        case 'entities': {
          if (msg.chunk === 0 || this.chunkSocket !== socket) {
            this.chunkSocket = socket;
            this.chunks = [];
          }
          this.chunks.push(...msg.entities);
          if (msg.last) {
            const all = this.chunks;
            this.chunks = [];
            this.chunkSocket = null;
            for (const fn of this.entityHandlers) this.safe(() => fn(all));
          }
          return;
        }
        case 'api':
          void this.handleApi(socket, msg);
          return;
        case 'hello':
          return;
      }
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (this.active === socket) this.active = null;
      if (this.chunkSocket === socket) {
        this.chunkSocket = null;
        this.chunks = [];
      }
    });
  }

  isConnected(): boolean {
    return this.active !== null;
  }

  setSubscriptions(entities: string[]): void {
    this.subscriptions = [...entities];
    if (this.active) this.sendTo(this.active, { type: 'subscribe', entities: this.subscriptions });
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
    return this.sendTo(this.active, msg);
  }

  onEntities(fn: (entities: EntityInfo[]) => void): void {
    this.entityHandlers.push(fn);
  }

  onAuthenticated(fn: () => void): void {
    this.authHandlers.push(fn);
  }

  setApiHandler(fn: ApiHandler): void {
    this.apiHandler = fn;
  }

  /** Send to the active bridge; false when none is connected or the send failed. */
  send(msg: ServerMessage): boolean {
    if (!this.active) return false;
    return this.sendTo(this.active, msg);
  }

  private async handleApi(
    socket: WebSocketLike,
    msg: { id: string; method: ApiRequest['method']; path: string; body?: unknown },
  ): Promise<void> {
    let status = 500;
    let body: unknown = { error: 'internal error' };
    if (!isSafeApiPath(msg.path)) {
      status = 400;
      body = { error: 'path must start with /api/' };
    } else if (!this.apiHandler) {
      status = 503;
      body = { error: 'api not available' };
    } else {
      try {
        const req: ApiRequest = { method: msg.method, path: msg.path };
        if (msg.body !== undefined) req.body = msg.body;
        ({ status, body } = await this.apiHandler(req));
      } catch (err) {
        this.opts.log(`bridge: api handler threw: ${String(err)}`);
      }
    }
    if (this.active !== socket) return;
    let result: ServerMessage = { type: 'api_result', id: msg.id, status, body };
    try {
      JSON.stringify(result);
    } catch {
      result = { type: 'api_result', id: msg.id, status: 500, body: { error: 'unserializable' } };
    }
    this.sendTo(socket, result);
  }

  onState(fn: (ev: StateEvent) => void): void {
    this.stateHandlers.push(fn);
  }

  onNotificationAction(fn: (action: string) => void): void {
    this.actionHandlers.push(fn);
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.opts.log(`bridge: handler threw: ${String(err)}`);
    }
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
    this.sendTo(socket, { type: 'welcome' });
    this.sendTo(socket, { type: 'subscribe', entities: this.subscriptions });
    for (const fn of this.authHandlers) this.safe(fn);
  }

  private reject(socket: WebSocketLike, reason: string): void {
    this.sendTo(socket, { type: 'error', reason });
    try {
      socket.close(4001, reason);
    } catch {
      // already closed
    }
  }

  private sendTo(socket: WebSocketLike, msg: ServerMessage): boolean {
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
