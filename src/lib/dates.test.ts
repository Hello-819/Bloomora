import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  nowIso,
  dateKey,
} from './dates';

describe('dates.ts', () => {
  // Use a fixed date for testing functions that depend on the current time
  const MOCK_DATE = new Date('2023-10-27T12:34:56.789Z'); // A Friday

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('nowIso', () => {
    it('returns the current ISO string', () => {
      expect(nowIso()).toBe('2023-10-27T12:34:56.789Z');
    });
  });

  describe('dateKey', () => {
    it('returns date key for no input (uses current time)', () => {
      // Local time of 2023-10-27T12:34:56.789Z depends on timezone, but let's test explicit inputs mainly
      // For no input, we just check if it matches the mock date's local string
      const y = MOCK_DATE.getFullYear();
      const m = String(MOCK_DATE.getMonth() + 1).padStart(2, '0');
      const d = String(MOCK_DATE.getDate()).padStart(2, '0');
      expect(dateKey()).toBe(`${y}-${m}-${d}`);
    });

    it('returns correct format for Date object', () => {
      const d = new Date(2023, 0, 5); // Jan 5, 2023 local
      expect(dateKey(d)).toBe('2023-01-05');
    });

    it('returns correct format for timestamp', () => {
      const d = new Date(2023, 11, 25); // Dec 25, 2023 local
      expect(dateKey(d.getTime())).toBe('2023-12-25');
    });

    it('returns correct format for string', () => {
      expect(dateKey('2024-02-29T10:00:00')).toBe('2024-02-29'); // Leap year
    });
  });
});
