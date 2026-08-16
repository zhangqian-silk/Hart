import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGame, type GameId, type GameMeta } from '@hart/common';
import type { ChatMsg, GameEvent, GameOptions, PlayerId, RoomCode, SeatInfo } from '@hart/common';
import {
  AgentDriver,
  createProvider,
  type AgentProfile,
} from '@hart/agent';
import { GameHost } from './host.js';
import type { Session } from './session.js';
import { AgentSession } from './agent-session.js';
import { getAgentConfig } from './agent-store.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genCode(exists: (c: RoomCode) => boolean): RoomCode {
  for (let i = 0; i < 100; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!exists(c)) return c;
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** 座位占用者：人类或 AI */
export type SeatOccupant = Session | AgentSession;

export class Room {
  readonly code: RoomCode;
  readonly game: string;
  host: PlayerId;
  seats: (SeatOccupant | null)[];
  ready = new Set<PlayerId>();
  options: GameOptions;
  status: 'waiting' | 'playing' | 'finished' = 'waiting';
  chat: ChatMsg[] = [];
  private chatId = 0;
  private gameHost: GameHost | null = null;
  private driver: AgentDriver | null = null;
  private players: { id: PlayerId; name: string; seat: number }[] = [];
  private replayEvents: GameEvent[] = [];

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

  members(): SeatOccupant[] {
    return this.seats.filter((s): s is SeatOccupant => !!s);
  }

  /** AI 座位列表 */
  agents(): AgentSession[] {
    return this.seats.filter((s): s is AgentSession => s instanceof AgentSession);
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

  /** 房主添加 AI 到指定座位（或自动选座） */
  addAgent(
    session: Session,
    seat: number | undefined,
    profileId: string,
    providerKind?: string,
  ): string | null {
    if (session.id !== this.host) return '只有房主可以添加 AI';
    if (this.status === 'playing') return '对局进行中';
    const config = getAgentConfig(profileId);
    if (!config) return `未知 Agent: ${profileId}`;
    // 适用游戏检查：games 为空表示适用全部
    if (config.games && config.games.length > 0 && !config.games.includes(this.game as GameId)) {
      return `Agent「${config.name}」不适用于本游戏`;
    }
    let target = seat;
    if (target === undefined) {
      target = this.seats.findIndex((s) => !s);
      if (target < 0) return '房间已满';
    }
    if (target < 0 || target >= this.seats.length) return '座位不存在';
    if (this.seats[target]) return '座位已被占用';
    try {
      const profile: AgentProfile = {
        id: config.id,
        name: config.name,
        persona: config.persona,
        strategy: config.strategy,
        ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
        ...(config.gamePolicy ? { gamePolicy: config.gamePolicy } : {}),
      };
      const kind = providerKind ?? config.provider?.kind ?? 'scripted';
      const provider = createProvider(
        kind,
        profile,
        (config.provider ?? {}) as Record<string, unknown>,
      );
      const agent = new AgentSession(profile, provider);
      agent.room = this;
      this.seats[target] = agent;
      this.ready.add(agent.id); // AI 自动准备
      this.addChat(session, `添加了 AI 玩家「${profile.name}」`, true);
      this.broadcast();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '创建 AI 失败';
    }
  }

  /** 房主移除 AI */
  removeAgent(session: Session, seat: number): string | null {
    if (session.id !== this.host) return '只有房主可以移除 AI';
    if (this.status === 'playing') return '对局进行中';
    const occupant = this.seats[seat];
    if (!occupant) return '座位为空';
    if (!(occupant instanceof AgentSession)) return '该座位不是 AI';
    this.seats[seat] = null;
    this.ready.delete(occupant.id);
    void occupant.provider.stop().catch(() => {});
    this.addChat(session, `移除了 AI 玩家「${occupant.name}」`, true);
    this.broadcast();
    return null;
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

  addChat(from: { id: PlayerId; name: string }, text: string, system = false): void {
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
    this.replayEvents = [];

    // 为 AI 座位创建驱动器
    const agentSeats = new Map<PlayerId, { profile: AgentSession['profile']; provider: AgentSession['provider'] }>();
    for (const a of this.agents()) {
      agentSeats.set(a.id, { profile: a.profile, provider: a.provider });
      void a.provider.start().catch(() => {});
    }
    if (agentSeats.size > 0 && this.gameHost) {
      this.driver = new AgentDriver(this.gameHost, agentSeats);
    }

    this.addChat(session, `对局开始（${this.meta?.name}）`, true);
    this.broadcast();
    // 如果先手是 AI，立即驱动
    void this.pumpAgents();
    return null;
  }

  action(session: Session, action: unknown): string | null {
    if (this.status !== 'playing' || !this.gameHost) return '对局未在进行';
    try {
      const events = this.gameHost.apply(action, session.id);
      this.afterAction(events, session);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '非法操作';
    }
  }

  /** 动作后的统一处理：广播事件、检查终局、驱动 AI */
  private afterAction(events: GameEvent[], actor: { id: PlayerId; name: string }): void {
    for (const e of events) {
      this.replayEvents.push(e);
      this.broadcastEvent(e);
    }
    if (this.gameHost?.result()) {
      this.status = 'finished';
      this.addChat(actor, '对局结束', true);
      this.saveReplay();
      // 停止所有 AI
      for (const a of this.agents()) {
        void a.provider.stop().catch(() => {});
      }
    }
    this.broadcast();
    void this.pumpAgents();
  }

  /** 驱动所有轮到的 AI 座位 */
  private async pumpAgents(): Promise<void> {
    if (!this.driver || !this.gameHost || this.status !== 'playing') return;
    // 标记思考中
    const turn = this.gameHost.turn();
    const thinking = this.agents().filter((a) => turn.active.includes(a.id));
    for (const a of thinking) a.status = 'thinking';
    if (thinking.length > 0) this.broadcast();

    try {
      const events = await this.driver.pump();
      if (events.length > 0) {
        // AI 动作产生的事件
        const agentActors = this.agents();
        const actor = agentActors[0] ?? { id: 'agent', name: 'AI' };
        this.afterAction(events, actor);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 决策失败';
      this.addChat({ id: 'system', name: '系统' }, `AI 错误: ${msg}`, true);
    } finally {
      for (const a of thinking) a.status = 'idle';
      this.broadcast();
    }
  }

  /** 保存对局回放 */
  private saveReplay(): void {
    try {
      const dir = join(process.cwd(), 'data', 'replays');
      mkdirSync(dir, { recursive: true });
      const file = join(
        dir,
        `${this.game}-${this.code}-${Date.now()}.json`,
      );
      writeFileSync(
        file,
        JSON.stringify(
          {
            gameId: this.game,
            roomCode: this.code,
            players: this.players,
            events: this.replayEvents,
            result: this.gameHost?.result() ?? null,
            finishedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch {
      // 回放保存失败不影响游戏
    }
  }

  viewFor(session: SeatOccupant) {
    const seats: SeatInfo[] = this.seats.map((s, i) => {
      const base: SeatInfo = {
        seat: i,
        player: s ? { id: s.id, name: s.name } : null,
        ready: s ? this.ready.has(s.id) : false,
        online: s ? s.online : false,
        isHost: s ? s.id === this.host : false,
      };
      if (s instanceof AgentSession) {
        base.agent = {
          profileId: s.profile.id,
          profileName: s.profile.name,
          kind: s.provider.kind,
          status: s.status,
        };
      }
      return base;
    });
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
