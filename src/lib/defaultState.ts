import type { AppState } from '../types';
import { nowIso } from './dates';

export function createDefaultState(): AppState {
  const now = nowIso();
  return {
    version: 2,
    createdAt: now,
    updatedAt: now,
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
      hiddenSidebarItems: [],
      hideAiTutor: false,
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
    timetable: undefined,
  };
}
