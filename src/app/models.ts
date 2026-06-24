export type CellState = 'idle' | 'running' | 'paused' | 'faulted';
export type Severity = 'info' | 'warning' | 'error';
export type ProcessStep =
  | 'waiting-for-base'
  | 'positioning-base'
  | 'picking-component'
  | 'placing-component'
  | 'verifying-assembly'
  | 'picking-assembly'
  | 'placing-completed'
  | 'cycle-complete';

export interface RobotState {
  id: 'arm-a' | 'arm-b';
  jointAngles: number[];
  gripperClosed: boolean;
  status: 'idle' | 'moving' | 'holding' | 'faulted';
}

export interface WorkpieceState {
  id: string;
  position: [number, number, number];
  state: 'on-conveyor' | 'at-assembly-station' | 'assembled' | 'held-by-arm-b' | 'completed';
}

export interface ComponentState {
  id: string;
  position: [number, number, number];
  state: 'in-supply' | 'held-by-arm-a' | 'being-placed' | 'attached';
  attachedTo?: string;
}

export interface CellEvent {
  id: string;
  timestamp: number;
  severity: Severity;
  source: string;
  code: string;
  message: string;
}

export interface TelemetryFrame {
  timestamp: number;
  sequence: number;
  cellState: CellState;
  processStep: ProcessStep;
  stepProgress: number;
  robots: RobotState[];
  conveyor: { running: boolean; speed: number };
  baseWorkpieces: WorkpieceState[];
  components: ComponentState[];
  metrics: { completedCount: number; currentCycleTime: number };
  activeAlert?: CellEvent;
}

export type ClientCommand =
  | { type: 'start' | 'pause' | 'reset' }
  | { type: 'inject-warning' | 'inject-error'; target: 'arm-a' | 'arm-b' | 'conveyor' };

export type ServerMessage =
  | { type: 'snapshot' | 'telemetry'; data: TelemetryFrame }
  | { type: 'event'; data: CellEvent };

export const PROCESS_STEPS: { key: ProcessStep; label: string; short: string; durationMs: number }[] = [
  { key: 'positioning-base',  label: 'Position base workpiece',  short: 'LOAD',     durationMs: 3200 },
  { key: 'picking-component', label: 'Pick top component',       short: 'PICK',     durationMs: 3600 },
  { key: 'placing-component', label: 'Place component',          short: 'ASSEMBLE', durationMs: 4200 },
  { key: 'verifying-assembly',label: 'Verify assembly',          short: 'VERIFY',   durationMs: 1600 },
  { key: 'picking-assembly',  label: 'Pick assembled workpiece', short: 'TRANSFER', durationMs: 3500 },
  { key: 'placing-completed', label: 'Place in completed area',  short: 'COMPLETE', durationMs: 4200 },
];

export function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
