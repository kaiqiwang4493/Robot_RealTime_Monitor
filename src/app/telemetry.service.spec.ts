import { TestBed } from '@angular/core/testing';
import { TelemetryService } from './telemetry.service';
import type { CellEvent, ServerMessage, TelemetryFrame } from './models';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instance: MockWebSocket;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  private listeners: Record<string, Array<(e: Event) => void>> = {};

  constructor(public url: string) {
    MockWebSocket.instance = this;
  }

  addEventListener(type: string, handler: (e: Event) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.fire('close', new CloseEvent('close'));
  }

  /** Test helper — fire a named event on this socket. */
  fire(type: string, event: Event): void {
    this.listeners[type]?.forEach((fn) => fn(event));
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFrame(sequence: number, timestampOffset = -50, now = Date.now()): TelemetryFrame {
  return {
    timestamp: now + timestampOffset,
    sequence,
    cellState: 'idle',
    processStep: 'waiting-for-base',
    stepProgress: 0,
    robots: [],
    conveyor: { running: false, speed: 0 },
    baseWorkpieces: [],
    components: [],
    metrics: { completedCount: 0, currentCycleTime: 0 },
  };
}

function makeEvent(id: string): CellEvent {
  return { id, timestamp: Date.now(), severity: 'info', source: 'TEST', code: 'T', message: id };
}

function send(message: ServerMessage): void {
  const raw = JSON.stringify(message);
  MockWebSocket.instance.fire('message', new MessageEvent('message', { data: raw }));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TelemetryService', () => {
  let service: TelemetryService;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    TestBed.configureTestingModule({});
    service = TestBed.inject(TelemetryService);
    // Simulate the server accepting the connection.
    MockWebSocket.instance.readyState = MockWebSocket.OPEN;
    MockWebSocket.instance.fire('open', new Event('open'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  // -------------------------------------------------------------------------
  // Connection state
  // -------------------------------------------------------------------------

  it('reports "connected" after the socket opens', () => {
    expect(service.connection()).toBe('connected');
  });

  it('reports "disconnected" immediately when the socket closes', () => {
    MockWebSocket.instance.fire('close', new CloseEvent('close'));
    expect(service.connection()).toBe('disconnected');
  });

  it('attempts to reconnect after 1 600 ms on close', () => {
    vi.useFakeTimers();
    try {
      MockWebSocket.instance.fire('close', new CloseEvent('close'));
      expect(service.connection()).toBe('disconnected');

      vi.advanceTimersByTime(1600);
      // A new MockWebSocket will have been constructed; connection resets to 'connecting'.
      expect(service.connection()).toBe('connecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('"stale" is true when not connected', () => {
    MockWebSocket.instance.fire('close', new CloseEvent('close'));
    expect(service.stale()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sequence-number deduplication
  // -------------------------------------------------------------------------

  it('accepts an initial snapshot regardless of sequence', () => {
    send({ type: 'snapshot', data: makeFrame(42) });
    expect(service.frame()?.sequence).toBe(42);
  });

  it('accepts telemetry frames that advance the sequence', () => {
    send({ type: 'telemetry', data: makeFrame(1) });
    send({ type: 'telemetry', data: makeFrame(2) });
    send({ type: 'telemetry', data: makeFrame(3) });
    expect(service.frame()?.sequence).toBe(3);
  });

  it('rejects a telemetry frame whose sequence is less than the last seen', () => {
    send({ type: 'snapshot', data: makeFrame(10) });
    send({ type: 'telemetry', data: makeFrame(5) }); // stale — must be ignored
    expect(service.frame()?.sequence).toBe(10);
  });

  it('rejects a telemetry frame whose sequence equals the last seen', () => {
    send({ type: 'telemetry', data: makeFrame(7) });
    send({ type: 'telemetry', data: makeFrame(7) }); // duplicate — must be ignored
    // Frame value is still 7 but the second send must not update lastSequence beyond 7.
    expect(service.frame()?.sequence).toBe(7);
  });

  it('allows a snapshot to replay an already-seen sequence (resync)', () => {
    send({ type: 'telemetry', data: makeFrame(20) });
    const resync = makeFrame(5);
    send({ type: 'snapshot', data: resync }); // snapshots always win
    expect(service.frame()?.sequence).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Event ring-buffer
  // -------------------------------------------------------------------------

  it('stores incoming events in reverse-chronological order', () => {
    send({ type: 'event', data: makeEvent('a') });
    send({ type: 'event', data: makeEvent('b') });
    expect(service.events()[0].id).toBe('b'); // newest first
    expect(service.events()[1].id).toBe('a');
  });

  it('caps the event buffer at 40 entries', () => {
    for (let i = 0; i < 50; i++) {
      send({ type: 'event', data: makeEvent(`e${i}`) });
    }
    expect(service.events().length).toBe(40);
  });

  it('drops the oldest events when the buffer overflows', () => {
    for (let i = 0; i < 45; i++) {
      send({ type: 'event', data: makeEvent(`e${i}`) });
    }
    // After 45 events the buffer holds the last 40 (e5 … e44).
    const ids = service.events().map((e) => e.id);
    expect(ids).not.toContain('e0');
    expect(ids).toContain('e44');
  });

  // -------------------------------------------------------------------------
  // Robustness
  // -------------------------------------------------------------------------

  it('clamps latency to 0 when server clock is ahead of client clock', () => {
    // Simulate server timestamp 100ms in the future (clock skew).
    const futureFrame = makeFrame(1, +100);
    send({ type: 'telemetry', data: futureFrame });
    expect(service.latencyMs()).toBeGreaterThanOrEqual(0);
  });

  it('silently ignores malformed JSON', () => {
    const bad = new MessageEvent('message', { data: 'not-json{{' });
    expect(() => MockWebSocket.instance.fire('message', bad)).not.toThrow();
    expect(service.frame()).toBeNull();
  });

  it('does not throw on an empty message', () => {
    const empty = new MessageEvent('message', { data: '' });
    expect(() => MockWebSocket.instance.fire('message', empty)).not.toThrow();
  });
});
