import type { WebSocket } from 'ws';
import type { ServerMsg } from '@hart/common';
import type { Room } from './room.js';

let nextId = 1;

export class Session {
  readonly id: string;
  name = '';
  /** 玩家持久身份（hello 时上报/分配），用于 BYOK 模型归属 */
  pid = '';
  ws: WebSocket;
  room?: Room;
  online = true;

  constructor(ws: WebSocket) {
    this.id = `p${nextId++}`;
    this.ws = ws;
  }

  send(msg: ServerMsg): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
