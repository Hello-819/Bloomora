import type { AppState } from '../types';
import { normalizeImportedState } from './migration';

export interface ImportPreview {
  state: AppState;
  sessions: number;
  labels: number;
  tasks: number;
  notes: number;
  subjects: number;
  flashcards: number;
  totalStudySec: number;
}

export function createExportPayload(state: AppState): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'Bloomora',
      formatVersion: 2,
      state,
    },
    null,
    2,
  );
}

export function downloadJson(filename: string, payload: string): void {
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function validateImportText(text: string): ImportPreview | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }

  const source =
    parsed && typeof parsed === 'object' && 'state' in parsed
      ? (parsed as { state: unknown }).state
      : parsed;
  const state = normalizeImportedState(source);
  if (!state) return { error: 'The file format was recognized but data could not be validated.' };

  return {
    state,
    sessions: state.sessions.filter((session) => !session.deletedAt).length,
    labels: state.labels.filter((label) => !label.deletedAt).length,
    tasks: state.tasks.filter((task) => !task.deletedAt).length,
    notes: (state.notes || []).filter((note) => !note.deletedAt).length,
    subjects: (state.subjects || []).filter((subject) => !subject.deletedAt).length,
    flashcards: (state.flashcards || []).filter((card) => !card.deletedAt).length,
    totalStudySec: state.sessions
      .filter((session) => !session.deletedAt)
      .reduce((sum, session) => sum + session.durationSec, 0),
  };
}
