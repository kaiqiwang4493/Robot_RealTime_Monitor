import type {
  CellEvent,
  ClientCommand,
  ComponentState,
  ProcessStep,
  RobotState,
  TelemetryFrame,
  WorkpieceState,
} from '../src/app/models.ts';

type EventListener = (event: CellEvent) => void;

const STEP_DURATION: Record<ProcessStep, number> = {
  'waiting-for-base': 0,
  'positioning-base': 3200,
  'picking-component': 3600,
  'placing-component': 4200,
  'verifying-assembly': 1600,
  'picking-assembly': 3500,
  'placing-completed': 4200,
  'cycle-complete': 1200,
};

const STEP_ORDER: ProcessStep[] = [
  'positioning-base',
  'picking-component',
  'placing-component',
  'verifying-assembly',
  'picking-assembly',
  'placing-completed',
  'cycle-complete',
];

const ARM_A_ROOT: [number, number, number] = [-3.8, 0.2, -2.45];
const ARM_B_ROOT: [number, number, number] = [3.8, 0.2, 2.45];
const SUPPLY_POSITION: [number, number, number] = [-5.1, 0.55, -1.15];
const ASSEMBLY_POSITION: [number, number, number] = [0, 1.12, 0];
const COMPLETED_POSITION: [number, number, number] = [5.15, 0.43, 1.1];
const ARM_A_HOME_TARGET: [number, number, number] = [-2.4, 3.35, -1.45];
const ARM_B_HOME_TARGET: [number, number, number] = [2.4, 3.35, 1.45];

function robotPose(
  root: [number, number, number],
  target: [number, number, number],
  toolLength = 1.42,
  upperLength = 3.0,
  foreLength = 2.3,
): number[] {
  const shoulderHeight = root[1] + 1.08;
  const dx = target[0] - root[0];
  const dz = target[2] - root[2];
  const planarX = Math.hypot(dx, dz);
  const planarY = target[1] + toolLength - shoulderHeight;
  const rawDistance = Math.hypot(planarX, planarY);
  const distance = Math.min(rawDistance, upperLength + foreLength - 0.04);
  const directionScale = rawDistance === 0 ? 1 : distance / rawDistance;
  const x = planarX * directionScale;
  const y = planarY * directionScale;
  const phi = Math.atan2(y, x);
  const shoulderOffset = Math.acos(clampUnit(
    (distance ** 2 + upperLength ** 2 - foreLength ** 2) / (2 * distance * upperLength),
  ));
  const foreOffset = Math.acos(clampUnit(
    (distance ** 2 + foreLength ** 2 - upperLength ** 2) / (2 * distance * foreLength),
  ));
  const upperWorldAngle = phi + shoulderOffset;
  const foreWorldAngle = phi - foreOffset;
  const shoulder = upperWorldAngle - Math.PI / 2;
  const elbow = foreWorldAngle - upperWorldAngle;
  const wrist = -Math.PI - shoulder - elbow;
  const yaw = Math.atan2(-dz, dx);
  return [yaw, shoulder, elbow, wrist].map((angle) => THREE_RAD_TO_DEG * angle);
}

