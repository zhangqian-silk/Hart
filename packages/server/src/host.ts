import { getGame, type GameDefinition, type TurnInfo } from '@hart/common';
import type { GameEvent, GameOptions, GameResult, PlayerId, PlayerInfo, Rng } from '@hart/common';

/** 一局游戏的服务端托管：持有权威状态，产出 per-player 视图 */
export class GameHost {
  private def: GameDefinition<unknown, unknown>;
  private state: unknown;
  readonly players: PlayerInfo[];

  constructor(
    gameId: string,
    players: PlayerInfo[],
    options: GameOptions,
    rng: Rng = Math.random,
  ) {
    const def = getGame(gameId as never);
    if (!def) throw new Error(`unknown game: ${gameId}`);
    this.def = def;
    this.players = players;
    this.state = def.start(players, options, rng);
  }

  apply(action: unknown, from: PlayerId): GameEvent[] {
    const r = this.def.apply(this.state, action, from);
    this.state = r.state;
    return r.events;
  }

  viewFor(viewer: PlayerId) {
    return {
      view: this.def.view(this.state, viewer),
      turn: this.turn(),
      result: this.result(),
    };
  }

  turn(): TurnInfo {
    return this.def.turn(this.state);
  }

  result(): GameResult | null {
    return this.def.result(this.state);
  }
}
