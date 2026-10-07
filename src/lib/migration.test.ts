import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { migrateV1State, readV1StateFromLocalStorage, V1_STORAGE_KEY } from './migration';

describe('readV1StateFromLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns null if no v1 state in local storage', () => {
    expect(readV1StateFromLocalStorage()).toBeNull();
  });

  it('returns null if local storage contains invalid JSON', () => {
    window.localStorage.setItem(V1_STORAGE_KEY, 'invalid json');
    expect(readV1StateFromLocalStorage()).toBeNull();
  });

  it('correctly parses and migrates a valid v1 state stringified in local storage', () => {
    const v1State = {
      profile: {
        name: 'Ayyan',
        weeklyGoalHours: 12,
        theme: 'emerald',
      },
    };
    window.localStorage.setItem(V1_STORAGE_KEY, JSON.stringify(v1State));

    const migrated = readV1StateFromLocalStorage();
    expect(migrated).not.toBeNull();
    expect(migrated?.profile.displayName).toBe('Ayyan');
    expect(migrated?.profile.theme).toBe('grove');
  });
});

describe('v1 migration', () => {
  it('preserves sessions, labels, tasks, worlds, fruit, audio, and pomodoro settings', () => {
    const migrated = migrateV1State({
      profile: {
        name: 'Ayyan',
        weeklyGoalHours: 12,
        theme: 'emerald',
        sessionAmbient: { type: 'sea', volume: 0.7 },
      },
      audio: { lofiVideoId: 'abc123', ytVolume: 42, videoBgOn: true },
      pomodoro: { focusMin: 40, breakMin: 8, longBreakMin: 25, longEvery: 3 },
      labels: {
        items: [{ id: 'lbl_math', name: 'Maths', color: '#0f766e', favorite: true, createdTs: 1000 }],
      },
      tasks: [{ id: 'task_1', text: 'Past paper', desc: 'Section A', labelId: 'lbl_math', done: true, createdTs: 2000 }],
      sessions: [{ id: 's1', durationSec: 1800, label: 'Maths', method: 'timer', rewardMode: 'garden', endTs: 3000000 }],
      island: { xpSec: 3600 },
      garden: { growthSec: 4000, treeType: 'Cherry', harvestedOnThisTree: 2 },
      fruitCollection: { Cherry: 5 },
    });

    expect(migrated.profile.displayName).toBe('Ayyan');
    expect(migrated.profile.theme).toBe('grove');
    expect(migrated.profile.pomodoro.focusMin).toBe(40);
    expect(migrated.labels[0].name).toBe('Maths');
    expect(migrated.tasks[0].labelId).toBe('lbl_math');
    expect(migrated.sessions[0].labelId).toBe('lbl_math');
    expect(migrated.gamification.islandXpSec).toBe(3600);
    expect(migrated.gamification.fruitCollection.Cherry).toBe(5);
  });
});

describe('normalizing newer V2 fields', () => {
  it('keeps deadlines, results, flashcard reviews and profile details from a backup', async () => {
    const { createDefaultState } = await import('./defaultState');
    const { normalizeImportedState } = await import('./migration');
    const base = createDefaultState();
    const normalized = normalizeImportedState({
      ...base,
      profile: { ...base.profile, educationLevel: 'university', institution: 'UCL', avatarImage: 'javascript:alert(1)' },
      flashcards: [{ id: 'c1', front: 'Q', back: 'A', createdAt: base.createdAt, updatedAt: base.updatedAt, review: { dueAt: '2026-05-01T00:00:00.000Z', intervalDays: 3, ease: 2.5, reps: 2, lapses: 0 } }],
      deadlines: [{ id: 'd1', title: 'Essay', kind: 'coursework', dueAt: '2026-05-10', status: 'bogus', createdAt: base.createdAt, updatedAt: base.updatedAt }],
      assessments: [{ id: 'a1', title: 'Mock', score: 45, maxScore: 60, date: '2026-03-01', createdAt: base.createdAt, updatedAt: base.updatedAt }],
    });
    expect(normalized?.profile.educationLevel).toBe('university');
    expect(normalized?.profile.institution).toBe('UCL');
    expect(normalized?.profile.avatarImage).toBeUndefined();
    expect(normalized?.flashcards[0].review?.intervalDays).toBe(3);
    expect(normalized?.deadlines[0]).toMatchObject({ kind: 'coursework', status: 'not-started' });
    expect(normalized?.assessments[0]).toMatchObject({ score: 45, maxScore: 60 });
  });

  it('fills in new fields for backups made before they existed', async () => {
    const { createDefaultState } = await import('./defaultState');
    const { normalizeImportedState } = await import('./migration');
    const legacy = createDefaultState() as unknown as Record<string, unknown>;
    delete legacy.deadlines;
    delete legacy.assessments;
    const normalized = normalizeImportedState(legacy);
    expect(normalized?.deadlines).toEqual([]);
    expect(normalized?.assessments).toEqual([]);
    expect(normalized?.profile.educationLevel).toBe('sixth-form');
  });
});
