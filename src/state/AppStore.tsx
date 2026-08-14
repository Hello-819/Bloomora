import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  ActiveTimer,
  AppState,
  ColorMode,
  Flashcard,
  Label,
  RewardLogItem,
  RewardMode,
  SessionDraft,
  StudyMethod,
  StudyNote,
  StudySession,
  StudySubject,
  StudyTask,
  ThemeName,
  TimerLabeling,
  TimerMode,
} from '../types';
import { clearAppState, loadAppState, saveAppState } from '../lib/storage';
import { createId } from '../lib/id';
import { nowIso } from '../lib/dates';
import { computeFruitsReady, earnedAchievementIds, ACHIEVEMENTS } from '../lib/gamification';
import { elapsedForTimer, pauseTimerSnapshot, resumeTimerSnapshot } from '../lib/timers';
import {
  getCurrentUser,
  getSupabaseClient,
  importLegacyBloomoraState,
  isSupabaseConfigured,
  signInWithPassword,
  signOut as supabaseSignOut,
  signUpWithPassword,
  syncAppState,
} from '../lib/supabaseSync';

type ToastKind = 'info' | 'success' | 'warning' | 'danger';
type ArchiveKind = 'label' | 'task' | 'note' | 'subject' | 'flashcard' | 'session';

const ARCHIVE_TABLES: Record<ArchiveKind, string> = {
  label: 'bloomora_labels',
  task: 'bloomora_tasks',
  note: 'bloomora_notes',
  subject: 'bloomora_subjects',
  flashcard: 'bloomora_flashcards',
  session: 'bloomora_sessions',
};

export interface ToastMessage {
  id: string;
  title: string;
  detail?: string;
  kind: ToastKind;
}

export interface StartTimerOptions {
  mode: TimerMode;
  totalSec?: number;
  pomodoro?: ActiveTimer['pomodoro'];
  labeling: TimerLabeling;
}

