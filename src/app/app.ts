import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { PROCESS_STEPS, ProcessStep, Severity, titleCase } from './models';
import { TelemetryService } from './telemetry.service';
import { WorkcellScene } from './workcell-scene';

@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, WorkcellScene],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly destroyRef = inject(DestroyRef);
  readonly telemetry = inject(TelemetryService);
  readonly processSteps = PROCESS_STEPS;
  readonly fps = signal(0);
  readonly resetCameraRequest = signal(0);
  readonly now = signal(Date.now());
  readonly frame = this.telemetry.frame;
  readonly stateLabel = computed(() => titleCase(this.frame()?.cellState ?? 'connecting'));
  readonly stepLabel = computed(() => titleCase(this.frame()?.processStep ?? 'waiting-for-base'));
  readonly activeStepIndex = computed(() =>
    this.processSteps.findIndex((step) => step.key === this.frame()?.processStep),
  );
  readonly currentWorkpiece = computed(() => this.frame()?.baseWorkpieces[0]);
  readonly activeStepDurationMs = computed(() => {
    const step = this.processSteps.find((s) => s.key === this.frame()?.processStep);
    return step?.durationMs ?? 0;
  });
  readonly stepElapsedMs = computed(() =>
    Math.round((this.frame()?.stepProgress ?? 0) * this.activeStepDurationMs()),
  );

  constructor() {
    const timer = window.setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  command(type: 'start' | 'pause' | 'reset'): void {
    this.telemetry.send({ type });
  }

  injectAlert(type: 'inject-warning' | 'inject-error'): void {
    this.telemetry.send({ type, target: 'arm-a' });
  }

  resetCamera(): void {
    this.resetCameraRequest.update((value) => value + 1);
  }

  setFps(value: number): void {
    this.fps.set(value);
  }

  robot(id: 'arm-a' | 'arm-b') {
    return this.frame()?.robots.find((robot) => robot.id === id);
  }

  severityClass(severity?: Severity): string {
    return severity ?? 'info';
  }

  isStepComplete(index: number): boolean {
    const current = this.activeStepIndex();
    return current === -1 ? this.frame()?.processStep === 'cycle-complete' : index < current;
  }

  formatAngle(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`;
  }
}
