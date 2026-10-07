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
  Assessment,
  ColorMode,
  Deadline,
  Flashcard,
  Label,
  ReviewGrade,
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
  TimetableEntry,
} from '../types';
import { clearAppState, loadAppState, saveAppState } from '../lib/storage';
import { createId } from '../lib/id';
import { nowIso } from '../lib/dates';
import { scheduleReview } from '../lib/srs';
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
export type ArchiveKind = 'label' | 'task' | 'note' | 'subject' | 'flashcard' | 'session' | 'deadline' | 'assessment';

const ARCHIVE_TABLES: Record<ArchiveKind, string> = {
  label: 'bloomora_labels',
  task: 'bloomora_tasks',
  note: 'bloomora_notes',
  subject: 'bloomora_subjects',
  flashcard: 'bloomora_flashcards',
  session: 'bloomora_sessions',
  deadline: 'bloomora_deadlines',
  assessment: 'bloomora_assessments',
};

const ARCHIVE_COLLECTIONS = {
  label: 'labels',
  task: 'tasks',
  note: 'notes',
  subject: 'subjects',
  flashcard: 'flashcards',
  session: 'sessions',
  deadline: 'deadlines',
  assessment: 'assessments',
} as const satisfies Record<ArchiveKind, keyof AppState>;

export type DeadlineDraft = Omit<Deadline, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type AssessmentDraft = Omit<Assessment, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type TaskPatch = Partial<Pick<StudyTask, 'text' | 'notes' | 'labelId' | 'dueDate' | 'priority'>>;

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
  addTask(text: string, notes?: string, labelId?: string, extra?: Pick<StudyTask, 'dueDate' | 'priority'>): void;
  updateTask(id: string, patch: TaskPatch): void;
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
  reviewFlashcard(id: string, grade: ReviewGrade): void;
  resetFlashcardProgress(id: string): void;
  createDeadline(draft: DeadlineDraft): void;
  updateDeadline(id: string, patch: Partial<DeadlineDraft>): void;
  deleteDeadline(id: string): void;
  createAssessment(draft: AssessmentDraft): void;
  updateAssessment(id: string, patch: Partial<AssessmentDraft>): void;
  deleteAssessment(id: string): void;  addSession(draft: SessionDraft): boolean;
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
  saveActiveTimer(note?: string): boolean;
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
  addTimetableEntry(entry: Omit<TimetableEntry, 'id'>): void;
  removeTimetableEntry(id: string): void;
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

function restoreRow<T extends { id: string; deletedAt?: string; updatedAt: string }>(rows: T[], id: string, now: string): T[] {
  return rows.map((row) => (row.id === id ? { ...row, deletedAt: undefined, updatedAt: now } : row));
}

function purgeRow<T extends { id: string }>(rows: T[], id: string): T[] {
  return rows.filter((row) => row.id !== id);
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

  return { ...state, sessions: [session, ...state.sessions] };
}

function cleanDeadline(draft: Partial<DeadlineDraft>, base?: Deadline): Omit<Deadline, 'id' | 'createdAt' | 'updatedAt'> {
  const merged = { ...base, ...draft };
  const weight = Number(merged.weight);
  return {
    title: (merged.title ?? '').trim().slice(0, 120) || 'Untitled deadline',
    kind: merged.kind ?? 'assignment',
    subjectId: merged.subjectId || undefined,
    dueAt: (merged.dueAt ?? '').slice(0, 32),
    weight: merged.weight == null || merged.weight === ('' as unknown) || !Number.isFinite(weight) ? undefined : Math.min(100, Math.max(0, weight)),
    status: merged.status ?? 'not-started',
    notes: merged.notes?.trim().slice(0, 1000) || undefined,
    deletedAt: base?.deletedAt,
  };
}

