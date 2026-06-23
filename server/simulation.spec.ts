import { describe, expect, it } from 'vitest';
import { CellSimulation } from './simulation.ts';

describe('CellSimulation', () => {
  it('starts, pauses, and resets safely', () => {
    const simulation = new CellSimulation();
    simulation.command({ type: 'start' }, 1000);
    expect(simulation.tick(1100).cellState).toBe('running');

    simulation.command({ type: 'pause' }, 1200);
    expect(simulation.tick(1300).cellState).toBe('paused');

    simulation.command({ type: 'reset' }, 1400);
    const reset = simulation.tick(1500);
    expect(reset.cellState).toBe('idle');
    expect(reset.processStep).toBe('waiting-for-base');
    expect(reset.sequence).toBeGreaterThan(1);
  });

  it('keeps a warning non-blocking and makes an error stop the full cell', () => {
    const simulation = new CellSimulation();
    simulation.command({ type: 'start' }, 1000);
    simulation.command({ type: 'inject-warning', target: 'arm-a' }, 1100);
    expect(simulation.tick(1200).cellState).toBe('running');

    simulation.command({ type: 'inject-error', target: 'arm-a' }, 1300);
    const fault = simulation.tick(1400);
    expect(fault.cellState).toBe('faulted');
    expect(fault.conveyor.running).toBe(false);
    expect(fault.robots.every((robot) => robot.status === 'faulted')).toBe(true);
  });

  it('attaches the component before Arm B transfers the assembly', () => {
    const simulation = new CellSimulation();
    simulation.command({ type: 'start' }, 0);
    let frame = simulation.tick(0);
    for (let now = 100; now <= 13000; now += 100) frame = simulation.tick(now);

    expect(['verifying-assembly', 'picking-assembly']).toContain(frame.processStep);
    expect(frame.components[0].state).toBe('attached');
    expect(frame.components[0].attachedTo).toBe(frame.baseWorkpieces[0].id);
  });

  it('does not pick up parts before the gripper reaches the contact phase', () => {
    const simulation = new CellSimulation();
    simulation.command({ type: 'start' }, 0);
    simulation.tick(3200);

    const approaching = simulation.tick(3200 + 0.68 * 3600);
    expect(approaching.components[0].state).toBe('in-supply');
    expect(approaching.robots[0].gripperClosed).toBe(false);

    const grasped = simulation.tick(3200 + 0.72 * 3600);
    expect(grasped.components[0].state).toBe('held-by-arm-a');
    expect(grasped.robots[0].gripperClosed).toBe(true);
  });

  it('completes a cycle and creates the next tracked workpiece', () => {
    const simulation = new CellSimulation();
    simulation.command({ type: 'start' }, 0);
    let frame = simulation.tick(0);
    for (let now = 100; now <= 24000; now += 100) frame = simulation.tick(now);

    expect(frame.metrics.completedCount).toBe(1);
    expect(frame.baseWorkpieces[0].id).toBe('BASE-002');
    expect(frame.processStep).toBe('positioning-base');
  });
});
