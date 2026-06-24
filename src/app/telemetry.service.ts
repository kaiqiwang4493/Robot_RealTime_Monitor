import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ClientCommand, CellEvent, ServerMessage, TelemetryFrame } from './models';

const LATENCY_WINDOW = 20; // rolling sample count for p95 jitter

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly destroyRef = inject(DestroyRef);
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private lastSequence = -1;
  private latencySamples: number[] = [];

  readonly frame = signal<TelemetryFrame | null>(null);
  readonly events = signal<CellEvent[]>([]);
  readonly connection = signal<'connecting' | 'connected' | 'disconnected'>('connecting');
  readonly stale = computed(() => this.connection() !== 'connected');
  readonly latencyMs = signal<number | null>(null);
  readonly jitterMs = signal<number | null>(null);

  constructor() {
    this.connect();
    this.destroyRef.onDestroy(() => {
      window.clearTimeout(this.reconnectTimer);
      this.socket?.close();
    });
  }

  send(command: ClientCommand): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(command));
    }
  }

  private connect(): void {
    this.connection.set('connecting');
    const isLocalAngular = location.hostname === 'localhost' && location.port === '4200';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = isLocalAngular ? 'ws://localhost:8080/telemetry' : `${protocol}//${location.host}/telemetry`;
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => this.connection.set('connected'));
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data as string));
    this.socket.addEventListener('close', () => {
      this.connection.set('disconnected');
      this.reconnectTimer = window.setTimeout(() => this.connect(), 1600);
    });
    this.socket.addEventListener('error', () => this.socket?.close());
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as ServerMessage;
      if (message.type === 'event') {
        this.events.update((events) => [message.data, ...events].slice(0, 40));
        return;
      }
      if (message.data.sequence <= this.lastSequence && message.type !== 'snapshot') return;
      this.lastSequence = message.data.sequence;
      this.frame.set(message.data);
      this.updateLatency(message.data.timestamp);
    } catch {
      // Malformed simulator messages are ignored to protect the operator view.
    }
  }

  private updateLatency(frameTimestamp: number): void {
    const latency = Date.now() - frameTimestamp;
    this.latencySamples = [...this.latencySamples, latency].slice(-LATENCY_WINDOW);
    this.latencyMs.set(latency);

    if (this.latencySamples.length >= 2) {
      const sorted = [...this.latencySamples].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p05Index = Math.floor(sorted.length * 0.05);
      this.jitterMs.set(sorted[p95Index] - sorted[p05Index]);
    }
  }
}
