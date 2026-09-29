import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  TICK_INTERVAL_MS,
  WS_PATH,
  parseClientMessage,
  type AnyPuzzleServerModule,
  type IceServerConfig,
  type ServerMessage,
} from '@split-signal/shared';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { GameServer, type Connection } from './game-server';
import { createStaticHandler } from './http/static';
import type { MatchTimings } from './match/match-engine';
import type { AccountService } from './stats/accounts';

export interface ServerOptions {
  port: number;
  catalog: readonly AnyPuzzleServerModule[];
  /** Built client bundle to serve over HTTP. */
  clientDist: string;
  timings?: Partial<MatchTimings>;
  heartbeatMs?: number;
  iceServers?: IceServerConfig[];
  accounts?: AccountService;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** Starts the HTTP + WebSocket server and the game loop. */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const game = new GameServer({
    catalog: options.catalog,
    timings: options.timings,
    iceServers: options.iceServers,
    accounts: options.accounts,
  });
  const http = createServer(createStaticHandler(options.clientDist));
  // Room for one clip (MAX_CLIP_BASE64) plus JSON overhead.
  const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 320 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (socket) => {
    const conn: Connection = {
      send(message: ServerMessage) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    game.connect(conn);

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = parseClientMessage(rawToString(data));
      if (!message) {
        conn.send({ type: 'error', message: 'Malformed message' });
        return;
      }
      try {
        game.handle(conn, message);
      } catch (error) {
        console.error('Error handling', message.type, error);
        conn.send({ type: 'error', message: 'Something went wrong on the server' });
      }
    });

    socket.on('close', () => game.disconnect(conn));
  });

  const timers = [
    // Drop sockets that stop answering pings (sleeping laptops, dead networks) so matches pause.
    setInterval(() => {
      for (const socket of wss.clients) {
        if (!alive.get(socket)) {
          socket.terminate();
          continue;
        }
        alive.set(socket, false);
        socket.ping();
      }
    }, options.heartbeatMs ?? 15_000),
    setInterval(() => game.tick(), TICK_INTERVAL_MS),
    setInterval(() => game.sweep(), 1000),
  ];

  return new Promise((resolve) => {
    http.listen(options.port, () => {
      resolve({
        port: (http.address() as AddressInfo).port,
        close: async () => {
          for (const timer of timers) clearInterval(timer);
          for (const socket of wss.clients) socket.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
