import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadAppState, saveAppState, clearAppState, db } from './storage';
import { createDefaultState } from './defaultState';
import * as migration from './migration';

vi.mock('./migration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./migration')>();
  return {
    ...actual,
    readV1StateFromLocalStorage: vi.fn(),
    normalizeImportedState: vi.fn(),
  };
});

beforeEach(async () => {
  await db.appState.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('storage.ts', () => {
  it('should initialize the database empty', async () => {
    const count = await db.appState.count();
    expect(count).toBe(0);
  });
});

describe('saveAppState', () => {
  it('should save state to Dexie', async () => {
    const defaultState = createDefaultState();
    await saveAppState(defaultState);

    const saved = await db.appState.get('current');
    expect(saved).toBeDefined();
    expect(saved?.value).toEqual(defaultState);
    expect(saved?.updatedAt).toBe(defaultState.updatedAt);
  });
});

describe('clearAppState', () => {
  it('should clear state and return fresh default state', async () => {
    // Setup initial state
    const customState = createDefaultState();
    customState.profile.displayName = 'Custom User';
    await saveAppState(customState);

    // Check it's there
    let saved = await db.appState.get('current');
    expect(saved?.value.profile.displayName).toBe('Custom User');

    // Clear it
    const fresh = await clearAppState();

    // Verify returned state is default
    expect(fresh.profile.displayName).toBe('Student');

    // Verify database holds default state
    saved = await db.appState.get('current');
    expect(saved?.value.profile.displayName).toBe('Student');
  });
});

describe('loadAppState', () => {
  it('should create default state when no state exists', async () => {
    vi.mocked(migration.readV1StateFromLocalStorage).mockReturnValue(null);

    const loaded = await loadAppState();
    const defaultState = createDefaultState();

    // We expect the loaded state to roughly match a new default state
    expect(loaded.version).toBe(defaultState.version);
    expect(loaded.profile.displayName).toBe('Student');

    // Ensure it was saved to DB
    const saved = await db.appState.get('current');
    expect(saved?.value).toEqual(loaded);
  });

  it('should return existing state without modifications if valid', async () => {
    const existingState = createDefaultState();
    existingState.profile.displayName = 'Alice';
    await saveAppState(existingState);

    vi.mocked(migration.normalizeImportedState).mockReturnValue(existingState);

    const loaded = await loadAppState();
    expect(loaded).toEqual(existingState);
  });

  it('should migrate from V1 state if no V2 state exists', async () => {
    const v1MigratedState = createDefaultState();
    v1MigratedState.profile.displayName = 'Migrated V1 User';

    vi.mocked(migration.readV1StateFromLocalStorage).mockReturnValue(v1MigratedState);

    const loaded = await loadAppState();
    expect(loaded.profile.displayName).toBe('Migrated V1 User');

    // Verify it was saved to DB
    const saved = await db.appState.get('current');
    expect(saved?.value.profile.displayName).toBe('Migrated V1 User');
  });

  it('should repair and save existing state if normalization alters it', async () => {
    const existingState = createDefaultState();
    existingState.profile.displayName = 'Needs Repair';
    await saveAppState(existingState);

    const repairedState = createDefaultState();
    repairedState.profile.displayName = 'Repaired User';

    vi.mocked(migration.normalizeImportedState).mockReturnValue(repairedState);

    const loaded = await loadAppState();
    expect(loaded.profile.displayName).toBe('Repaired User');

    // Verify the repaired state was saved over the old one
    const saved = await db.appState.get('current');
    expect(saved?.value.profile.displayName).toBe('Repaired User');
  });
});
