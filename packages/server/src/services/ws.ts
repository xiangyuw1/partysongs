import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { WsMessage } from '../types.js';

let wss: WebSocketServer | null = null;

export function initWs(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] client connected, total:', wss!.clients.size);
    ws.on('close', () => {
      console.log('[WS] client disconnected, total:', wss!.clients.size);
    });
  });

  return wss;
}

export function broadcast(msg: WsMessage): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function getWsServer(): WebSocketServer | null {
  return wss;
}
