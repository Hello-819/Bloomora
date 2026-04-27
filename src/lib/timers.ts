import type { ActiveTimer } from '../types';

export function elapsedForTimer(timer: ActiveTimer, nowMs = Date.now()): number {
  const base = Math.max(0, timer.accumulatedSec || 0);
  if (!timer.running || !timer.lastStartedAt) return base;
  const live = Math.max(0, (nowMs - Date.parse(timer.lastStartedAt)) / 1000);
  return base + live;
}

export function remainingForTimer(timer: ActiveTimer, nowMs = Date.now()): number | null {
  if (!timer.totalSec) return null;
  return Math.max(0, timer.totalSec - elapsedForTimer(timer, nowMs));
}

export function pauseTimerSnapshot(timer: ActiveTimer, nowMs = Date.now()): ActiveTimer {
  return {
    ...timer,
    running: false,
    accumulatedSec: elapsedForTimer(timer, nowMs),
    lastStartedAt: undefined,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function resumeTimerSnapshot(timer: ActiveTimer, nowMs = Date.now()): ActiveTimer {
  return {
    ...timer,
    running: true,
    lastStartedAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
}
