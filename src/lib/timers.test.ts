import { describe, expect, it } from 'vitest';
import type { ActiveTimer } from '../types';
import { elapsedForTimer, pauseTimerSnapshot, remainingForTimer, resumeTimerSnapshot } from './timers';

const baseTimer: ActiveTimer = {
  id: 'timer_1',
  mode: 'countdown',
  running: true,
  startedAt: '2026-04-13T10:00:00.000Z',
  lastStartedAt: '2026-04-13T10:00:00.000Z',
  accumulatedSec: 30,
  totalSec: 120,
  labeling: { rewardMode: 'island', taskIds: [] },
  updatedAt: '2026-04-13T10:00:00.000Z',
};

describe('timestamp timers', () => {
  it('computes elapsed time from the last running anchor', () => {
    const elapsed = elapsedForTimer(baseTimer, Date.parse('2026-04-13T10:00:45.000Z'));
    expect(elapsed).toBe(75);
    expect(remainingForTimer(baseTimer, Date.parse('2026-04-13T10:00:45.000Z'))).toBe(45);
  });

  it('freezes elapsed time when paused and resumes from that snapshot', () => {
    const paused = pauseTimerSnapshot(baseTimer, Date.parse('2026-04-13T10:00:45.000Z'));
    expect(paused.running).toBe(false);
    expect(paused.accumulatedSec).toBe(75);
    const resumed = resumeTimerSnapshot(paused, Date.parse('2026-04-13T10:02:00.000Z'));
    expect(elapsedForTimer(resumed, Date.parse('2026-04-13T10:02:10.000Z'))).toBe(85);
  });
});
