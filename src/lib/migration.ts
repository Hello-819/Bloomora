import type {
  ActiveTimer,
  AmbientType,
  AppState,
  Flashcard,
  Label,
  RewardMode,
  StudyNote,
  StudyMethod,
  StudySession,
  StudySubject,
  StudyTask,
  ThemeName,
} from '../types';
import { createDefaultState } from './defaultState';
import { nowIso } from './dates';
import { createId } from './id';

export const V1_STORAGE_KEY = 'bloomora_v1';

const THEME_MAP: Record<string, ThemeName> = {
  midnight: 'ink',
  violet: 'daybreak',
  emerald: 'grove',
  ocean: 'aqua',
  sunset: 'daybreak',
  daybreak: 'daybreak',
  grove: 'grove',
  aqua: 'aqua',
  ink: 'ink',
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isoFromTs(value: unknown, fallback = Date.now()): string {
  const ms = asNumber(value, fallback);
  return new Date(ms).toISOString();
}

function normalizeRewardMode(value: unknown): RewardMode {
  return value === 'garden' ? 'garden' : 'island';
}

function normalizeStudyMethod(value: unknown): StudyMethod {
  if (value === 'stopwatch' || value === 'timer' || value === 'pomodoro' || value === 'manual') return value;
  return 'manual';
}

function normalizeAmbient(value: unknown): AmbientType {
  if (value === 'fire' || value === 'wind' || value === 'sea' || value === 'nature') return value;
  return 'off';
}

function subjectFromTutor(value: unknown): StudySubject | null {
  const tutor = asObject(value);
  const name = asString(tutor.subject).trim();
  const qualification = asString(tutor.qualification).trim();
  const examBoard = asString(tutor.examBoard).trim();
  const targetGrade = asString(tutor.targetGrade).trim();
  const examDate = asString(tutor.examDate).trim();
  if (!name && !qualification && !examBoard && !targetGrade && !examDate) return null;
  const now = nowIso();
  return {
    id: createId('subject'),
    name: name || 'Study subject',
    qualification,
    examBoard,
    targetGrade,
    examDate,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSubjects(value: unknown): StudySubject[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = asObject(item);
      const now = nowIso();
      const id = asString(source.id, createId('subject'));
      return {
        id,
        name: asString(source.name, 'Study subject').slice(0, 80) || 'Study subject',
        qualification: asString(source.qualification).slice(0, 80),
        examBoard: asString(source.examBoard).slice(0, 80),
        targetGrade: asString(source.targetGrade).slice(0, 80),
        examDate: asString(source.examDate).slice(0, 80),
        createdAt: validIsoString(source.createdAt, now),
        updatedAt: validIsoString(source.updatedAt, now),
        deletedAt: validOptionalIso(source.deletedAt),
      };
    })
    .filter((subject) => subject.id);
}

function normalizeFlashcards(value: unknown): Flashcard[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = asObject(item);
      const now = nowIso();
      const id = asString(source.id, createId('card'));
      return {
        id,
        front: asString(source.front).slice(0, 1000),
        back: asString(source.back).slice(0, 2000),
        subjectId: asString(source.subjectId) || undefined,
        labelId: asString(source.labelId) || undefined,
        createdAt: validIsoString(source.createdAt, now),
        updatedAt: validIsoString(source.updatedAt, now),
        deletedAt: validOptionalIso(source.deletedAt),
      };
    })
    .filter((card) => card.id && (card.front || card.back));
}

function validIsoString(value: unknown, fallback = nowIso()): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return fallback;
}

function validOptionalIso(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return undefined;
}

