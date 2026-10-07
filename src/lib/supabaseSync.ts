import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { AppState, Assessment, Deadline, Flashcard, Label, StudyNote, StudySession, StudySubject, StudyTask } from '../types';
import { nowIso } from './dates';
import { createDefaultState } from './defaultState';
import { normalizeAssessments, normalizeDeadlines, normalizeReview } from './migration';

const TABLES = {
  profile: 'bloomora_profile_states',
  labels: 'bloomora_labels',
  tasks: 'bloomora_tasks',
  notes: 'bloomora_notes',
  subjects: 'bloomora_subjects',
  flashcards: 'bloomora_flashcards',
  sessions: 'bloomora_sessions',
  deadlines: 'bloomora_deadlines',
  assessments: 'bloomora_assessments',
} as const;

type RemoteProfile = {
  id: string;
  profile_data: AppState['profile'];
  gamification_data: AppState['gamification'];
  updated_at: string;
};

type RemoteLabelRow = {
  user_id: string;
  id: string;
  name: string;
  color: string;
  favorite: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteTaskRow = {
  user_id: string;
  id: string;
  text: string;
  notes?: string | null;
  label_id?: string | null;
  due_date?: string | null;
  priority?: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  deleted_at?: string | null;
};

type RemoteNoteRow = {
  user_id: string;
  id: string;
  title: string;
  body: string;
  label_id?: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteSubjectRow = {
  user_id: string;
  id: string;
  name: string;
  qualification?: string | null;
  exam_board?: string | null;
  target_grade?: string | null;
  exam_date?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteFlashcardRow = {
  user_id: string;
  id: string;
  front: string;
  back: string;
  subject_id?: string | null;
  label_id?: string | null;
  review?: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteDeadlineRow = {
  user_id: string;
  id: string;
  title: string;
  kind: string;
  subject_id?: string | null;
  due_at: string;
  weight?: number | null;
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteAssessmentRow = {
  user_id: string;
  id: string;
  title: string;
  subject_id?: string | null;
  score: number;
  max_score: number;
  weight?: number | null;
  date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type RemoteSessionRow = {
  user_id: string;
  id: string;
  start_at: string;
  end_at: string;
  duration_sec: number;
  method: StudySession['method'];
  reward_mode: StudySession['rewardMode'];
  note?: string | null;
  label_id?: string | null;
  label_name_snapshot?: string | null;
  task_ids?: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type LegacyProfileRow = {
  display_name?: string | null;
  weekly_goal_hours?: number | null;
  theme?: string | null;
  stopwatch_cap_on?: boolean | null;
  stopwatch_cap_hours?: number | null;
  session_ambient_type?: string | null;
  session_ambient_volume?: number | null;
  island_xp_sec?: number | null;
  garden_growth_sec?: number | null;
  garden_tree_type?: string | null;
  garden_harvested_on_tree?: number | null;
  fruit_collection?: Record<string, number> | null;
  updated_at?: string | null;
};

type LegacyLabelRow = {
  id?: string | null;
  local_id?: string | null;
  name?: string | null;
  color?: string | null;
  favorite?: boolean | null;
  created_ts?: string | null;
  updated_at?: string | null;
};

type LegacySessionRow = {
  client_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  duration_sec?: number | null;
  label_name?: string | null;
  source?: string | null;
  reward_mode?: string | null;
  updated_at?: string | null;
};

export interface SyncClientBundle {
  client: SupabaseClient;
  user: User | null;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let singleton: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  singleton ??= createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return singleton;
}

function isRemoteNewer(remoteUpdatedAt?: string, localUpdatedAt?: string): boolean {
  return Boolean(remoteUpdatedAt && (!localUpdatedAt || Date.parse(remoteUpdatedAt) > Date.parse(localUpdatedAt)));
}

function validIso(value: unknown, fallback = nowIso()): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return fallback;
}

function syncErrorMessage(error: unknown): string {
  if (!error) return 'Unknown sync error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const details = error as { message?: string; details?: string; hint?: string; code?: string };
    const bits = [details.message, details.details, details.hint, details.code].filter(Boolean);
    if (bits.length) return bits.join(' ');
  }
  return 'Unknown sync error.';
}

function isMissingTableError(error: unknown): boolean {
  const message = syncErrorMessage(error).toLowerCase();
  return message.includes('could not find the table')
    || message.includes('relation') && message.includes('does not exist')
    || message.includes('pgrst205')
    || message.includes('42p01');
}

function mergeRows<T extends { id: string; updatedAt: string; deletedAt?: string }>(
  localRows: T[],
  remoteRows: T[],
): T[] {
  const rows = new Map<string, T>();
  for (const row of localRows) rows.set(row.id, row);
  for (const row of remoteRows) {
    const local = rows.get(row.id);
    if (!local || isRemoteNewer(row.updatedAt, local.updatedAt)) rows.set(row.id, row);
  }
  return Array.from(rows.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function remoteLabel(row: RemoteLabelRow): Label {
  const now = nowIso();
  return {
    id: String(row.id || ''),
    name: String(row.name || 'Untitled'),
    color: String(row.color || '#0f766e'),
    favorite: Boolean(row.favorite),
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function remoteTask(row: RemoteTaskRow): StudyTask {
  const now = nowIso();
  return {
    id: String(row.id || ''),
    text: String(row.text || 'Untitled task'),
    notes: row.notes ?? undefined,
    labelId: row.label_id ?? undefined,
    dueDate: row.due_date || undefined,
    priority: row.priority === 'low' || row.priority === 'medium' || row.priority === 'high' ? row.priority : undefined,
    done: Boolean(row.done),
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    completedAt: row.completed_at ? validIso(row.completed_at, now) : undefined,
    deletedAt: row.deleted_at ?? undefined,
  };
}

function remoteNote(row: RemoteNoteRow): StudyNote {
  const now = nowIso();
  return {
    id: String(row.id || ''),
    title: String(row.title || 'Untitled note'),
    body: String(row.body || ''),
    labelId: row.label_id ?? undefined,
    pinned: Boolean(row.pinned),
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function remoteSubject(row: RemoteSubjectRow): StudySubject {
  const now = nowIso();
  return {
    id: String(row.id || ''),
    name: String(row.name || 'Study subject'),
    qualification: row.qualification ?? '',
    examBoard: row.exam_board ?? '',
    targetGrade: row.target_grade ?? '',
    examDate: row.exam_date ?? '',
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function remoteFlashcard(row: RemoteFlashcardRow): Flashcard {
  const now = nowIso();
  return {
    id: String(row.id || ''),
    front: String(row.front || ''),
    back: String(row.back || ''),
    subjectId: row.subject_id ?? undefined,
    labelId: row.label_id ?? undefined,
    review: normalizeReview(row.review),
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function remoteDeadline(row: RemoteDeadlineRow): Deadline | undefined {
  return normalizeDeadlines([{
    id: row.id,
    title: row.title,
    kind: row.kind,
    subjectId: row.subject_id,
    dueAt: row.due_at,
    weight: row.weight,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }])[0];
}

function remoteAssessment(row: RemoteAssessmentRow): Assessment | undefined {
  return normalizeAssessments([{
    id: row.id,
    title: row.title,
    subjectId: row.subject_id,
    score: row.score,
    maxScore: row.max_score,
    weight: row.weight,
    date: row.date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }])[0];
}

function remoteSession(row: RemoteSessionRow): StudySession {
  const now = nowIso();
  const durationSec = Math.max(0, Math.round(Number(row.duration_sec || 0)));
  const endAt = validIso(row.end_at, now);
  return {
    id: String(row.id || ''),
    startAt: validIso(row.start_at, new Date(Date.parse(endAt) - durationSec * 1000).toISOString()),
    endAt,
    durationSec,
    method: row.method || 'manual',
    rewardMode: row.reward_mode === 'garden' ? 'garden' : 'island',
    note: row.note ?? undefined,
    labelId: row.label_id ?? undefined,
    labelNameSnapshot: row.label_name_snapshot ?? undefined,
    taskIds: row.task_ids ?? [],
    createdAt: validIso(row.created_at, now),
    updatedAt: validIso(row.updated_at, now),
    deletedAt: row.deleted_at ?? undefined,
  };
}

function legacyTheme(theme: string | null | undefined): AppState['profile']['theme'] {
  if (theme === 'emerald') return 'grove';
  if (theme === 'ocean') return 'aqua';
  if (theme === 'midnight') return 'ink';
  return 'daybreak';
}

function legacyColorMode(theme: string | null | undefined): AppState['profile']['colorMode'] {
  return theme === 'midnight' ? 'dark' : 'light';
}

export function legacyLabelForTest(row: LegacyLabelRow): Label {
  const createdAt = validIso(row.created_ts, nowIso());
  return {
    id: String(row.local_id || row.id || `legacy_label_${row.name || Date.now()}`),
    name: String(row.name || 'Untitled'),
    color: String(row.color || '#0f766e'),
    favorite: Boolean(row.favorite),
    createdAt,
    updatedAt: validIso(row.updated_at, createdAt),
  };
}

export function legacySessionForTest(row: LegacySessionRow, labelsByName: Map<string, Label>): StudySession {
  const durationSec = Math.max(0, Math.round(Number(row.duration_sec || 0)));
  const endAt = validIso(row.ended_at, nowIso());
  const startAt = validIso(row.started_at, new Date(Date.parse(endAt) - durationSec * 1000).toISOString());
  const labelName = String(row.label_name || '').trim();
  const label = labelsByName.get(labelName.toLowerCase());
  return {
    id: String(row.client_id || `legacy_session_${Date.parse(endAt)}_${durationSec}`),
    startAt,
    endAt,
    durationSec,
    method: row.source === 'stopwatch' || row.source === 'timer' || row.source === 'pomodoro' ? row.source : 'manual',
    rewardMode: row.reward_mode === 'garden' ? 'garden' : 'island',
    note: undefined,
    labelId: label?.id,
    labelNameSnapshot: labelName || undefined,
    taskIds: [],
    createdAt: endAt,
    updatedAt: validIso(row.updated_at, endAt),
  };
}

export async function importLegacyBloomoraState(client: SupabaseClient, user: User, local: AppState): Promise<AppState> {
  const [profileRes, labelsRes, sessionsRes] = await Promise.all([
    client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    client.from('labels').select('*').eq('user_id', user.id),
    client.from('sessions').select('*').eq('user_id', user.id).order('ended_at', { ascending: false }),
  ]);

  const legacyErrors = [profileRes.error, labelsRes.error, sessionsRes.error].filter(Boolean);
  if (legacyErrors.length && !legacyErrors.every(isMissingTableError)) {
    throw new Error(`Legacy import failed: ${legacyErrors.map(syncErrorMessage).join(' | ')}`);
  }

  const legacyProfile = profileRes.data as LegacyProfileRow | null;
  const legacyLabels = ((labelsRes.data ?? []) as LegacyLabelRow[]).map(legacyLabelForTest).filter((label) => label.id);
  const labelsByName = new Map(legacyLabels.map((label) => [label.name.trim().toLowerCase(), label]));
  const legacySessions = ((sessionsRes.data ?? []) as LegacySessionRow[])
    .map((row) => legacySessionForTest(row, labelsByName))
    .filter((session) => session.id && session.durationSec >= 0);

  if (!legacyProfile && legacyLabels.length === 0 && legacySessions.length === 0) return local;

  const defaults = createDefaultState();
  const fruitCollection = legacyProfile?.fruit_collection && typeof legacyProfile.fruit_collection === 'object'
    ? legacyProfile.fruit_collection
    : {};

  return {
    ...local,
    profile: {
      ...local.profile,
      displayName: legacyProfile?.display_name || local.profile.displayName,
      weeklyGoalHours: Number(legacyProfile?.weekly_goal_hours ?? local.profile.weeklyGoalHours),
      theme: legacyTheme(legacyProfile?.theme),
      colorMode: legacyColorMode(legacyProfile?.theme),
      stopwatchCapOn: legacyProfile?.stopwatch_cap_on !== false,
      stopwatchCapHours: Math.min(24, Math.max(1, Number(legacyProfile?.stopwatch_cap_hours ?? local.profile.stopwatchCapHours))),
      sessionAmbient: {
        type: legacyProfile?.session_ambient_type === 'fire'
          || legacyProfile?.session_ambient_type === 'wind'
          || legacyProfile?.session_ambient_type === 'sea'
          || legacyProfile?.session_ambient_type === 'nature'
          ? legacyProfile.session_ambient_type
          : local.profile.sessionAmbient.type,
        volume: Math.min(1, Math.max(0, Number(legacyProfile?.session_ambient_volume ?? local.profile.sessionAmbient.volume))),
      },
    },
    labels: mergeRows(local.labels, legacyLabels),
    sessions: mergeRows(local.sessions, legacySessions),
    gamification: {
      ...local.gamification,
      islandXpSec: Math.max(local.gamification.islandXpSec, Number(legacyProfile?.island_xp_sec ?? 0)),
      gardenGrowthSec: Math.max(local.gamification.gardenGrowthSec, Number(legacyProfile?.garden_growth_sec ?? 0)),
      gardenTreeType: String(legacyProfile?.garden_tree_type || local.gamification.gardenTreeType || defaults.gamification.gardenTreeType),
      gardenHarvestedOnTree: Math.max(local.gamification.gardenHarvestedOnTree, Number(legacyProfile?.garden_harvested_on_tree ?? 0)),
      fruitCollection: {
        ...defaults.gamification.fruitCollection,
        ...local.gamification.fruitCollection,
        ...fruitCollection,
      },
      rewardLog: [
        {
          id: `legacy_import_${Date.now()}`,
          createdAt: nowIso(),
          title: 'Legacy cloud progress imported',
          detail: `${legacySessions.length} old sessions and ${legacyLabels.length} labels were converted for Bloomora V2.`,
          kind: 'session' as const,
        },
        ...local.gamification.rewardLog,
      ].slice(0, 40),
    },
    updatedAt: nowIso(),
  };
}

function mergeProfile(local: AppState, remoteProfile: RemoteProfile | null): Pick<AppState, 'profile' | 'gamification'> {
  const defaults = createDefaultState();
  if (!remoteProfile || !isRemoteNewer(remoteProfile.updated_at, local.updatedAt)) {
    return { profile: local.profile, gamification: local.gamification };
  }
  return {
    profile: {
      ...defaults.profile,
      ...local.profile,
      ...(remoteProfile.profile_data || {}),
      sessionAmbient: {
        ...defaults.profile.sessionAmbient,
        ...local.profile.sessionAmbient,
        ...(remoteProfile.profile_data?.sessionAmbient || {}),
      },
      music: {
        ...defaults.profile.music,
        ...local.profile.music,
        ...(remoteProfile.profile_data?.music || {}),
      },
      pomodoro: {
        ...defaults.profile.pomodoro,
        ...local.profile.pomodoro,
        ...(remoteProfile.profile_data?.pomodoro || {}),
      },
      aiTutor: {
        ...defaults.profile.aiTutor,
        ...local.profile.aiTutor,
        ...(remoteProfile.profile_data?.aiTutor || {}),
      },
      hiddenSidebarItems: Array.isArray(remoteProfile.profile_data?.hiddenSidebarItems)
        ? remoteProfile.profile_data.hiddenSidebarItems
        : local.profile.hiddenSidebarItems,
      hideAiTutor: typeof remoteProfile.profile_data?.hideAiTutor === 'boolean'
        ? remoteProfile.profile_data.hideAiTutor
        : local.profile.hideAiTutor,
    },
    gamification: {
      ...defaults.gamification,
      ...local.gamification,
      ...(remoteProfile.gamification_data || {}),
      fruitCollection: {
        ...defaults.gamification.fruitCollection,
        ...local.gamification.fruitCollection,
        ...(remoteProfile.gamification_data?.fruitCollection || {}),
      },
    },
  };
}

export async function getCurrentUser(client: SupabaseClient): Promise<User | null> {
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

export async function signInWithPassword(client: SupabaseClient, email: string, password: string): Promise<User> {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error('Sign in failed.');
  return data.user;
}

export async function signUpWithPassword(client: SupabaseClient, email: string, password: string): Promise<void> {
  const { error } = await client.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function syncAppState(client: SupabaseClient, user: User, local: AppState): Promise<AppState> {
  const [
    { data: profileData, error: profileError },
    { data: labelsData, error: labelsError },
    { data: tasksData, error: tasksError },
    { data: notesData, error: notesError },
    { data: subjectsData, error: subjectsError },
    { data: flashcardsData, error: flashcardsError },
    { data: sessionsData, error: sessionsError },
    { data: deadlinesData, error: deadlinesError },
    { data: assessmentsData, error: assessmentsError },
  ] =
    await Promise.all([
      client.from(TABLES.profile).select('*').eq('id', user.id).maybeSingle(),
      client.from(TABLES.labels).select('*').eq('user_id', user.id),
      client.from(TABLES.tasks).select('*').eq('user_id', user.id),
      client.from(TABLES.notes).select('*').eq('user_id', user.id),
      client.from(TABLES.subjects).select('*').eq('user_id', user.id),
      client.from(TABLES.flashcards).select('*').eq('user_id', user.id),
      client.from(TABLES.sessions).select('*').eq('user_id', user.id),
      client.from(TABLES.deadlines).select('*').eq('user_id', user.id),
      client.from(TABLES.assessments).select('*').eq('user_id', user.id),
    ]);

  // Deadlines and grades were added later; older projects may not have run the
  // newer schema yet, so their tables are optional and simply stay local.
  const optionalError = [deadlinesError, assessmentsError].find((error) => error && !isMissingTableError(error));
  const hasDeadlinesTable = !deadlinesError;
  const hasAssessmentsTable = !assessmentsError;

  const firstError = profileError || labelsError || tasksError || notesError || subjectsError || flashcardsError || sessionsError || optionalError;
  if (firstError) {
    if (isMissingTableError(firstError)) {
      throw new Error(`Bloomora V2 sync tables are missing. Run the latest supabase_schema_v2.sql in Supabase SQL Editor, then try Sync now again. Details: ${syncErrorMessage(firstError)}`);
    }
    throw new Error(syncErrorMessage(firstError));
  }

  const remoteProfile = profileData as RemoteProfile | null;
  const remoteLabels = ((labelsData ?? []) as RemoteLabelRow[]).map(remoteLabel).filter((row) => row.id);
  const remoteTasks = ((tasksData ?? []) as RemoteTaskRow[]).map(remoteTask).filter((row) => row.id);
  const remoteNotes = ((notesData ?? []) as RemoteNoteRow[]).map(remoteNote).filter((row) => row.id);
  const remoteSubjects = ((subjectsData ?? []) as RemoteSubjectRow[]).map(remoteSubject).filter((row) => row.id);
  const remoteFlashcards = ((flashcardsData ?? []) as RemoteFlashcardRow[]).map(remoteFlashcard).filter((row) => row.id);
  const remoteSessions = ((sessionsData ?? []) as RemoteSessionRow[]).map(remoteSession).filter((row) => row.id);
  const remoteDeadlines = ((deadlinesData ?? []) as RemoteDeadlineRow[])
    .map(remoteDeadline)
    .filter((row): row is Deadline => Boolean(row?.id));
  const remoteAssessments = ((assessmentsData ?? []) as RemoteAssessmentRow[])
    .map(remoteAssessment)
    .filter((row): row is Assessment => Boolean(row?.id));
  const shouldImportLegacy = !remoteProfile
    && remoteLabels.length === 0
    && remoteTasks.length === 0
    && remoteNotes.length === 0
    && remoteSubjects.length === 0
    && remoteFlashcards.length === 0
    && remoteSessions.length === 0;
  const localWithLegacy = shouldImportLegacy ? await importLegacyBloomoraState(client, user, local) : local;
  const mergedProfile = mergeProfile(localWithLegacy, remoteProfile);

  const merged: AppState = {
    ...localWithLegacy,
    ...mergedProfile,
    labels: mergeRows(localWithLegacy.labels, remoteLabels),
    tasks: mergeRows(localWithLegacy.tasks, remoteTasks),
    notes: mergeRows(localWithLegacy.notes || [], remoteNotes),
    subjects: mergeRows(localWithLegacy.subjects || [], remoteSubjects),
    flashcards: mergeRows(localWithLegacy.flashcards || [], remoteFlashcards),
    sessions: mergeRows(localWithLegacy.sessions, remoteSessions),
    deadlines: mergeRows(localWithLegacy.deadlines || [], remoteDeadlines),
    assessments: mergeRows(localWithLegacy.assessments || [], remoteAssessments),
    sync: {
      enabled: true,
      status: 'idle',
      userEmail: user.email,
      lastSyncAt: nowIso(),
    },
    updatedAt: nowIso(),
  };

  const results = await Promise.all([
    upsertProfile(client, user.id, merged),
    upsertLabels(client, user.id, merged.labels),
    upsertTasks(client, user.id, merged.tasks),
    upsertNotes(client, user.id, merged.notes),
    upsertSubjects(client, user.id, merged.subjects),
    upsertFlashcards(client, user.id, merged.flashcards),
    upsertSessions(client, user.id, merged.sessions),
    hasDeadlinesTable ? upsertDeadlines(client, user.id, merged.deadlines) : undefined,
    hasAssessmentsTable ? upsertAssessments(client, user.id, merged.assessments) : undefined,
  ]);
  const writeError = results.find((result) => result?.error)?.error;
  if (writeError) throw new Error(syncErrorMessage(writeError));

  return merged;
}

type UpsertResult = { error: unknown } | undefined;

function isMissingColumnError(error: unknown, columns: string[]): boolean {
  const message = syncErrorMessage(error).toLowerCase();
  return (message.includes('column') || message.includes('pgrst204') || message.includes('42703'))
    && columns.some((column) => message.includes(column));
}

/**
 * Upserts rows, retrying without newer optional columns when the remote table
 * predates them so older Supabase projects keep syncing their core data.
 */
async function upsertRows(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  optionalColumns: string[] = [],
): Promise<UpsertResult> {
  if (!rows.length) return undefined;
  const first = await client.from(table).upsert(rows, { onConflict: 'user_id,id' });
  if (!first.error || !optionalColumns.length || !isMissingColumnError(first.error, optionalColumns)) return first;
  const stripped = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !optionalColumns.includes(key))));
  return client.from(table).upsert(stripped, { onConflict: 'user_id,id' });
}

async function upsertProfile(client: SupabaseClient, userId: string, state: AppState) {
  return client.from(TABLES.profile).upsert(
    {
      id: userId,
      profile_data: state.profile,
      gamification_data: state.gamification,
      updated_at: state.updatedAt,
    },
    { onConflict: 'id' },
  );
}

async function upsertLabels(client: SupabaseClient, userId: string, labels: Label[]) {
  return upsertRows(
    client,
    TABLES.labels,
    labels.map((label) => ({
      user_id: userId,
      id: label.id,
      name: label.name,
      color: label.color,
      favorite: label.favorite,
      created_at: label.createdAt,
      updated_at: label.updatedAt,
      deleted_at: label.deletedAt ?? null,
    })),
  );
}

async function upsertTasks(client: SupabaseClient, userId: string, tasks: StudyTask[]) {
  return upsertRows(
    client,
    TABLES.tasks,
    tasks.map((task) => ({
      user_id: userId,
      id: task.id,
      text: task.text,
      notes: task.notes ?? null,
      label_id: task.labelId ?? null,
      due_date: task.dueDate ?? null,
      priority: task.priority ?? null,
      done: task.done,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      completed_at: task.completedAt ?? null,
      deleted_at: task.deletedAt ?? null,
    })),
    ['due_date', 'priority'],
  );
}

async function upsertNotes(client: SupabaseClient, userId: string, notes: StudyNote[]) {
  return upsertRows(
    client,
    TABLES.notes,
    notes.map((note) => ({
      user_id: userId,
      id: note.id,
      title: note.title,
      body: note.body,
      label_id: note.labelId ?? null,
      pinned: note.pinned,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
      deleted_at: note.deletedAt ?? null,
    })),
  );
}

async function upsertSubjects(client: SupabaseClient, userId: string, subjects: StudySubject[]) {
  return upsertRows(
    client,
    TABLES.subjects,
    subjects.map((subject) => ({
      user_id: userId,
      id: subject.id,
      name: subject.name,
      qualification: subject.qualification,
      exam_board: subject.examBoard,
      target_grade: subject.targetGrade,
      exam_date: subject.examDate,
      created_at: subject.createdAt,
      updated_at: subject.updatedAt,
      deleted_at: subject.deletedAt ?? null,
    })),
  );
}

async function upsertFlashcards(client: SupabaseClient, userId: string, flashcards: Flashcard[]) {
  return upsertRows(
    client,
    TABLES.flashcards,
    flashcards.map((card) => ({
      user_id: userId,
      id: card.id,
      front: card.front,
      back: card.back,
      subject_id: card.subjectId ?? null,
      label_id: card.labelId ?? null,
      review: card.review ?? null,
      created_at: card.createdAt,
      updated_at: card.updatedAt,
      deleted_at: card.deletedAt ?? null,
    })),
    ['review'],
  );
}

async function upsertSessions(client: SupabaseClient, userId: string, sessions: StudySession[]) {
  return upsertRows(
    client,
    TABLES.sessions,
    sessions.map((session) => ({
      user_id: userId,
      id: session.id,
      start_at: session.startAt,
      end_at: session.endAt,
      duration_sec: session.durationSec,
      method: session.method,
      reward_mode: session.rewardMode,
      note: session.note ?? null,
      label_id: session.labelId ?? null,
      label_name_snapshot: session.labelNameSnapshot ?? null,
      task_ids: session.taskIds,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      deleted_at: session.deletedAt ?? null,
    })),
  );
}

async function upsertDeadlines(client: SupabaseClient, userId: string, deadlines: Deadline[]) {
  return upsertRows(
    client,
    TABLES.deadlines,
    deadlines.map((deadline) => ({
      user_id: userId,
      id: deadline.id,
      title: deadline.title,
      kind: deadline.kind,
      subject_id: deadline.subjectId ?? null,
      due_at: deadline.dueAt,
      weight: deadline.weight ?? null,
      status: deadline.status,
      notes: deadline.notes ?? null,
      created_at: deadline.createdAt,
      updated_at: deadline.updatedAt,
      deleted_at: deadline.deletedAt ?? null,
    })),
  );
}

async function upsertAssessments(client: SupabaseClient, userId: string, assessments: Assessment[]) {
  return upsertRows(
    client,
    TABLES.assessments,
    assessments.map((assessment) => ({
      user_id: userId,
      id: assessment.id,
      title: assessment.title,
      subject_id: assessment.subjectId ?? null,
      score: assessment.score,
      max_score: assessment.maxScore,
      weight: assessment.weight ?? null,
      date: assessment.date || null,
      notes: assessment.notes ?? null,
      created_at: assessment.createdAt,
      updated_at: assessment.updatedAt,
      deleted_at: assessment.deletedAt ?? null,
    })),
  );
}
