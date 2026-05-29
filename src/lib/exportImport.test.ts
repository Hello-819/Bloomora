import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDefaultState } from './defaultState';
import { createExportPayload, validateImportText, downloadJson } from './exportImport';

describe('downloadJson', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(document, 'createElement');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('triggers a file download with the correct payload', () => {
    const filename = 'test-export.json';
    const payload = '{"test":true}';

    const realAnchor = document.createElement('a');

    // Prevent the default navigation action in jsdom
    realAnchor.addEventListener('click', (e) => e.preventDefault());
    vi.spyOn(realAnchor, 'click');

    vi.mocked(document.createElement).mockReturnValue(realAnchor);

    downloadJson(filename, payload);

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(realAnchor.href).toContain('blob:test-url');
    expect(realAnchor.download).toBe(filename);
    expect(realAnchor.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});

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
