import type { AppState, Assessment, Deadline, EducationLevel, Flashcard, Label, StudyNote, StudySession, StudySubject, StudyTask } from '../types';

export function visibleSessions(state: AppState): StudySession[] {
  return state.sessions.filter((session) => !session.deletedAt);
}

export function visibleLabels(state: AppState): Label[] {
  return state.labels
    .filter((label) => !label.deletedAt)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export function visibleTasks(state: AppState): StudyTask[] {
  return state.tasks
    .filter((task) => !task.deletedAt)
    .sort((a, b) =>
      Number(a.done) - Number(b.done)
      || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
      || PRIORITY_RANK[a.priority || 'medium'] - PRIORITY_RANK[b.priority || 'medium']
      || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function visibleNotes(state: AppState): StudyNote[] {
  return (state.notes || [])
    .filter((note) => !note.deletedAt)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function visibleSubjects(state: AppState): StudySubject[] {
  return (state.subjects || [])
    .filter((subject) => !subject.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function visibleFlashcards(state: AppState): Flashcard[] {
  return (state.flashcards || [])
    .filter((card) => !card.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function visibleDeadlines(state: AppState): Deadline[] {
  return (state.deadlines || [])
    .filter((item) => !item.deletedAt)
    .sort((a, b) => Number(a.status === 'submitted') - Number(b.status === 'submitted') || a.dueAt.localeCompare(b.dueAt));
}

export function visibleAssessments(state: AppState): Assessment[] {
  return (state.assessments || [])
    .filter((item) => !item.deletedAt)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function activeSubject(state: AppState): StudySubject | undefined {
  const subjects = visibleSubjects(state);
  return subjects.find((subject) => subject.id === state.profile.aiTutor.activeSubjectId) || subjects[0];
}

export function subjectName(state: AppState, id?: string): string {
  if (!id) return 'General';
  return state.subjects.find((subject) => subject.id === id)?.name || 'Archived subject';
}

export function labelName(state: AppState, session: StudySession): string {
  if (session.labelId) {
    const label = state.labels.find((item) => item.id === session.labelId);
    if (label) return label.name;
  }
  return session.labelNameSnapshot || 'No label';
}

/** Parses a date-like string (YYYY-MM-DD, datetime-local, or free text such as "June 2026"). */
export function parseDateLoose(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T23:59:00`).getTime();
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

export function daysUntil(value: string | undefined, nowMs = Date.now()): number | null {
  const ms = parseDateLoose(value);
  if (ms === null) return null;
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const target = new Date(ms);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

export function relativeDays(days: number | null): string {
  if (days === null) return 'No date';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

export const EDUCATION_LEVELS: Array<[EducationLevel, string]> = [
  ['gcse', 'GCSE / secondary'],
  ['sixth-form', 'Sixth form (A level / IB)'],
  ['college', 'College (BTEC / T level / Access)'],
  ['university', 'University (undergraduate)'],
  ['postgraduate', 'Postgraduate'],
  ['other', 'Other'],
];

export function educationLabel(level: EducationLevel): string {
  return EDUCATION_LEVELS.find(([id]) => id === level)?.[1] || 'Student';
}

/** Students at university tend to say "module"; at school or college, "subject". */
export function subjectNoun(level: EducationLevel, plural = false): string {
  const word = level === 'university' || level === 'postgraduate' ? 'module' : 'subject';
  return plural ? `${word}s` : word;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
