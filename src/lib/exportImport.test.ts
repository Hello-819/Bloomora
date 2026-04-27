import { describe, expect, it } from 'vitest';
import { createDefaultState } from './defaultState';
import { createExportPayload, validateImportText } from './exportImport';

describe('export and import validation', () => {
  it('rejects corrupt JSON', () => {
    expect(validateImportText('{bad json')).toEqual({ error: 'That file is not valid JSON.' });
  });

  it('accepts a v2 export payload and creates a preview', () => {
    const state = createDefaultState();
    const result = validateImportText(createExportPayload(state));
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.sessions).toBe(0);
      expect(result.state.version).toBe(2);
    }
  });
});
