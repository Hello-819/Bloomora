export type StudyMethod = 'stopwatch' | 'timer' | 'pomodoro' | 'manual';
export type RewardMode = 'island' | 'garden';
export type TimerMode = 'stopwatch' | 'countdown' | 'pomodoro';
export type ThemeName = 'daybreak' | 'grove' | 'aqua' | 'ink';
export type ColorMode = 'light' | 'dark';
export type AmbientType = 'off' | 'fire' | 'wind' | 'sea' | 'nature';
export type EducationLevel = 'gcse' | 'sixth-form' | 'college' | 'university' | 'postgraduate' | 'other';
export type TaskPriority = 'low' | 'medium' | 'high';
export type DeadlineKind = 'assignment' | 'coursework' | 'exam' | 'presentation' | 'reading' | 'other';
export type DeadlineStatus = 'not-started' | 'in-progress' | 'submitted';
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface Label {
  id: string;
  name: string;
  color: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StudyTask {
  id: string;
  text: string;
  notes?: string;
  labelId?: string;
  dueDate?: string;
  priority?: TaskPriority;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
}

export interface StudyNote {
  id: string;
  title: string;
  body: string;
  labelId?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StudySubject {
  id: string;
  name: string;
  qualification: string;
  examBoard: string;
  targetGrade: string;
  examDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface FlashcardReview {
  dueAt: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subjectId?: string;
  labelId?: string;
  review?: FlashcardReview;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Deadline {
  id: string;
  title: string;
  kind: DeadlineKind;
  subjectId?: string;
  dueAt: string;
  weight?: number;
  status: DeadlineStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Assessment {
  id: string;
  title: string;
  subjectId?: string;
  score: number;
  maxScore: number;
  weight?: number;
  date: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface StudySession {
  id: string;
  startAt: string;
  endAt: string;
  durationSec: number;
  method: StudyMethod;
  rewardMode: RewardMode;
  note?: string;
  labelId?: string;
  labelNameSnapshot?: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ProfileSettings {
  displayName: string;
  avatarImage?: string;
  educationLevel: EducationLevel;
  institution: string;
  course: string;
  yearOfStudy: string;
  weeklyGoalHours: number;
  dailyGoalMinutes: number;
  theme: ThemeName;
  colorMode: ColorMode;
  backgroundImage?: string;
  stopwatchCapOn: boolean;
  stopwatchCapHours: number;
  timerRequireLabel: boolean;
  sessionAmbient: {
    type: AmbientType;
    volume: number;
  };
  music: {
    lofiVideoId: string;
    volume: number;
    videoBackground: boolean;
  };
  pomodoro: {
    focusMin: number;
    shortBreakMin: number;
    longBreakMin: number;
    longEvery: number;
  };
  aiTutor: {
    activeSubjectId: string;
  };
  hiddenSidebarItems: string[];
  hideAiTutor?: boolean;
  sidebarCollapsed?: boolean;
  /** Android app only: notify before deadlines are due. Defaults to on. */
  notifyDeadlines?: boolean;
  /** Android app only: notify when a timed focus round or break ends. Defaults to on. */
  notifyTimer?: boolean;
  /** Android app only: keep the screen awake while a timer is running. Defaults to on. */
  keepScreenOn?: boolean;
}

export interface RewardLogItem {
  id: string;
  createdAt: string;
  title: string;
  detail: string;
  kind: 'session' | 'achievement' | 'quest' | 'fruit';
}

export interface QuestProgress {
  id: string;
  dateKey: string;
  completed: boolean;
  completedAt?: string;
}

/**
 * Legacy progression data from earlier Bloomora versions. It is no longer shown
 * or updated, but is kept so old backups and cloud rows still round-trip.
 */
export interface GamificationState {
  islandXpSec: number;
  gardenGrowthSec: number;
  gardenTreeType: string;
  gardenHarvestedOnTree: number;
  fruitCollection: Record<string, number>;
  achievementIds: string[];
  quests: Record<string, QuestProgress>;
  rewardLog: RewardLogItem[];
}

export interface TimerLabeling {
  rewardMode?: RewardMode;
  labelId?: string;
  taskIds: string[];
}

export interface ActiveTimer {
  id: string;
  mode: TimerMode;
  running: boolean;
  startedAt: string;
  lastStartedAt?: string;
  accumulatedSec: number;
  totalSec?: number;
  pomodoro?: {
    phase: 'focus' | 'break';
    round: number;
    focusMin: number;
    shortBreakMin: number;
    longBreakMin: number;
    longEvery: number;
  };
  labeling: TimerLabeling;
  updatedAt: string;
}

export interface SyncState {
  enabled: boolean;
  userEmail?: string;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncAt?: string;
  lastError?: string;
}

export interface TimetableEntry {
  id: string;
  day: string;
  timeHr: string;
  module: string;
}

export interface Timetable {
  entries: TimetableEntry[];
  updatedAt: string;
}

export interface AppState {
  version: 2;
  createdAt: string;
  updatedAt: string;
  profile: ProfileSettings;
  labels: Label[];
  tasks: StudyTask[];
  notes: StudyNote[];
  subjects: StudySubject[];
  flashcards: Flashcard[];
  sessions: StudySession[];
  deadlines: Deadline[];
  assessments: Assessment[];
  gamification: GamificationState;
  activeTimer?: ActiveTimer;
  sync: SyncState;
  timetable?: Timetable;
}

export interface SessionDraft {
  durationSec: number;
  method: StudyMethod;
  rewardMode?: RewardMode;
  note?: string;
  labelId?: string;
  taskIds?: string[];
  startedAt?: string;
  endedAt?: string;
}