function migrateLabels(value: unknown): Label[] {
  const labelsRoot = asObject(value);
  const items = Array.isArray(labelsRoot.items) ? labelsRoot.items : [];
  return items.map((item) => {
    const source = asObject(item);
    const createdAt = isoFromTs(source.createdTs, Date.now());
    return {
      id: asString(source.id, createId('lbl')),
      name: asString(source.name, 'Untitled').slice(0, 40),
      color: asString(source.color, '#38bdf8'),
      favorite: Boolean(source.favorite),
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function migrateTasks(value: unknown, labels: Label[]): StudyTask[] {
  const items = Array.isArray(value) ? value : [];
  const validLabels = new Set(labels.map((label) => label.id));
  return items.map((item) => {
    const source = asObject(item);
    const createdAt = isoFromTs(source.createdTs, Date.now());
    const labelId = asString(source.labelId);
    const done = Boolean(source.done);
    return {
      id: asString(source.id, createId('task')),
      text: asString(source.text, '').slice(0, 120) || 'Untitled task',
      notes: asString(source.desc ?? source.notes, '').slice(0, 280),
      labelId: validLabels.has(labelId) ? labelId : undefined,
      done,
      createdAt,
      updatedAt: createdAt,
      completedAt: done ? createdAt : undefined,
    };
  });
}

function migrateNotes(value: unknown, labels: Label[]): StudyNote[] {
  const items = Array.isArray(value) ? value : [];
  const validLabels = new Set(labels.map((label) => label.id));
  return items.map((item) => {
    const source = asObject(item);
    const createdAt = isoFromTs(source.createdTs ?? source.createdAt, Date.now());
    const updatedAt = isoFromTs(source.updatedTs ?? source.updatedAt, Date.now());
    const labelId = asString(source.labelId);
    return {
      id: asString(source.id, createId('note')),
      title: asString(source.title, 'Untitled note').slice(0, 80),
      body: asString(source.body ?? source.text, '').slice(0, 12000),
      labelId: validLabels.has(labelId) ? labelId : undefined,
      pinned: Boolean(source.pinned),
      createdAt,
      updatedAt,
    };
  });
}

function migrateSessions(value: unknown, labels: Label[]): StudySession[] {
  const items = Array.isArray(value) ? value : [];
  const labelsByName = new Map(labels.map((label) => [label.name.trim().toLowerCase(), label]));
  return items.map((item) => {
    const source = asObject(item);
    const durationSec = Math.max(0, Math.round(asNumber(source.durationSec)));
    const endAt = isoFromTs(source.endTs, Date.now());
    const startAt = source.startTs
      ? isoFromTs(source.startTs)
      : new Date(Date.parse(endAt) - durationSec * 1000).toISOString();
    const labelName = asString(source.label).trim();
    const label = labelsByName.get(labelName.toLowerCase());
    const createdAt = endAt;
    return {
      id: asString(source.clientId || source.id, createId('sess')),
      startAt,
      endAt,
      durationSec,
      method: normalizeStudyMethod(source.method),
      rewardMode: normalizeRewardMode(source.rewardMode),
      note: asString(source.note ?? source.notes).slice(0, 1200) || undefined,
      labelId: label?.id,
      labelNameSnapshot: labelName || label?.name,
      taskIds: [],
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function migrateActiveTimer(value: unknown): ActiveTimer | undefined {
  const source = asObject(value);
  const mode = source.mode;
  if (mode !== 'stopwatch' && mode !== 'countdown' && mode !== 'pomodoro') return undefined;
  const now = nowIso();
  return {
    id: asString(source.id, createId('timer')),
    mode,
    running: Boolean(source.running),
    startedAt: asString(source.startedAt, now),
    lastStartedAt: asString(source.lastStartedAt, undefined as unknown as string) || undefined,
    accumulatedSec: asNumber(source.accumulatedSec),
    totalSec: source.totalSec == null ? undefined : asNumber(source.totalSec),
    labeling: {
      rewardMode: normalizeRewardMode(asObject(source.labeling).rewardMode),
      labelId: asString(asObject(source.labeling).labelId) || undefined,
      taskIds: Array.isArray(asObject(source.labeling).taskIds)
        ? (asObject(source.labeling).taskIds as unknown[]).map(String)
        : [],
    },
    updatedAt: asString(source.updatedAt, now),
  };
}

export function migrateV1State(raw: unknown): AppState {
  const defaults = createDefaultState();
  const source = asObject(raw);
  const profile = asObject(source.profile);
  const audio = asObject(source.audio);
  const ambient = asObject(audio.ambient);
  const pomodoro = asObject(source.pomodoro);
  const labels = migrateLabels(source.labels);
  const tasks = migrateTasks(source.tasks, labels);
  const notes = migrateNotes(source.notes, labels);
  const sessions = migrateSessions(source.sessions, labels);
  const island = asObject(source.island);
  const garden = asObject(source.garden);
  const fruitCollection = asObject(source.fruitCollection);
  const now = nowIso();
  const migratedSubject = subjectFromTutor(asObject(profile).aiTutor);

  return {
    ...defaults,
    createdAt: now,
    updatedAt: now,
    profile: {
      displayName: asString(profile.name, defaults.profile.displayName),
      weeklyGoalHours: asNumber(profile.weeklyGoalHours, defaults.profile.weeklyGoalHours),
      dailyGoalMinutes: Math.min(1440, Math.max(1, asNumber(profile.dailyGoalMinutes, defaults.profile.dailyGoalMinutes))),
      theme: THEME_MAP[asString(profile.theme, defaults.profile.theme)] ?? defaults.profile.theme,
      colorMode: asString(profile.theme) === 'midnight' ? 'dark' : defaults.profile.colorMode,
      stopwatchCapOn: profile.stopwatchCapOn !== false,
      stopwatchCapHours: Math.min(24, Math.max(1, asNumber(profile.stopwatchCapHours, 6))),
      timerRequireLabel: profile.timerRequireLabel !== false,
      sessionAmbient: {
        type: normalizeAmbient(asObject(profile.sessionAmbient).type),
        volume: Math.min(1, Math.max(0, asNumber(asObject(profile.sessionAmbient).volume, 0.4))),
      },
      music: {
        lofiVideoId: asString(audio.lofiVideoId, defaults.profile.music.lofiVideoId),
        volume: Math.min(100, Math.max(0, asNumber(audio.ytVolume, defaults.profile.music.volume))),
        videoBackground: Boolean(audio.videoBgOn),
      },
      pomodoro: {
        focusMin: Math.min(180, Math.max(1, asNumber(pomodoro.focusMin, defaults.profile.pomodoro.focusMin))),
        shortBreakMin: Math.min(60, Math.max(1, asNumber(pomodoro.breakMin, defaults.profile.pomodoro.shortBreakMin))),
        longBreakMin: Math.min(120, Math.max(1, asNumber(pomodoro.longBreakMin, defaults.profile.pomodoro.longBreakMin))),
        longEvery: Math.min(12, Math.max(2, asNumber(pomodoro.longEvery, defaults.profile.pomodoro.longEvery))),
      },
      aiTutor: {
        activeSubjectId: migratedSubject?.id || '',
      },
      hiddenSidebarItems: Array.isArray(asObject(source.profile).hiddenSidebarItems) ? asObject(source.profile).hiddenSidebarItems as string[] : [],
      hideAiTutor: typeof asObject(source.profile).hideAiTutor === 'boolean' ? asObject(source.profile).hideAiTutor as boolean : false,
    },
    labels,
    tasks,
    notes,
    subjects: migratedSubject ? [migratedSubject] : [],
    flashcards: [],
    sessions,
    activeTimer: migrateActiveTimer(source.activeTimer),
    gamification: {
      ...defaults.gamification,
      islandXpSec: asNumber(island.xpSec ?? source.island_xp_sec),
      gardenGrowthSec: asNumber(garden.growthSec ?? source.garden_growth_sec),
      gardenTreeType: asString(garden.treeType, defaults.gamification.gardenTreeType),
      gardenHarvestedOnTree: asNumber(garden.harvestedOnThisTree ?? garden.harvested_on_tree),
      fruitCollection: {
        ...defaults.gamification.fruitCollection,
        ...Object.fromEntries(
          Object.entries(fruitCollection).map(([key, value]) => [key, Math.max(0, Math.round(asNumber(value)))]),
        ),
      },
    },
  };
}

export function readV1StateFromLocalStorage(): AppState | null {
  try {
    const raw = window.localStorage.getItem(V1_STORAGE_KEY);
    if (!raw) return null;
    return migrateV1State(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function normalizeImportedState(value: unknown): AppState | null {
  const source = asObject(value);
  if (source.version === 2 && source.profile && source.gamification) {
    const defaults = createDefaultState();
    const state = source as unknown as AppState;
    const oldTutorSubject = subjectFromTutor(asObject(source.profile).aiTutor);
    const subjects = normalizeSubjects(state.subjects);
    const repairedSubjects = subjects.length || !oldTutorSubject ? subjects : [oldTutorSubject];
    const rawTutor = asObject(asObject(source.profile).aiTutor);
    const rawActiveSubjectId = asString(rawTutor.activeSubjectId);
    const activeSubjectId = repairedSubjects.some((subject) => !subject.deletedAt && subject.id === rawActiveSubjectId)
      ? rawActiveSubjectId
      : repairedSubjects.find((subject) => !subject.deletedAt)?.id || '';
    return {
      ...defaults,
      ...state,
      profile: {
        ...defaults.profile,
        ...state.profile,
        colorMode:
          state.profile?.colorMode === 'dark' || state.profile?.colorMode === 'light'
            ? state.profile.colorMode
            : state.profile?.theme === 'ink'
              ? 'dark'
              : defaults.profile.colorMode,
        sessionAmbient: { ...defaults.profile.sessionAmbient, ...(state.profile?.sessionAmbient || {}) },
        music: { ...defaults.profile.music, ...(state.profile?.music || {}) },
        pomodoro: { ...defaults.profile.pomodoro, ...(state.profile?.pomodoro || {}) },
        aiTutor: { activeSubjectId },
      },
      labels: Array.isArray(state.labels) ? state.labels : [],
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      notes: Array.isArray(state.notes) ? state.notes : [],
      subjects: repairedSubjects,
      flashcards: normalizeFlashcards(state.flashcards),
      sessions: Array.isArray(state.sessions) ? state.sessions : [],
      gamification: {
        ...defaults.gamification,
        ...state.gamification,
        fruitCollection: {
          ...defaults.gamification.fruitCollection,
          ...(state.gamification?.fruitCollection || {}),
        },
      },
      sync: {
        ...defaults.sync,
        ...(state.sync || {}),
        status: 'offline',
        lastError: undefined,
      },
      updatedAt: nowIso(),
    };
  }
  if (Array.isArray(source.sessions)) return migrateV1State(source);
  return null;
}