const THREE_RAD_TO_DEG = 180 / Math.PI;
const ARM_A_POSES = {
  home: robotPose(ARM_A_ROOT, ARM_A_HOME_TARGET),
  supplyAbove: robotPose(ARM_A_ROOT, [SUPPLY_POSITION[0], 2.15, SUPPLY_POSITION[2]]),
  supply: robotPose(ARM_A_ROOT, SUPPLY_POSITION),
  assemblyAbove: robotPose(ARM_A_ROOT, [ASSEMBLY_POSITION[0], 2.65, ASSEMBLY_POSITION[2]]),
  assembly: robotPose(ARM_A_ROOT, [ASSEMBLY_POSITION[0], 1.55, ASSEMBLY_POSITION[2]]),
};
const ARM_B_POSES = {
  home: robotPose(ARM_B_ROOT, ARM_B_HOME_TARGET, 1.9, 2.95, 2.45),
  conveyorAbove: robotPose(ARM_B_ROOT, [ASSEMBLY_POSITION[0], 2.65, ASSEMBLY_POSITION[2]], 1.9, 2.95, 2.45),
  conveyor: robotPose(ARM_B_ROOT, ASSEMBLY_POSITION, 1.9, 2.95, 2.45),
  completedAbove: robotPose(ARM_B_ROOT, [COMPLETED_POSITION[0], 2.45, COMPLETED_POSITION[2]], 1.9, 2.95, 2.45),
  completed: robotPose(ARM_B_ROOT, COMPLETED_POSITION, 1.9, 2.95, 2.45),
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function ease(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * ease(t);
}

function lerpTuple(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

function lerpPose(from: number[], to: number[], t: number): number[] {
  return from.map((value, index) => lerp(value, to[index] ?? value, t));
}

export class CellSimulation {
  private state: TelemetryFrame;
  private stepStartedAt = Date.now();
  private cycleStartedAt = Date.now();
  private pausedAt = 0;
  private activeWarningUntil = 0;
  private listeners = new Set<EventListener>();
  private workpieceCounter = 1;

  constructor() {
    this.state = this.createInitialState();
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  command(command: ClientCommand, now = Date.now()): void {
    switch (command.type) {
      case 'start':
        this.start(now);
        break;
      case 'pause':
        this.pause(now);
        break;
      case 'reset':
        this.reset(now);
        break;
      case 'inject-warning':
        this.injectWarning(command.target, now);
        break;
      case 'inject-error':
        this.injectError(command.target, now);
        break;
    }
  }

  tick(now = Date.now()): TelemetryFrame {
    if (this.state.activeAlert?.severity === 'warning' && now >= this.activeWarningUntil) {
      this.state.activeAlert = undefined;
    }

    if (this.state.cellState === 'running') {
      this.advanceState(now);
      this.state.metrics.currentCycleTime = now - this.cycleStartedAt;
    }

    this.state.timestamp = now;
    this.state.sequence += 1;
    return structuredClone(this.state);
  }

  snapshot(now = Date.now()): TelemetryFrame {
    this.state.timestamp = now;
    return structuredClone(this.state);
  }

  private createInitialState(): TelemetryFrame {
    return {
      timestamp: Date.now(),
      sequence: 0,
      cellState: 'idle',
      processStep: 'waiting-for-base',
      stepProgress: 0,
      robots: [
        this.robot('arm-a', ARM_A_POSES.home),
        this.robot('arm-b', ARM_B_POSES.home),
      ],
      conveyor: { running: false, speed: 0 },
      baseWorkpieces: [this.baseWorkpiece()],
      components: [this.component()],
      metrics: { completedCount: 0, currentCycleTime: 0 },
    };
  }

  private robot(id: 'arm-a' | 'arm-b', jointAngles: number[]): RobotState {
    return { id, jointAngles: [...jointAngles], gripperClosed: false, status: 'idle' };
  }

  private baseWorkpiece(): WorkpieceState {
    return {
      id: `BASE-${String(this.workpieceCounter).padStart(3, '0')}`,
      position: [-3.7, 1.12, 0],
      state: 'on-conveyor',
    };
  }

  private component(): ComponentState {
    return {
      id: `TOP-${String(this.workpieceCounter).padStart(3, '0')}`,
      position: [...SUPPLY_POSITION],
      state: 'in-supply',
    };
  }

  private start(now: number): void {
    if (this.state.cellState === 'faulted' || this.state.cellState === 'running') return;
    if (this.state.cellState === 'paused') {
      const pausedDuration = now - this.pausedAt;
      this.stepStartedAt += pausedDuration;
      this.cycleStartedAt += pausedDuration;
    } else {
      this.setStep('positioning-base', now);
      this.cycleStartedAt = now;
    }
    this.state.cellState = 'running';
    this.emit('info', 'CELL', 'CELL_STARTED', 'Automatic assembly cycle started.', now);
  }

  private pause(now: number): void {
    if (this.state.cellState !== 'running') return;
    this.state.cellState = 'paused';
    this.state.conveyor.running = false;
    this.state.conveyor.speed = 0;
    this.state.robots.forEach((robot) => (robot.status = 'idle'));
    this.pausedAt = now;
    this.emit('info', 'CELL', 'CELL_PAUSED', 'Cell motion paused by operator.', now);
  }

  private reset(now: number): void {
    const completedCount = this.state.metrics.completedCount;
    const sequence = this.state.sequence;
    this.state = this.createInitialState();
    this.state.metrics.completedCount = completedCount;
    this.state.sequence = sequence;
    this.state.timestamp = now;
    this.stepStartedAt = now;
    this.cycleStartedAt = now;
    this.activeWarningUntil = 0;
    this.emit('info', 'SAFETY', 'CELL_RESET', 'Cell returned to a verified safe state.', now);
  }

  private injectWarning(target: string, now: number): void {
    const event = this.makeEvent(
      'warning',
      target.toUpperCase(),
      'ALIGNMENT_TOLERANCE',
      'Arm A placement alignment is approaching the operating tolerance limit.',
      now,
    );
    this.state.activeAlert = event;
    this.activeWarningUntil = now + 6000;
    this.broadcast(event);
  }

  private injectError(target: string, now: number): void {
    const event = this.makeEvent(
      'error',
      target.toUpperCase(),
      'VERIFICATION_FAILED',
      'Component placement verification failed. Cell motion has been suspended.',
      now,
    );
    this.state.activeAlert = event;
    this.state.cellState = 'faulted';
    this.state.conveyor = { running: false, speed: 0 };
    this.state.robots.forEach((robot) => (robot.status = 'faulted'));
    this.broadcast(event);
  }

  private advanceState(now: number): void {
    const duration = STEP_DURATION[this.state.processStep];
    const progress = duration === 0 ? 0 : clamp((now - this.stepStartedAt) / duration);
    this.state.stepProgress = progress;
    this.applyStepMotion(this.state.processStep, progress);
    if (progress < 1) return;

    const index = STEP_ORDER.indexOf(this.state.processStep);
    if (index === STEP_ORDER.length - 1) {
      this.completeCycle(now);
      return;
    }
    this.setStep(STEP_ORDER[index + 1], now);
  }

  private setStep(step: ProcessStep, now: number): void {
    this.state.processStep = step;
    this.state.stepProgress = 0;
    this.stepStartedAt = now;
    this.emit('info', 'PROCESS', `STEP_${step.toUpperCase().replaceAll('-', '_')}`, this.stepMessage(step), now);
  }

  private applyStepMotion(step: ProcessStep, progress: number): void {
    const armA = this.state.robots[0];
    const armB = this.state.robots[1];
    const base = this.state.baseWorkpieces[0];
    const component = this.state.components[0];
    armA.status = 'idle';
    armB.status = 'idle';
    this.state.conveyor = { running: false, speed: 0 };

    switch (step) {
      case 'positioning-base':
        this.state.conveyor = { running: true, speed: 0.42 };
        base.position = lerpTuple([-3.7, 1.12, 0], [0, 1.12, 0], progress);
        base.state = progress < 0.98 ? 'on-conveyor' : 'at-assembly-station';
        break;
      case 'picking-component': {
        armA.status = progress > 0.72 ? 'holding' : 'moving';
        if (progress < 0.45) {
          armA.jointAngles = lerpPose(ARM_A_POSES.home, ARM_A_POSES.supplyAbove, progress / 0.45);
        } else if (progress < 0.7) {
          armA.jointAngles = lerpPose(ARM_A_POSES.supplyAbove, ARM_A_POSES.supply, (progress - 0.45) / 0.25);
        } else {
          armA.jointAngles = lerpPose(ARM_A_POSES.supply, ARM_A_POSES.supplyAbove, (progress - 0.7) / 0.3);
        }
        armA.gripperClosed = progress >= 0.7;
        if (armA.gripperClosed) {
          component.state = 'held-by-arm-a';
        }
        break;
      }
      case 'placing-component': {
        armA.status = progress < 0.82 ? 'holding' : 'moving';
        if (progress < 0.45) {
          armA.jointAngles = lerpPose(ARM_A_POSES.supplyAbove, ARM_A_POSES.assemblyAbove, progress / 0.45);
        } else if (progress < 0.72) {
          armA.jointAngles = lerpPose(ARM_A_POSES.assemblyAbove, ARM_A_POSES.assembly, (progress - 0.45) / 0.27);
        } else {
          armA.jointAngles = lerpPose(ARM_A_POSES.assembly, ARM_A_POSES.assemblyAbove, (progress - 0.72) / 0.28);
        }
        component.state = progress < 0.72 ? 'being-placed' : 'attached';
        armA.gripperClosed = progress < 0.72;
        if (progress >= 0.72) component.attachedTo = base.id;
        break;
      }
      case 'verifying-assembly':
        base.state = 'assembled';
        component.state = 'attached';
        component.attachedTo = base.id;
        component.position = [base.position[0], base.position[1] + 0.43, base.position[2]];
        armA.status = 'moving';
        armA.jointAngles = lerpPose(ARM_A_POSES.assemblyAbove, ARM_A_POSES.home, progress);
        armA.gripperClosed = false;
        break;
      case 'picking-assembly':
        base.state = progress >= 0.7 ? 'held-by-arm-b' : 'assembled';
        armB.status = progress >= 0.7 ? 'holding' : 'moving';
        if (progress < 0.45) {
          armB.jointAngles = lerpPose(ARM_B_POSES.home, ARM_B_POSES.conveyorAbove, progress / 0.45);
        } else if (progress < 0.7) {
          armB.jointAngles = lerpPose(ARM_B_POSES.conveyorAbove, ARM_B_POSES.conveyor, (progress - 0.45) / 0.25);
        } else {
          armB.jointAngles = lerpPose(ARM_B_POSES.conveyor, ARM_B_POSES.conveyorAbove, (progress - 0.7) / 0.3);
        }
        armB.gripperClosed = progress >= 0.7;
        component.position = [base.position[0], base.position[1] + 0.43, base.position[2]];
        break;
      case 'placing-completed':
        base.state = progress < 0.72 ? 'held-by-arm-b' : 'completed';
        armB.status = progress < 0.72 ? 'holding' : 'moving';
        if (progress < 0.45) {
          armB.jointAngles = lerpPose(ARM_B_POSES.conveyorAbove, ARM_B_POSES.completedAbove, progress / 0.45);
        } else if (progress < 0.72) {
          armB.jointAngles = lerpPose(ARM_B_POSES.completedAbove, ARM_B_POSES.completed, (progress - 0.45) / 0.27);
        } else {
          armB.jointAngles = lerpPose(ARM_B_POSES.completed, ARM_B_POSES.completedAbove, (progress - 0.72) / 0.28);
        }
        armB.gripperClosed = progress < 0.72;
        if (progress >= 0.72) base.position = [...COMPLETED_POSITION];
        component.position = [base.position[0], base.position[1] + 0.43, base.position[2]];
        break;
      case 'cycle-complete':
        base.state = 'completed';
        component.position = [base.position[0], base.position[1] + 0.43, base.position[2]];
        armB.status = 'moving';
        armB.jointAngles = lerpPose(ARM_B_POSES.completedAbove, ARM_B_POSES.home, progress);
        armB.gripperClosed = false;
        break;
      case 'waiting-for-base':
        break;
    }
  }

  private completeCycle(now: number): void {
    this.state.metrics.completedCount += 1;
    this.emit(
      'info',
      'PROCESS',
      'CYCLE_COMPLETE',
      `Assembly ${this.state.baseWorkpieces[0].id} completed successfully.`,
      now,
    );
    this.workpieceCounter += 1;
    this.state.baseWorkpieces = [this.baseWorkpiece()];
    this.state.components = [this.component()];
    this.state.robots[0] = this.robot('arm-a', ARM_A_POSES.home);
    this.state.robots[1] = this.robot('arm-b', ARM_B_POSES.home);
    this.cycleStartedAt = now;
    this.setStep('positioning-base', now);
  }

  private stepMessage(step: ProcessStep): string {
    const messages: Record<ProcessStep, string> = {
      'waiting-for-base': 'Cell is waiting for an operator start command.',
      'positioning-base': 'Conveyor is positioning a base workpiece at the assembly station.',
      'picking-component': 'Arm A is retrieving a top component from the supply area.',
      'placing-component': 'Arm A is installing the component onto the base workpiece.',
      'verifying-assembly': 'The simulated vision check is verifying component placement.',
      'picking-assembly': 'Arm B is collecting the verified assembly from the conveyor.',
      'placing-completed': 'Arm B is transferring the assembly to the completed zone.',
      'cycle-complete': 'The current assembly cycle is complete.',
    };
    return messages[step];
  }

  private emit(severity: 'info' | 'warning' | 'error', source: string, code: string, message: string, now: number): void {
    this.broadcast(this.makeEvent(severity, source, code, message, now));
  }

  private makeEvent(
    severity: 'info' | 'warning' | 'error',
    source: string,
    code: string,
    message: string,
    timestamp: number,
  ): CellEvent {
    return {
      id: `${timestamp}-${code}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      severity,
      source,
      code,
      message,
    };
  }

  private broadcast(event: CellEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
