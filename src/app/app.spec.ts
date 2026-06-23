import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TelemetryFrame } from './models';
import { App } from './app';
import { TelemetryService } from './telemetry.service';
import { WorkcellScene } from './workcell-scene';

@Component({
  selector: 'app-workcell-scene',
  template: '<div data-testid="scene-placeholder"></div>',
})
class MockWorkcellScene {
  readonly telemetry = input<TelemetryFrame | null>(null);
  readonly resetRequest = input(0);
  readonly fps = output<number>();
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{
        provide: TelemetryService,
        useValue: {
          frame: signal(null),
          events: signal([]),
          connection: signal('disconnected'),
          stale: signal(true),
          send: vi.fn(),
        },
      }],
    })
      .overrideComponent(App, {
        remove: { imports: [WorkcellScene] },
        add: { imports: [MockWorkcellScene] },
      })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the operator station title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Dual-Arm Assembly Cell');
  });
});
