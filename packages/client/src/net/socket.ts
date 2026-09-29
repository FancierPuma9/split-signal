import { WS_PATH, type ClientMessage, type ServerMessage } from '@split-signal/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

type Listener<T> = (value: T) => void;

function defaultUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${WS_PATH}`;
}

/** The game WebSocket, with automatic reconnect and backoff. */
export class GameSocket {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly statusListeners = new Set<Listener<ConnectionStatus>>();
  status: ConnectionStatus = 'closed';

  constructor(url = defaultUrl()) {
    this.url = url;
  }

  connect(): void {
    if (this.socket) return;
    clearTimeout(this.retryTimer);
    const ws = new WebSocket(this.url);
    this.socket = ws;
    this.setStatus('connecting');

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retries = 0;
      this.setStatus('open');
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws || typeof event.data !== 'string') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      for (const listener of this.messageListeners) listener(message);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.setStatus('closed');
      const delay = Math.min(5000, 500 * 2 ** this.retries++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Closes the connection for good (no reconnect). */
  close(): void {
    clearTimeout(this.retryTimer);
    const ws = this.socket;
    this.socket = null;
    ws?.close();
    this.setStatus('closed');
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: Listener<ServerMessage>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: Listener<ConnectionStatus>): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
