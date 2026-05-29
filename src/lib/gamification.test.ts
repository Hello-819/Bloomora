import { describe, expect, it, vi, afterEach } from 'vitest';
import { computeIslandLevel, computeTreeStage, computeStreak, dailyQuests, nextAchievements, earnedAchievementIds } from './gamification';
import type { StudySession, StudyTask, AppState } from '../types';

function session(id: string, endAt: string, durationSec = 120, labelId?: string): StudySession {
  return {
    id,
    startAt: new Date(Date.parse(endAt) - durationSec * 1000).toISOString(),
    endAt,
    durationSec,
    method: 'manual',
    rewardMode: 'island',
    labelId,
    taskIds: [],
    createdAt: endAt,
    updatedAt: endAt,
  };
}

function task(id: string, done: boolean, completedAt?: string): StudyTask {
  return {
    id,
    text: 'Test task',
    done,
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    completedAt,
  };
}

function mockAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 2,
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    profile: {} as any,
    labels: [],
    tasks: [],
    notes: [],
    subjects: [],
    flashcards: [],
    sessions: [],
    gamification: {
      islandXpSec: 0,
      gardenGrowthSec: 0,
      gardenTreeType: 'oak',
      gardenHarvestedOnTree: 0,
      fruitCollection: {},
      achievementIds: [],
      quests: {},
      rewardLog: [],
    },
    sync: { enabled: false, status: 'idle' },
    ...overrides,
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

describe('nextAchievements', () => {
  it('filters out already earned achievements', () => {
    const state = mockAppState({
      gamification: {
        ...mockAppState().gamification,
        achievementIds: ['first-session', 'one-hour'],
      },
    });

    const achievements = nextAchievements(state);

    expect(achievements.some(a => a.id === 'first-session')).toBe(false);
    expect(achievements.some(a => a.id === 'one-hour')).toBe(false);
    expect(achievements.some(a => a.id === 'five-hour-island')).toBe(true);
  });

  it('computes correct progress for unearned achievements', () => {
    // 30 min session => partial one-hour
    // 2.5 hours island => partial island
    // 2 fruit => complete fruit harvest
    const state = mockAppState({
      sessions: [
        session('s1', '2026-04-13T12:00:00.000Z', 30 * 60)
      ],
      gamification: {
        ...mockAppState().gamification,
        islandXpSec: 2.5 * 3600,
        fruitCollection: { apple: 2 },
      },
    });

    const achievements = nextAchievements(state);

    const firstSession = achievements.find(a => a.id === 'first-session');
    expect(firstSession?.progress).toBe(1);

    const oneHour = achievements.find(a => a.id === 'one-hour');
    expect(oneHour?.progress).toBe(0.5);

    const island = achievements.find(a => a.id === 'five-hour-island');
    expect(island?.progress).toBe(0.5);

    const fruit = achievements.find(a => a.id === 'fruit-harvest');
    expect(fruit?.progress).toBe(1);

    const tenSession = achievements.find(a => a.id === 'ten-sessions');
    expect(tenSession?.progress).toBe(0.1);
  });
});

describe('earnedAchievementIds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns nothing when thresholds are not met', () => {
    const state = mockAppState();
    expect(earnedAchievementIds(state)).toEqual([]);
  });

  it('detects newly earned achievements based on thresholds', () => {
    // Note: earnedAchievementIds uses Date.now() internally for studyTotals and computeStreak.
    // We mock the system time so it consistently thinks today is 2026-04-13
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T18:00:00.000Z'));

    const state = mockAppState({
      sessions: [
        session('s1', '2026-04-11T12:00:00.000Z', 3600),
        session('s2', '2026-04-12T12:00:00.000Z', 60),
        session('s3', '2026-04-13T12:00:00.000Z', 60),
      ],
      gamification: {
        ...mockAppState().gamification,
        islandXpSec: 5 * 3600,
        fruitCollection: { apple: 1 },
      },
    });

    const earned = earnedAchievementIds(state);

    expect(earned).toContain('first-session');
    expect(earned).toContain('one-hour');
    expect(earned).toContain('five-hour-island');
    expect(earned).toContain('three-day-streak');
    expect(earned).toContain('fruit-harvest');
    expect(earned).not.toContain('ten-sessions');
  });

  it('keeps previously earned achievements', () => {
    const state = mockAppState({
      gamification: {
        ...mockAppState().gamification,
        achievementIds: ['ten-sessions'],
      },
    });

    const earned = earnedAchievementIds(state);
    expect(earned).toContain('ten-sessions');
  });
});

describe('dailyQuests', () => {
  it('returns 0 progress when there is no activity today', () => {
    const state = mockAppState();
    const nowMs = new Date('2026-04-13T12:00:00.000Z').getTime();
    const quests = dailyQuests(state, nowMs);

    expect(quests[0].progress).toBe(0);
    expect(quests[0].completed).toBe(false);
    expect(quests[1].progress).toBe(0);
    expect(quests[1].completed).toBe(false);
    expect(quests[2].progress).toBe(0);
    expect(quests[2].completed).toBe(false);
  });

  it('computes partial progress correctly', () => {
    const nowStr = '2026-04-13T12:00:00.000Z';
    const nowMs = new Date(nowStr).getTime();

    // 10 minutes session without label
    const state = mockAppState({
      sessions: [session('a', nowStr, 10 * 60)],
    });

    const quests = dailyQuests(state, nowMs);

    expect(quests[0].progress).toBe(10 / 25);
    expect(quests[0].completed).toBe(false);

    expect(quests[1].progress).toBe(0);
    expect(quests[1].completed).toBe(false);

    expect(quests[2].progress).toBe(0);
    expect(quests[2].completed).toBe(false);
  });

  it('detects full completion of all quests', () => {
    const nowStr = '2026-04-13T12:00:00.000Z';
    const nowMs = new Date(nowStr).getTime();

    // 25 minutes session with label
    const state = mockAppState({
      sessions: [session('a', nowStr, 25 * 60, 'label-123')],
      tasks: [task('t1', true, nowStr)],
    });

    const quests = dailyQuests(state, nowMs);

    expect(quests[0].progress).toBe(1);
    expect(quests[0].completed).toBe(true);

    expect(quests[1].progress).toBe(1);
    expect(quests[1].completed).toBe(true);

    expect(quests[2].progress).toBe(1);
    expect(quests[2].completed).toBe(true);
  });

  it('ignores deleted or old data', () => {
    const nowStr = '2026-04-13T12:00:00.000Z';
    const oldStr = '2026-04-12T12:00:00.000Z';
    const nowMs = new Date(nowStr).getTime();

    const delSession = session('del', nowStr, 30 * 60, 'label-123');
    delSession.deletedAt = nowStr;

    const oldSession = session('old', oldStr, 30 * 60, 'label-123');

    const delTask = task('t1', true, nowStr);
    delTask.deletedAt = nowStr;

    const oldTask = task('t2', true, oldStr);

    const state = mockAppState({
      sessions: [delSession, oldSession],
      tasks: [delTask, oldTask],
    });

    const quests = dailyQuests(state, nowMs);

    expect(quests[0].progress).toBe(0);
    expect(quests[0].completed).toBe(false);
    expect(quests[1].progress).toBe(0);
    expect(quests[1].completed).toBe(false);
    expect(quests[2].progress).toBe(0);
    expect(quests[2].completed).toBe(false);
  });
});
