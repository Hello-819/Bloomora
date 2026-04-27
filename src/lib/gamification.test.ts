import { describe, expect, it } from 'vitest';
import { computeIslandLevel, computeTreeStage, computeStreak } from './gamification';
import type { StudySession } from '../types';

function session(id: string, endAt: string, durationSec = 120): StudySession {
  return {
    id,
    startAt: new Date(Date.parse(endAt) - durationSec * 1000).toISOString(),
    endAt,
    durationSec,
    method: 'manual',
    rewardMode: 'island',
    taskIds: [],
    createdAt: endAt,
    updatedAt: endAt,
  };
}

describe('gamification math', () => {
  it('levels the island every five hours', () => {
    expect(computeIslandLevel(0)).toMatchObject({ level: 0, pct: 0 });
    expect(computeIslandLevel(5 * 3600)).toMatchObject({ level: 1, pct: 0, nextLevel: 2 });
    expect(computeIslandLevel(7.5 * 3600)).toMatchObject({ level: 1, pct: 50 });
  });

  it('tracks garden growth stages', () => {
    expect(computeTreeStage(0).current.name).toBe('Seed');
    expect(computeTreeStage(60 * 60).current.name).toBe('Plant');
    expect(computeTreeStage(2 * 3600).current.name).toBe('Tree');
  });

  it('computes current and longest streaks from local day keys', () => {
    const now = new Date('2026-04-13T12:00:00').getTime();
    const sessions = [
      session('a', '2026-04-11T18:00:00.000Z'),
      session('b', '2026-04-12T18:00:00.000Z'),
      session('c', '2026-04-13T18:00:00.000Z'),
      session('d', '2026-04-08T18:00:00.000Z'),
    ];
    expect(computeStreak(sessions, now)).toEqual({ current: 3, longest: 3 });
  });
});
