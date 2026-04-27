import Dexie, { type Table } from 'dexie';
import type { AppState } from '../types';
import { createDefaultState } from './defaultState';
import { normalizeImportedState, readV1StateFromLocalStorage } from './migration';

interface AppRecord {
  key: 'current';
  value: AppState;
  updatedAt: string;
}

class BloomoraDatabase extends Dexie {
  appState!: Table<AppRecord, 'current'>;

  constructor() {
    super('bloomora_v2');
    this.version(1).stores({
      appState: 'key, updatedAt',
    });
  }
}

export const db = new BloomoraDatabase();

export async function loadAppState(): Promise<AppState> {
  const saved = await db.appState.get('current');
  if (saved?.value) {
    const repaired = normalizeImportedState(saved.value) ?? saved.value;
    if (repaired !== saved.value) await saveAppState(repaired);
    return repaired;
  }

  const migrated = readV1StateFromLocalStorage();
  const initial = migrated ?? createDefaultState();
  await saveAppState(initial);
  return initial;
}

export async function saveAppState(value: AppState): Promise<void> {
  await db.appState.put({
    key: 'current',
    value,
    updatedAt: value.updatedAt,
  });
}

export async function clearAppState(): Promise<AppState> {
  const fresh = createDefaultState();
  await saveAppState(fresh);
  return fresh;
}
