import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createId } from './id';

describe('createId', () => {
  let originalCrypto: any;

  beforeEach(() => {
    originalCrypto = globalThis.crypto;
  });

  afterEach(() => {
    // Restore globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('generates an id with the default prefix "id" and randomUUID', () => {
    const mockUUID = '1234-5678-9012';
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => mockUUID },
      writable: true,
      configurable: true,
    });

    const id = createId();
    expect(id).toBe('id_1234-5678-9012');
  });

  it('generates an id with a custom prefix and randomUUID', () => {
    const mockUUID = 'abcd-efgh-ijkl';
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => mockUUID },
      writable: true,
      configurable: true,
    });

    const id = createId('task');
    expect(id).toBe('task_abcd-efgh-ijkl');
  });

  it('falls back to Math.random and Date.now when crypto is not available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const mockDateNow = 1620000000000;
    vi.spyOn(Date, 'now').mockReturnValue(mockDateNow);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    // 0.123456789.toString(16) -> "0.1f9add3739636"
    // slice(2) -> "1f9add3739636"
    const expectedRandomPart = (0.123456789).toString(16).slice(2);

    const id = createId('fallback');
    expect(id).toBe(`fallback_${expectedRandomPart}_${mockDateNow}`);
  });
});