function cleanAssessment(draft: Partial<AssessmentDraft>, base?: Assessment): Omit<Assessment, 'id' | 'createdAt' | 'updatedAt'> {
  const merged = { ...base, ...draft };
  const weight = Number(merged.weight);
  return {
    title: (merged.title ?? '').trim().slice(0, 120) || 'Assessment',
    subjectId: merged.subjectId || undefined,
    score: Math.max(0, Number(merged.score) || 0),
    maxScore: Math.max(0, Number(merged.maxScore) || 0),
    weight: merged.weight == null || merged.weight === ('' as unknown) || !Number.isFinite(weight) ? undefined : Math.min(100, Math.max(0, weight)),
    date: (merged.date ?? '').slice(0, 32),
    notes: merged.notes?.trim().slice(0, 1000) || undefined,
    deletedAt: base?.deletedAt,
  };
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
            hiddenSidebarItems: patch.hiddenSidebarItems || current.profile.hiddenSidebarItems || [],
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

      addTask(text, notes = '', labelId, extra) {
        const current = requireState();
        const clean = text.trim();
        if (!clean) return;
        const now = nowIso();
        const task: StudyTask = {
          id: createId('task'),
          text: clean.slice(0, 120),
          notes: notes.trim().slice(0, 280),
          labelId: labelId || undefined,
          dueDate: extra?.dueDate || undefined,
          priority: extra?.priority || undefined,
          done: false,
          createdAt: now,
          updatedAt: now,
        };
        commit({ ...current, tasks: [task, ...current.tasks] });
      },

      updateTask(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  text: patch.text == null ? task.text : patch.text.trim().slice(0, 120) || task.text,
                  notes: patch.notes == null ? task.notes : patch.notes.trim().slice(0, 280),
                  labelId: 'labelId' in patch ? patch.labelId || undefined : task.labelId,
                  dueDate: 'dueDate' in patch ? patch.dueDate || undefined : task.dueDate,
                  priority: 'priority' in patch ? patch.priority || undefined : task.priority,
                  updatedAt: now,
                }
              : task,
          ),
        });
      },

      toggleTask(id, done) {
        const current = requireState();
        const now = nowIso();
        commit({
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
        });
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
                  labelId: 'labelId' in patch ? patch.labelId || undefined : note.labelId,
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
                  subjectId: 'subjectId' in patch ? patch.subjectId || undefined : card.subjectId,
                  labelId: 'labelId' in patch ? patch.labelId || undefined : card.labelId,
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

      reviewFlashcard(id, grade) {
        const current = requireState();
        const now = nowIso();
        commit(
          {
            ...current,
            flashcards: (current.flashcards || []).map((card) =>
              card.id === id ? { ...card, review: scheduleReview(card.review, grade, Date.parse(now)), updatedAt: now } : card,
            ),
          },
          { silent: true },
        );
      },

      resetFlashcardProgress(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          flashcards: (current.flashcards || []).map((card) =>
            card.id === id ? { ...card, review: undefined, updatedAt: now } : card,
          ),
        });
      },

      createDeadline(draft) {
        const current = requireState();
        if (!draft.title.trim() || !draft.dueAt) {
          notify('Deadline needs a title and date', 'Add what is due and when it is due.', 'warning');
          return;
        }
        const now = nowIso();
        const deadline: Deadline = { id: createId('deadline'), ...cleanDeadline(draft), createdAt: now, updatedAt: now };
        commit({ ...current, deadlines: [deadline, ...(current.deadlines || [])] });
        notify('Deadline added', deadline.title, 'success');
      },

      updateDeadline(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          deadlines: (current.deadlines || []).map((item) =>
            item.id === id ? { ...item, ...cleanDeadline(patch, item), updatedAt: now } : item,
          ),
        });
      },

      deleteDeadline(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          deadlines: (current.deadlines || []).map((item) =>
            item.id === id ? { ...item, deletedAt: now, updatedAt: now } : item,
          ),
        });
        notify('Deadline archived', 'You can restore it from the archive.', 'success');
      },

      createAssessment(draft) {
        const current = requireState();
        if (!draft.title.trim() || !(Number(draft.maxScore) > 0)) {
          notify('Result needs a title and a maximum mark', 'For example 54 out of 70.', 'warning');
          return;
        }
        const now = nowIso();
        const assessment: Assessment = { id: createId('assessment'), ...cleanAssessment(draft), createdAt: now, updatedAt: now };
        commit({ ...current, assessments: [assessment, ...(current.assessments || [])] });
        notify('Result recorded', assessment.title, 'success');
      },

      updateAssessment(id, patch) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          assessments: (current.assessments || []).map((item) =>
            item.id === id ? { ...item, ...cleanAssessment(patch, item), updatedAt: now } : item,
          ),
        });
      },

      deleteAssessment(id) {
        const current = requireState();
        const now = nowIso();
        commit({
          ...current,
          assessments: (current.assessments || []).map((item) =>
            item.id === id ? { ...item, deletedAt: now, updatedAt: now } : item,
          ),
        });
        notify('Result archived', 'You can restore it from the archive.', 'success');
      },

      addSession(draft) {
        const current = requireState();
        const next = appendSession(current, draft);
        if (!next) {
          notify('Session not saved', 'Study sessions under 1 minute are ignored to keep stats clean.', 'warning');
          return false;
        }
        commit(next);
        notify('Session logged', `${Math.round(next.sessions[0].durationSec / 60)} minutes recorded.`, 'success');
        if (next.sync.enabled) {
          void this.syncNow();
        }
        return true;
      },

      updateSession(id, patch) {
        const current = requireState();
        const now = nowIso();
        const label = patch.labelId ? current.labels.find((item) => item.id === patch.labelId) : undefined;
        const next = {
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
        };
        commit(next);
        notify('Session updated', 'The session details were saved.', 'success');
        if (next.sync.enabled) {
          void this.syncNow();
        }
      },

      deleteSession(id) {
        const current = requireState();
        const now = nowIso();
        const next = {
          ...current,
          sessions: current.sessions.map((session) =>
            session.id === id ? { ...session, deletedAt: now, updatedAt: now } : session,
          ),
        };
        commit(next);
        notify('Session archived', 'The session is hidden locally and marked for sync.', 'success');
        if (next.sync.enabled) {
          void this.syncNow();
        }
      },

      restoreArchived(kind, id) {
        const current = requireState();
        const now = nowIso();
        const key = ARCHIVE_COLLECTIONS[kind];
        const rows = (current[key] || []) as Array<{ id: string; deletedAt?: string; updatedAt: string }>;
        commit({ ...current, [key]: restoreRow(rows, id, now) });
        notify('Restored', 'The archived item is active again.', 'success');
      },

      async permanentlyDeleteArchived(kind, id) {
        const current = requireState();
        if (!window.confirm('Permanently delete this archived item? This cannot be undone.')) return;

        const key = ARCHIVE_COLLECTIONS[kind];
        const rows = (current[key] || []) as Array<{ id: string }>;
        commit({ ...current, [key]: purgeRow(rows, id) });

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
          notify('Focus round logged', 'Time for a break.', 'success');
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

      saveActiveTimer(note) {
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
            note,
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
        notify('Session logged', `${Math.round(next.sessions[0].durationSec / 60)} minutes recorded.`, 'success');
        if (next.sync.enabled) void this.syncNow();
        return true;
      },

      replaceState(next) {
        commit(next);
        notify('Backup imported', 'Your local data was replaced with the backup.', 'success');
      },

      async resetAll() {
        const fresh = await clearAppState();
        stateRef.current = fresh;
        setState(fresh);
        notify('Data reset', 'All local Bloomora data on this device was cleared.', 'success');
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
          notify('Synced', 'This device and your account are up to date.', 'success');
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
        const user = await signInWithPassword(client, email.trim(), password);
        commit({
          ...(stateRef.current ?? current),
          sync: { enabled: true, status: 'idle', userEmail: user.email },
        });
        notify('Signed in', user.email ? `Signed in as ${user.email}.` : 'Sync is ready.', 'success');
        void this.syncNow();
      },

      async signUp(email, password) {
        const client = getSupabaseClient();
        if (!client) {
          notify('Sync is not configured', 'Add Supabase env vars, then restart the dev server.', 'warning');
          return;
        }
        await signUpWithPassword(client, email.trim(), password);
        notify('Account created', 'Check your inbox to confirm your email, then sign in.', 'success');
      },

      async signOut() {
        const current = requireState();
        const client = getSupabaseClient();
        if (client) await supabaseSignOut(client);
        commit({ ...current, sync: { enabled: false, status: 'offline' } });
        notify('Signed out', 'Your data is still available on this device.', 'success');
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

      addTimetableEntry(entry) {
        const current = requireState();
        const module = entry.module.trim();
        const timeHr = entry.timeHr.trim();
        if (!module || !timeHr || !entry.day) {
          notify('Timetable entry incomplete', 'Choose a day, a time, and what the class is.', 'warning');
          return;
        }
        commit({
          ...current,
          timetable: {
            entries: [...(current.timetable?.entries || []), { id: createId('slot'), day: entry.day, timeHr: timeHr.slice(0, 40), module: module.slice(0, 120) }],
            updatedAt: nowIso(),
          },
        });
      },

      removeTimetableEntry(id) {
        const current = requireState();
        commit({
          ...current,
          timetable: {
            entries: (current.timetable?.entries || []).filter((entry) => entry.id !== id),
            updatedAt: nowIso(),
          },
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
        stateRef.current = loaded;
        setState(loaded);
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
