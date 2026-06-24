import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientCommand, ServerMessage } from '../src/app/models.ts';
import { CellSimulation } from './simulation.ts';

const app = express();
const server = createServer(app);
const simulation = new CellSimulation();
const sockets = new Set<WebSocket>();
const webSocketServer = new WebSocketServer({ server, path: '/telemetry' });
const port = Number(process.env['PORT'] ?? 8080);
const publicDirectory = resolve(process.cwd(), 'dist/dual-arm-digital-twin/browser');

app.disable('x-powered-by');
app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'dual-arm-digital-twin', clients: sockets.size });
});

if (existsSync(publicDirectory)) {
  app.use(express.static(publicDirectory, { maxAge: '1h', index: false }));
  app.get(/.*/, (_request, response) => response.sendFile(resolve(publicDirectory, 'index.html')));
} else {
  app.get('/', (_request, response) => {
    response.type('text').send('Frontend build not found. Run "npm run build" or use "npm run dev".');
  });
}

webSocketServer.on('connection', (socket) => {
  sockets.add(socket);
  send(socket, { type: 'snapshot', data: simulation.snapshot() });

  socket.on('message', (raw) => {
    try {
      const command = JSON.parse(raw.toString()) as ClientCommand;
      if (command?.type === 'ping') {
        send(socket, { type: 'pong', sentAt: command.sentAt });
        return;
      }
      if (!isCommand(command)) return;
      simulation.command(command);
    } catch {
      // Invalid client commands are deliberately ignored.
    }
  });

  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
});

simulation.subscribe((event) => broadcast({ type: 'event', data: event }));

const interval = setInterval(() => {
  broadcast({ type: 'telemetry', data: simulation.tick() });
}, 100);

server.listen(port, '0.0.0.0', () => {
  console.log(`Dual-arm simulator listening on http://0.0.0.0:${port}`);
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  sockets.forEach((socket) => send(socket, message));
}

function isCommand(value: ClientCommand): boolean {
  return (
    value?.type === 'start' ||
    value?.type === 'pause' ||
    value?.type === 'reset' ||
    value?.type === 'inject-warning' ||
    value?.type === 'inject-error'
  );
}

function shutdown(): void {
  clearInterval(interval);
  sockets.forEach((socket) => socket.terminate());
  sockets.clear();
  webSocketServer.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
