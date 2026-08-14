import type { ClientMsg, ServerMsg } from '@hart/common';

type Handler = (msg: ServerMsg) => void;

/** WebSocket 客户端：自动重连，消息分发 */
export class NetClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Set<Handler>();
  private queue: ClientMsg[] = [];
  connected = false;
  onStatus: (connected: boolean) => void = () => {};

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = this.url.startsWith('ws') ? this.url : `${proto}://${location.host}${this.url}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.connected = true;
      this.onStatus(true);
      for (const m of this.queue) this.ws?.send(JSON.stringify(m));
      this.queue = [];
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.onStatus(false);
      setTimeout(() => this.connect(), 1500);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        for (const h of this.handlers) h(msg);
      } catch {
        /* ignore */
      }
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
}

export const net = new NetClient('/ws');