export interface AppActions {
  updateProfile(patch: Partial<AppState['profile']>): void;
  setTheme(theme: ThemeName): void;
  setColorMode(mode: ColorMode): void;
  createSubject(subject: Omit<StudySubject, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): void;
  updateSubject(id: string, patch: Partial<Omit<StudySubject, 'id' | 'createdAt' | 'updatedAt'>>): void;
  deleteSubject(id: string): void;
  setActiveSubject(id: string): void;
  createLabel(name: string, color: string): void;
  toggleLabelFavorite(id: string): void;
  deleteLabel(id: string): void;
  addTask(text: string, notes?: string, labelId?: string): void;
  toggleTask(id: string, done: boolean): void;
  deleteTask(id: string): void;
  clearDoneTasks(): void;
  createNote(title: string, body: string, labelId?: string): void;
  updateNote(id: string, patch: Partial<Pick<StudyNote, 'title' | 'body' | 'labelId' | 'pinned'>>): void;
  deleteNote(id: string): void;
  createFlashcard(front: string, back: string, subjectId?: string, labelId?: string): void;
  createFlashcards(cards: Array<Pick<Flashcard, 'front' | 'back'> & Partial<Pick<Flashcard, 'subjectId' | 'labelId'>>>): void;
  updateFlashcard(id: string, patch: Partial<Pick<Flashcard, 'front' | 'back' | 'subjectId' | 'labelId'>>): void;
  deleteFlashcard(id: string): void;
  addSession(draft: SessionDraft): boolean;
  updateSession(id: string, patch: Partial<Pick<StudySession, 'labelId' | 'note'>>): void;
  deleteSession(id: string): void;
  restoreArchived(kind: ArchiveKind, id: string): void;
  permanentlyDeleteArchived(kind: ArchiveKind, id: string): Promise<void>;
  startTimer(options: StartTimerOptions): void;
  updateActiveTimerLabel(labelId?: string): void;
  pauseTimer(): void;
  resumeTimer(): void;
  resetTimer(): void;
  completePomodoroPhase(): void;
  saveActiveTimer(): boolean;
  harvestFruits(): void;
  restartGarden(treeType: string): void;
  replaceState(next: AppState): void;
  resetAll(): Promise<void>;
  syncNow(): Promise<void>;
  importLegacyCloudProgress(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  dismissToast(id: string): void;
  notify(title: string, detail?: string, kind?: ToastKind): void;
  setTimetable(timetable: AppState['timetable']): void;
}

export interface AppStoreValue {
  state: AppState | null;
  loading: boolean;
  syncConfigured: boolean;
  toasts: ToastMessage[];
  actions: AppActions;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

function normalizeRewardMode(value?: RewardMode): RewardMode {
  return value === 'garden' ? 'garden' : 'island';
}

function activeRows<T extends { deletedAt?: string }>(rows: T[]): T[] {
  return rows.filter((row) => !row.deletedAt);
}

function bumpState(state: AppState): AppState {
  return { ...state, updatedAt: nowIso() };
}

function appendRewardLog(state: AppState, item: Omit<RewardLogItem, 'id' | 'createdAt'>): AppState {
  return {
    ...state,
    gamification: {
      ...state.gamification,
      rewardLog: [
        { id: createId('reward'), createdAt: nowIso(), ...item },
        ...state.gamification.rewardLog,
      ].slice(0, 40),
    },
  };
}

function restoreRow<T extends { id: string; deletedAt?: string; updatedAt: string }>(rows: T[], id: string, now: string): T[] {
  return rows.map((row) => (row.id === id ? { ...row, deletedAt: undefined, updatedAt: now } : row));
}

function purgeRow<T extends { id: string }>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
}

function refreshAchievements(state: AppState): AppState {
  const before = new Set(state.gamification.achievementIds);
  const after = earnedAchievementIds(state);
  const newlyEarned = after.filter((id) => !before.has(id));
  let next: AppState = {
    ...state,
    gamification: {
      ...state.gamification,
      achievementIds: after,
    },
  };
  for (const id of newlyEarned) {
    const achievement = ACHIEVEMENTS.find((item) => item.id === id);
    if (achievement) {
      next = appendRewardLog(next, {
        title: achievement.title,
        detail: achievement.detail,
        kind: 'achievement',
      });
    }
  }
  return next;
}

function appendSession(state: AppState, draft: SessionDraft): AppState | null {
  const durationSec = Math.max(0, Math.round(draft.durationSec));
  if (durationSec < 60) return null;

  const endedAt = draft.endedAt ?? nowIso();
  const startedAt =
    draft.startedAt ?? new Date(Date.parse(endedAt) - durationSec * 1000).toISOString();
  const label = draft.labelId ? state.labels.find((item) => item.id === draft.labelId) : undefined;
  const now = nowIso();
  const session = {
    id: createId('session'),
    startAt: startedAt,
    endAt: endedAt,
    durationSec,
    method: draft.method,
    rewardMode: normalizeRewardMode(draft.rewardMode),
    note: draft.note?.trim().slice(0, 1200) || undefined,
    labelId: label?.id,
    labelNameSnapshot: label?.name,
    taskIds: draft.taskIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  let next: AppState = {
    ...state,
    sessions: [session, ...state.sessions],
    gamification: {
      ...state.gamification,
      islandXpSec: state.gamification.islandXpSec + durationSec,
      gardenGrowthSec: state.gamification.gardenGrowthSec + durationSec,
    },
  };

  next = appendRewardLog(next, {
    title: 'Study saved',
    detail: `${Math.round(durationSec / 60)} minutes added to Island and Garden progress.`,
    kind: 'session',
  });
  return refreshAchievements(next);
}


function useAppActions(
  stateRef: MutableRefObject<AppState | null>,
  commit: (next: AppState, options?: { silent?: boolean }) => void,
  notify: (title: string, detail?: string, kind?: ToastKind) => void,
  setToasts: Dispatch<SetStateAction<ToastMessage[]>>,
  setState: Dispatch<SetStateAction<AppState | null>>
): AppActions {
  return useMemo<AppActions>(() => {
    const requireState = () => {
      if (!stateRef.current) throw new Error('Bloomora is still loading.');
      return stateRef.current;
    };

    return {
      updateProfile(patch) {
        const current = requireState();
        commit({
          ...current,
          profile: {
            ...current.profile,
            ...patch,
            sessionAmbient: {
              ...current.profile.sessionAmbient,
              ...(patch.sessionAmbient || {}),
            },
            music: {
              ...current.profile.music,
              ...(patch.music || {}),
            },
            pomodoro: {
              ...current.profile.pomodoro,
              ...(patch.pomodoro || {}),
            },
            aiTutor: {
              ...current.profile.aiTutor,
              ...(patch.aiTutor || {}),
            },
          },
        });
      },

      setTheme(theme) {
        const current = requireState();
        commit({ ...current, profile: { ...current.profile, theme } });
      },

      setColorMode(mode) {
        const current = requireState();
        commit({ ...current, profile: { ...current.profile, colorMode: mode } });
      },

      createSubject(subject) {
        const current = requireState();
        const cleanName = subject.name.trim();
        if (!cleanName) {
          notify('Subject needs a name', 'Try Biology, Maths, History, or another course.', 'warning');
          return;
        }
        const now = nowIso();
        const nextSubject: StudySubject = {
          id: createId('subject'),
          name: cleanName.slice(0, 80),
          qualification: subject.qualification.trim().slice(0, 80),
          examBoard: subject.examBoard.trim().slice(0, 80),
          targetGrade: subject.targetGrade.trim().slice(0, 80),
          examDate: subject.examDate.trim().slice(0, 80),
          createdAt: now,
          updatedAt: now,
        };
        commit({
          ...current,
          subjects: [nextSubject, ...(current.subjects || [])],
          profile: {
            ...current.profile,
            aiTutor: { activeSubjectId: current.profile.aiTutor.activeSubjectId || nextSubject.id },
          },
        });
        notify('Subject saved', nextSubject.name, 'success');
      },

      updateSubject(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          subjects: (current.subjects || []).map((subject) =>
            subject.id === id
              ? {
                  ...subject,
                  ...patch,
                  name: patch.name == null ? subject.name : patch.name.trim().slice(0, 80) || 'Study subject',
                  qualification: patch.qualification == null ? subject.qualification : patch.qualification.trim().slice(0, 80),
                  examBoard: patch.examBoard == null ? subject.examBoard : patch.examBoard.trim().slice(0, 80),
                  targetGrade: patch.targetGrade == null ? subject.targetGrade : patch.targetGrade.trim().slice(0, 80),
                  examDate: patch.examDate == null ? subject.examDate : patch.examDate.trim().slice(0, 80),
                  updatedAt: now,
                }
              : subject,
          ),
        });
      },

      deleteSubject(id) {
        const current = requireState();
        const now = nowIso();
        const nextActive = current.profile.aiTutor.activeSubjectId === id
          ? (current.subjects || []).find((subject) => subject.id !== id && !subject.deletedAt)?.id || ''
          : current.profile.aiTutor.activeSubjectId;
        commit({
          ...current,
          profile: { ...current.profile, aiTutor: { activeSubjectId: nextActive } },
          subjects: (current.subjects || []).map((subject) =>
            subject.id === id ? { ...subject, deletedAt: now, updatedAt: now } : subject,
          ),
          flashcards: (current.flashcards || []).map((card) =>
            card.subjectId === id ? { ...card, subjectId: undefined, updatedAt: now } : card,
          ),
        });
      },

      setActiveSubject(id) {
        const current = requireState();
        commit({ ...current, profile: { ...current.profile, aiTutor: { activeSubjectId: id } } });
      },

      createLabel(name, color) {
        const current = requireState();
        const trimmed = name.trim();
        if (!trimmed) {
          notify('Label needs a name', 'Try something like Maths, Chemistry, or Reading.', 'warning');
          return;
        }
        const duplicate = activeRows(current.labels).some(
          (label) => label.name.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        if (duplicate) {
          notify('Label already exists', 'Use a different name or favorite the existing one.', 'warning');
          return;
        }
        const now = nowIso();
        const label: Label = {
          id: createId('label'),
          name: trimmed.slice(0, 40),
          color,
          favorite: false,
          createdAt: now,
          updatedAt: now,
        };
        commit({ ...current, labels: [label, ...current.labels] });
        notify('Label created', label.name, 'success');
      },

      toggleLabelFavorite(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          labels: current.labels.map((label) =>
            label.id === id ? { ...label, favorite: !label.favorite, updatedAt: now } : label,
          ),
        });
      },

      deleteLabel(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          labels: current.labels.map((label) =>
            label.id === id ? { ...label, deletedAt: now, updatedAt: now } : label,
          ),
          tasks: current.tasks.map((task) =>
            task.labelId === id ? { ...task, labelId: undefined, updatedAt: now } : task,
          ),
          flashcards: (current.flashcards || []).map((card) =>
            card.labelId === id ? { ...card, labelId: undefined, updatedAt: now } : card,
          ),
        });
        notify('Label archived', 'Old sessions keep their label snapshot.', 'success');
      },

