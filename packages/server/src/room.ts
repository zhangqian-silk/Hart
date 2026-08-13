import { getGame, type GameMeta } from '@hart/common';
import type { ChatMsg, GameEvent, GameOptions, PlayerId, RoomCode, SeatInfo } from '@hart/common';
import { GameHost } from './host.js';
import type { Session } from './session.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genCode(exists: (c: RoomCode) => boolean): RoomCode {
  for (let i = 0; i < 100; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!exists(c)) return c;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export class Room {
  readonly code: RoomCode;
  readonly game: string;
  host: PlayerId;
  seats: (Session | null)[];
  ready = new Set<PlayerId>();
  options: GameOptions;
  status: 'waiting' | 'playing' | 'finished' = 'waiting';
  chat: ChatMsg[] = [];
  private chatId = 0;
  private gameHost: GameHost | null = null;
  private players: { id: PlayerId; name: string; seat: number }[] = [];

  constructor(code: RoomCode, game: string, host: Session) {
    this.code = code;
    this.game = game;
    const meta = getGame(game as never)?.meta as GameMeta | undefined;
    this.options = meta?.options
      ? Object.fromEntries(meta.options.map((o) => [o.key, o.default]))
      : {};
    const max = meta?.maxPlayers ?? 10;
    this.seats = Array.from({ length: max }, () => null);
    this.host = host.id;
  }

  get meta(): GameMeta | undefined {
    return getGame(this.game as never)?.meta as GameMeta | undefined;
  }

  members(): Session[] {
    return this.seats.filter((s): s is Session => !!s);
  }

  sit(session: Session, seat: number): string | null {
    if (this.status === 'playing') return '对局进行中';
    if (seat < 0 || seat >= this.seats.length) return '座位不存在';
    if (this.seats[seat]) return '座位已被占用';
    const old = this.seats.indexOf(session);
    if (old >= 0) this.seats[old] = null;
    this.ready.delete(session.id);
    this.seats[seat] = session;
    session.room = this;
    this.broadcast();
    return null;
  }

  stand(session: Session): void {
    const i = this.seats.indexOf(session);
    if (i >= 0) this.seats[i] = null;
    this.ready.delete(session.id);
    this.broadcast();
  }

  leave(session: Session): void {
    this.stand(session);
    session.room = undefined;
    if (this.status === 'playing') return;
    if (this.host === session.id) {
      const next = this.members()[0];
      if (next) this.host = next.id;
    }
    this.broadcast();
  }

  setReady(session: Session, ready: boolean): void {
    if (ready) this.ready.add(session.id);
    else this.ready.delete(session.id);
    this.broadcast();
  }

  setOptions(session: Session, options: GameOptions): string | null {
    if (session.id !== this.host) return '只有房主可以修改设置';
    this.options = { ...this.options, ...options };
    this.broadcast();
    return null;
  }

  addChat(from: Session, text: string, system = false): void {
    this.chat.push({
      id: ++this.chatId,
      from: from.id,
      name: from.name,
      text,
      ts: Date.now(),
      system,
    });
    if (this.chat.length > 200) this.chat = this.chat.slice(-200);
    this.broadcast();
  }

  canStart(): string | null {
    const meta = this.meta;
    if (!meta) return '未知游戏';
    if (this.status === 'playing') return '对局进行中';
    const members = this.members();
    if (members.length < meta.minPlayers) return `至少需要 ${meta.minPlayers} 人`;
    if (members.length > meta.maxPlayers) return `最多 ${meta.maxPlayers} 人`;
    const notReady = members.filter((m) => !this.ready.has(m.id) && m.id !== this.host);
    if (notReady.length > 0) return '还有玩家未准备';
    return null;
  }

  start(session: Session): string | null {
    if (session.id !== this.host) return '只有房主可以开始';
    const err = this.canStart();
    if (err) return err;
    const members = this.members();
    this.players = members.map((m, i) => ({ id: m.id, name: m.name, seat: i }));
    this.gameHost = new GameHost(this.game, this.players, this.options);
    this.status = 'playing';
    this.addChat(session, `对局开始（${this.meta?.name}）`, true);
    this.broadcast();
    return null;
  }

  action(session: Session, action: unknown): string | null {
    if (this.status !== 'playing' || !this.gameHost) return '对局未在进行';
    try {
      const events = this.gameHost.apply(action, session.id);
      for (const e of events) this.broadcastEvent(e);
      if (this.gameHost.result()) {
        this.status = 'finished';
        this.addChat(session, '对局结束', true);
      }
      this.broadcast();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '非法操作';
    }
  }

  viewFor(session: Session) {
    const seats: SeatInfo[] = this.seats.map((s, i) => ({
      seat: i,
      player: s ? { id: s.id, name: s.name } : null,
      ready: s ? this.ready.has(s.id) : false,
      online: s ? s.online : false,
      isHost: s ? s.id === this.host : false,
    }));
    const base = {
      code: this.code,
      game: this.game as never,
      host: this.host,
      seats,
      options: this.options,
      status: this.status,
      chat: this.chat,
    };
    if (
      this.status !== 'waiting' &&
      this.gameHost &&
      this.players.some((p) => p.id === session.id)
    ) {
      return { ...base, gameState: this.gameHost.viewFor(session.id) };
    }
    return base;
  }

  broadcast(): void {
    for (const m of this.members()) {
      m.send({ t: 'room.state', room: this.viewFor(m) });
    }
  }

  broadcastEvent(event: GameEvent): void {
    for (const m of this.members()) {
      m.send({ t: 'room.event', event });
    }
  }
}
