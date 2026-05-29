import { describe, it, expect, vi } from 'vitest';
import { createDefaultState } from './defaultState';
import * as dates from './dates';

vi.mock('./dates', () => ({
  nowIso: vi.fn(),
}));

describe('createDefaultState', () => {
  it('should create a default state with the current time', () => {
    const mockTime = '2023-10-27T12:00:00.000Z';
    vi.spyOn(dates, 'nowIso').mockReturnValue(mockTime);

    const state = createDefaultState();

    expect(state).toBeDefined();
    expect(state.version).toBe(2);
    expect(state.createdAt).toBe(mockTime);
    expect(state.updatedAt).toBe(mockTime);
  });

  it('should initialize empty collections', () => {
    const state = createDefaultState();

    expect(state.labels).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.notes).toEqual([]);
    expect(state.subjects).toEqual([]);
    expect(state.flashcards).toEqual([]);
    expect(state.sessions).toEqual([]);
  });

  it('should have a default profile', () => {
    const state = createDefaultState();

    expect(state.profile).toBeDefined();
    expect(state.profile.displayName).toBe('Student');
    expect(state.profile.theme).toBe('daybreak');
  });

  it('should have default gamification state', () => {
    const state = createDefaultState();

    expect(state.gamification).toBeDefined();
    expect(state.gamification.islandXpSec).toBe(0);
    expect(state.gamification.gardenTreeType).toBe('Apple');
  });

  it('should match the expected snapshot structure', () => {
    // We test exact return for more strict coverage
    const mockTime = '2024-01-01T00:00:00.000Z';
    vi.spyOn(dates, 'nowIso').mockReturnValue(mockTime);

    const state = createDefaultState();

    expect(state).toEqual({
      version: 2,
      createdAt: mockTime,
      updatedAt: mockTime,
      profile: {
        displayName: 'Student',
        weeklyGoalHours: 10,
        dailyGoalMinutes: 60,
        theme: 'daybreak',
        colorMode: 'light',
        backgroundImage: undefined,
        stopwatchCapOn: true,
        stopwatchCapHours: 6,
        timerRequireLabel: true,
        sessionAmbient: {
          type: 'off',
          volume: 0.4,
        },
        music: {
          lofiVideoId: 'CFGLoQIhmow',
          volume: 60,
          videoBackground: false,
        },
        pomodoro: {
          focusMin: 25,
          shortBreakMin: 5,
          longBreakMin: 15,
          longEvery: 4,
        },
        aiTutor: {
          activeSubjectId: '',
        },
      },
      labels: [],
      tasks: [],
      notes: [],
      subjects: [],
      flashcards: [],
      sessions: [],
      gamification: {
        islandXpSec: 0,
        gardenGrowthSec: 0,
        gardenTreeType: 'Apple',
        gardenHarvestedOnTree: 0,
        fruitCollection: {
          Apple: 0,
          Orange: 0,
          Cherry: 0,
          Mango: 0,
          Peach: 0,
        },
        achievementIds: [],
        quests: {},
        rewardLog: [],
      },
      sync: {
        enabled: false,
        status: 'offline',
      },
    });
  });
});