      addTask(text, notes = '', labelId) {
        const current = requireState();
        const clean = text.trim();
        if (!clean) return;
        const now = nowIso();
        const task: StudyTask = {
          id: createId('task'),
          text: clean.slice(0, 120),
          notes: notes.trim().slice(0, 280),
          labelId: labelId || undefined,
          done: false,
          createdAt: now,
          updatedAt: now,
        };
        commit({ ...current, tasks: [task, ...current.tasks] });
      },

      toggleTask(id, done) {
        const current = requireState();
        const now = nowIso();
        let next: AppState = {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  done,
                  completedAt: done ? now : undefined,
                  updatedAt: now,
                }
              : task,
          ),
        };
        next = refreshAchievements(next);
        commit(next);
      },

      deleteTask(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === id ? { ...task, deletedAt: now, updatedAt: now } : task,
          ),
        });
      },

      clearDoneTasks() {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          tasks: current.tasks.map((task) =>
            task.done && !task.deletedAt ? { ...task, deletedAt: now, updatedAt: now } : task,
          ),
        });
      },

      createNote(title, body, labelId) {
        const current = requireState();
        const cleanTitle = title.trim() || 'Untitled note';
        const now = nowIso();
        const note: StudyNote = {
          id: createId('note'),
          title: cleanTitle.slice(0, 80),
          body: body.trim().slice(0, 12000),
          labelId: labelId || undefined,
          pinned: false,
          createdAt: now,
          updatedAt: now,
        };
        commit({ ...current, notes: [note, ...(current.notes || [])] });
        notify('Note saved', note.title, 'success');
      },

      updateNote(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          notes: (current.notes || []).map((note) =>
            note.id === id
              ? {
                  ...note,
                  ...patch,
                  title: patch.title == null ? note.title : patch.title.trim().slice(0, 80) || 'Untitled note',
                  body: patch.body == null ? note.body : patch.body.slice(0, 12000),
                  labelId: patch.labelId || undefined,
                  updatedAt: now,
                }
              : note,
          ),
        });
      },

      deleteNote(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          notes: (current.notes || []).map((note) =>
            note.id === id ? { ...note, deletedAt: now, updatedAt: now } : note,
          ),
        });
        notify('Note archived', 'It is hidden locally and marked for sync.', 'success');
      },

      createFlashcard(front, back, subjectId, labelId) {
        const current = requireState();
        const cleanFront = front.trim();
        const cleanBack = back.trim();
        if (!cleanFront || !cleanBack) {
          notify('Flashcard needs both sides', 'Add a prompt and an answer before saving.', 'warning');
          return;
        }
        const now = nowIso();
        const card: Flashcard = {
          id: createId('card'),
          front: cleanFront.slice(0, 1000),
          back: cleanBack.slice(0, 2000),
          subjectId: subjectId || undefined,
          labelId: labelId || undefined,
          createdAt: now,
          updatedAt: now,
        };
        commit({ ...current, flashcards: [card, ...(current.flashcards || [])] });
        notify('Flashcard saved', card.front.slice(0, 80), 'success');
      },

      createFlashcards(cards) {
        const current = requireState();
        const now = nowIso();
        const nextCards: Flashcard[] = cards
          .map((card) => ({
            id: createId('card'),
            front: card.front.trim().slice(0, 1000),
            back: card.back.trim().slice(0, 2000),
            subjectId: card.subjectId || undefined,
            labelId: card.labelId || undefined,
            createdAt: now,
            updatedAt: now,
          }))
          .filter((card) => card.front && card.back);
        if (!nextCards.length) {
          notify('No flashcards created', 'The AI response did not include usable cards.', 'warning');
          return;
        }
        commit({ ...current, flashcards: [...nextCards, ...(current.flashcards || [])] });
        notify('Flashcards saved', `${nextCards.length} cards added.`, 'success');
      },

      updateFlashcard(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          flashcards: (current.flashcards || []).map((card) =>
            card.id === id
              ? {
                  ...card,
                  ...patch,
                  front: patch.front == null ? card.front : patch.front.trim().slice(0, 1000),
                  back: patch.back == null ? card.back : patch.back.trim().slice(0, 2000),
                  subjectId: patch.subjectId || undefined,
                  labelId: patch.labelId || undefined,
                  updatedAt: now,
                }
              : card,
          ),
        });
      },

      deleteFlashcard(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          flashcards: (current.flashcards || []).map((card) =>
            card.id === id ? { ...card, deletedAt: now, updatedAt: now } : card,
          ),
        });
      },

      addSession(draft) {
        const current = requireState();
        const next = appendSession(current, draft);
        if (!next) {
          notify('Session not saved', 'Study sessions under 1 minute are ignored to keep stats clean.', 'warning');
          return false;
        }
        commit(next);
        notify('Session saved', 'Your Island and Garden both grew.', 'success');
        return true;
      },

      updateSession(id, patch) {
        const current = requireState();
        const now = nowIso();
        const label = patch.labelId ? current.labels.find((item) => item.id === patch.labelId) : undefined;
        commit({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === id
              ? {
                  ...session,
                  labelId: patch.labelId || undefined,
                  labelNameSnapshot: label?.name || session.labelNameSnapshot,
                  note: patch.note == null ? session.note : patch.note.trim().slice(0, 1200) || undefined,
                  updatedAt: now,
                }
              : session,
          ),
        });
        notify('Session updated', 'The session details were saved.', 'success');
      },

      deleteSession(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === id ? { ...session, deletedAt: now, updatedAt: now } : session,
          ),
        });
        notify('Session archived', 'The session is hidden locally and marked for sync.', 'success');
      },

      restoreArchived(kind, id) {
        const current = requireState();
        const now = nowIso();
        const next: AppState = { ...current };
        if (kind === 'label') next.labels = restoreRow(current.labels, id, now);
        if (kind === 'task') next.tasks = restoreRow(current.tasks, id, now);
        if (kind === 'note') next.notes = restoreRow(current.notes || [], id, now);
        if (kind === 'subject') next.subjects = restoreRow(current.subjects || [], id, now);
        if (kind === 'flashcard') next.flashcards = restoreRow(current.flashcards || [], id, now);
        if (kind === 'session') next.sessions = restoreRow(current.sessions, id, now);
        commit(next);
        notify('Restored', 'The archived item is active again.', 'success');
      },

      async permanentlyDeleteArchived(kind, id) {
        const current = requireState();
        if (!window.confirm('Permanently delete this archived item? This cannot be undone.')) return;

        const next: AppState = { ...current };
        if (kind === 'label') next.labels = purgeRow(current.labels, id);
        if (kind === 'task') next.tasks = purgeRow(current.tasks, id);
        if (kind === 'note') next.notes = purgeRow(current.notes || [], id);
        if (kind === 'subject') next.subjects = purgeRow(current.subjects || [], id);
        if (kind === 'flashcard') next.flashcards = purgeRow(current.flashcards || [], id);
        if (kind === 'session') next.sessions = purgeRow(current.sessions, id);
        commit(next);

        const client = getSupabaseClient();
        if (client) {
          try {
            const user = await getCurrentUser(client);
            if (user) {
              const { error } = await client.from(ARCHIVE_TABLES[kind]).delete().eq('user_id', user.id).eq('id', id);
              if (error) throw error;
            }
          } catch (error) {
            notify(
              'Deleted locally',
              `Cloud delete failed: ${error instanceof Error ? error.message : 'sync may restore this item until it is deleted online.'}`,
              'warning',
            );
            return;
          }
        }

        notify('Permanently deleted', 'The archived item was removed.', 'success');
      },

      startTimer(options) {
        const current = requireState();
        const now = nowIso();
        const timer: ActiveTimer = {
          id: createId('timer'),
          mode: options.mode,
          running: true,
          startedAt: now,
          lastStartedAt: now,
          accumulatedSec: 0,
          totalSec: options.totalSec,
          pomodoro: options.pomodoro,
          labeling: {
            rewardMode: normalizeRewardMode(options.labeling.rewardMode),
            labelId: options.labeling.labelId || undefined,
            taskIds: options.labeling.taskIds || [],
          },
          updatedAt: now,
        };
        commit({ ...current, activeTimer: timer }, { silent: true });
      },

      updateActiveTimerLabel(labelId) {
        const current = requireState();
        if (!current.activeTimer) return;
        commit(
          {
            ...current,
            activeTimer: {
              ...current.activeTimer,
              labeling: {
                ...current.activeTimer.labeling,
                labelId,
              },
            },
          },
          { silent: true },
        );
      },

      pauseTimer() {
        const current = requireState();
        if (!current.activeTimer || !current.activeTimer.running) return;
        commit({ ...current, activeTimer: pauseTimerSnapshot(current.activeTimer) }, { silent: true });
      },

      resumeTimer() {
        const current = requireState();
        if (!current.activeTimer || current.activeTimer.running) return;
        commit({ ...current, activeTimer: resumeTimerSnapshot(current.activeTimer) }, { silent: true });
      },

      resetTimer() {
        const current = requireState();
        commit({ ...current, activeTimer: undefined }, { silent: true });
      },

      completePomodoroPhase() {
        const current = requireState();
        const timer = current.activeTimer;
        if (!timer || timer.mode !== 'pomodoro' || !timer.pomodoro) return;

        let next: AppState = current;
        const now = nowIso();
        if (timer.pomodoro.phase === 'focus') {
          const durationSec = timer.pomodoro.focusMin * 60;
          next =
            appendSession(current, {
              durationSec,
              method: 'pomodoro',
              rewardMode: timer.labeling.rewardMode,
              labelId: timer.labeling.labelId,
              taskIds: timer.labeling.taskIds,
              startedAt: new Date(Date.parse(now) - durationSec * 1000).toISOString(),
              endedAt: now,
            }) ?? current;
          const longBreak = timer.pomodoro.round % timer.pomodoro.longEvery === 0;
          next = {
            ...next,
            activeTimer: {
              ...timer,
              id: createId('timer'),
              running: true,
              startedAt: now,
              lastStartedAt: now,
              accumulatedSec: 0,
              totalSec: (longBreak ? timer.pomodoro.longBreakMin : timer.pomodoro.shortBreakMin) * 60,
              pomodoro: {
                ...timer.pomodoro,
                phase: 'break',
              },
              updatedAt: now,
            },
          };
          notify('Pomodoro saved', 'Break time. The work is logged already.', 'success');
        } else {
          next = {
            ...current,
            activeTimer: {
              ...timer,
              id: createId('timer'),
              running: true,
              startedAt: now,
              lastStartedAt: now,
              accumulatedSec: 0,
              totalSec: timer.pomodoro.focusMin * 60,
              pomodoro: {
                ...timer.pomodoro,
                phase: 'focus',
                round: timer.pomodoro.round + 1,
              },
              updatedAt: now,
            },
          };
          notify('Break complete', 'Ready for the next focus round.', 'success');
        }
        commit(next);
      },

      saveActiveTimer() {
        const current = requireState();
        const timer = current.activeTimer;
        if (!timer) return false;
        const elapsed = timer.totalSec
          ? Math.min(timer.totalSec, elapsedForTimer(timer))
          : elapsedForTimer(timer);
        if (timer.mode === 'pomodoro' && timer.pomodoro?.phase === 'break') {
          notify('Breaks are not logged', 'Start the next focus round when you are ready.', 'warning');
          return false;
        }
        const endedAt = nowIso();
        const startedAt = new Date(Date.parse(endedAt) - Math.round(elapsed) * 1000).toISOString();
        const next = appendSession(
          {
            ...current,
            activeTimer: undefined,
          },
          {
            durationSec: elapsed,
            method: timer.mode === 'countdown' ? 'timer' : timer.mode,
            rewardMode: timer.labeling.rewardMode,
            labelId: timer.labeling.labelId,
            taskIds: timer.labeling.taskIds,
            startedAt,
            endedAt,
          },
        );
        if (!next) {
          notify('Session not saved', 'Study sessions under 1 minute are ignored to keep stats clean.', 'warning');
          return false;
        }
        commit(next);
        notify('Session saved', 'Your progress is safely stored locally.', 'success');
        return true;
      },

      harvestFruits() {
        const current = requireState();
        const ready = computeFruitsReady(current.gamification);
        if (ready <= 0) {
          notify('No fruit yet', 'Keep studying and your tree will produce fruit.', 'info');
          return;
        }
        const tree = current.gamification.gardenTreeType || 'Apple';
        let next: AppState = {
          ...current,
          gamification: {
            ...current.gamification,
            gardenHarvestedOnTree: current.gamification.gardenHarvestedOnTree + ready,
            fruitCollection: {
              ...current.gamification.fruitCollection,
              [tree]: (current.gamification.fruitCollection[tree] || 0) + ready,
            },
          },
        };
        next = appendRewardLog(next, {
          title: 'Fruit harvested',
          detail: `${ready} ${tree} fruit added to your collection.`,
          kind: 'fruit',
        });
        next = refreshAchievements(next);
        commit(next);
        notify('Harvested', `${ready} ${tree} fruit collected.`, 'success');
      },

      restartGarden(treeType) {
        const current = requireState();
        commit({
          ...current,
          gamification: {
            ...current.gamification,
            gardenTreeType: treeType,
            gardenGrowthSec: 0,
            gardenHarvestedOnTree: 0,
          },
        });
      },

      replaceState(next) {
        commit(refreshAchievements(next));
        notify('Backup imported', 'Bloomora replaced the local V2 database.', 'success');
      },

      async resetAll() {
        const fresh = await clearAppState();
        stateRef.current = fresh;
        setState(fresh);
        notify('Bloomora reset', 'Your V2 local database has been reset.', 'success');
      },

      async syncNow() {
        const current = requireState();
        const client = getSupabaseClient();
        if (!client) {
          notify('Sync is not configured', 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable it.', 'warning');
          return;
        }
        try {
          commit({ ...current, sync: { ...current.sync, enabled: true, status: 'syncing', lastError: undefined } }, { silent: true });
          const user = await getCurrentUser(client);
          if (!user) throw new Error('Sign in first to sync across devices.');
          const synced = await syncAppState(client, user, stateRef.current ?? current);
          commit(synced, { silent: true });
          notify('Sync complete', 'Local and cloud data were merged by latest update time.', 'success');
        } catch (error) {
          let message = 'Unknown sync error.';
          if (error instanceof Error) {
            message = error.message;
          } else if (typeof error === 'string') {
            message = error;
          } else if (error && typeof error === 'object') {
            const details = error as { message?: string; details?: string; hint?: string; code?: string };
            message = [details.message, details.details, details.hint, details.code].filter(Boolean).join(' ') || message;
          }
          const latest = stateRef.current ?? current;
          commit({
            ...latest,
            sync: {
              ...latest.sync,
              enabled: true,
              status: 'error',
              lastError: message,
            },
          });
          notify('Sync failed', message, 'danger');
        }
      },

      async importLegacyCloudProgress() {
        const current = requireState();
        const client = getSupabaseClient();
        if (!client) {
          notify('Sync is not configured', 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable it.', 'warning');
          return;
        }
        try {
          commit({ ...current, sync: { ...current.sync, enabled: true, status: 'syncing', lastError: undefined } }, { silent: true });
          const user = await getCurrentUser(client);
          if (!user) throw new Error('Sign in first to import your old Bloomora cloud progress.');
          const withLegacy = await importLegacyBloomoraState(client, user, stateRef.current ?? current);
          const synced = await syncAppState(client, user, withLegacy);
          commit(synced, { silent: true });
          notify('V1 progress imported', 'Old cloud progress was merged into your current V2 account.', 'success');
        } catch (error) {
          let message = 'Unknown legacy import error.';
          if (error instanceof Error) {
            message = error.message;
          } else if (typeof error === 'string') {
            message = error;
          } else if (error && typeof error === 'object') {
            const details = error as { message?: string; details?: string; hint?: string; code?: string };
            message = [details.message, details.details, details.hint, details.code].filter(Boolean).join(' ') || message;
          }
          const latest = stateRef.current ?? current;
          commit({
            ...latest,
            sync: {
              ...latest.sync,
              enabled: true,
              status: 'error',
              lastError: message,
            },
          });
          notify('V1 import failed', message, 'danger');
        }
      },

      async signIn(email, password) {
        const current = requireState();
        const client = getSupabaseClient();
        if (!client) {
          notify('Sync is not configured', 'Add Supabase env vars, then restart the dev server.', 'warning');
          return;
        }
        const user = await signInWithPassword(client, email, password);
        commit({
          ...current,
          sync: { enabled: true, status: 'idle', userEmail: user.email },
        });
        notify('Signed in', 'Optional sync is ready.', 'success');
      },

      async signUp(email, password) {
        const client = getSupabaseClient();
        if (!client) {
          notify('Sync is not configured', 'Add Supabase env vars, then restart the dev server.', 'warning');
          return;
        }
        await signUpWithPassword(client, email, password);
        notify('Account created', 'Check your email if Supabase confirmation is enabled.', 'success');
      },

      async signOut() {
        const current = requireState();
        const client = getSupabaseClient();
        if (client) await supabaseSignOut(client);
        commit({ ...current, sync: { enabled: false, status: 'offline' } });
        notify('Signed out', 'Bloomora is still fully available locally.', 'success');
      },

      dismissToast(id) {
        setToasts((items) => items.filter((item) => item.id !== id));
      },

      notify,
      setTimetable(timetable) {
        const current = requireState();
        commit({
          ...current,
          timetable,
        });
      },
    };
  }, [commit, notify, setToasts, setState]);
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const stateRef = useRef<AppState | null>(null);

  const notify = useCallback((title: string, detail?: string, kind: ToastKind = 'info') => {
    const toast = { id: createId('toast'), title, detail, kind };
    setToasts((items) => [toast, ...items].slice(0, 4));
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== toast.id));
    }, 5200);
  }, []);

  const commit = useCallback(
    (next: AppState, options: { silent?: boolean } = {}) => {
      const finalState = bumpState(next);
      stateRef.current = finalState;
      setState(finalState);
      saveAppState(finalState).catch((error) => {
        console.error(error);
        if (!options.silent) notify('Could not save locally', 'Your browser blocked the local database write.', 'danger');
      });
    },
    [notify],
  );

  useEffect(() => {
    let active = true;
    loadAppState()
      .then((loaded) => {
        if (!active) return;
        const refreshed = refreshAchievements(loaded);
        stateRef.current = refreshed;
        setState(refreshed);
      })
      .catch((error) => {
        console.error(error);
        notify('Bloomora could not open its local database', 'Try a modern browser or clear site data.', 'danger');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) return;
    let active = true;
    getCurrentUser(client)
      .then((user) => {
        if (!active || !stateRef.current) return;
        if (user) {
          commit(
            {
              ...stateRef.current,
              sync: {
                enabled: true,
                status: 'idle',
                userEmail: user.email,
                lastSyncAt: stateRef.current.sync.lastSyncAt,
              },
            },
            { silent: true },
          );
        }
      })
      .catch(() => undefined);
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!stateRef.current) return;
      commit(
        {
          ...stateRef.current,
          sync: session?.user
            ? {
                ...stateRef.current.sync,
                enabled: true,
                userEmail: session.user.email,
                status: 'idle',
              }
            : { enabled: false, status: 'offline' },
        },
        { silent: true },
      );
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [commit]);

  const actions = useAppActions(stateRef, commit, notify, setToasts, setState);

  const value = useMemo<AppStoreValue>(
    () => ({
      state,
      loading,
      syncConfigured: isSupabaseConfigured(),
      toasts,
      actions,
    }),
    [actions, loading, state, toasts],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider.');
  return value;
}
