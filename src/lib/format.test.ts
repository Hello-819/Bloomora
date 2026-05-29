import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatDuration, formatClock, formatDateTime, compactHours } from './format';

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes only and drops seconds', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(119)).toBe('1m');
    expect(formatDuration(3599)).toBe('59m');
  });

  it('formats hours and minutes and drops seconds', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(3665)).toBe('1h 1m'); // seconds ignored
    expect(formatDuration(7259)).toBe('2h 0m'); // 2 hours, 0 minutes (59 seconds ignored)
  });

  it('handles negative inputs by converting them to 0', () => {
    expect(formatDuration(-10)).toBe('0s');
  });

  it('rounds floating point inputs correctly', () => {
    expect(formatDuration(59.4)).toBe('59s');
    expect(formatDuration(59.5)).toBe('1m'); // 60 seconds
  });
});

describe('formatClock', () => {
  it('formats MM:SS when under an hour', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9)).toBe('00:09');
    expect(formatClock(59)).toBe('00:59');
    expect(formatClock(60)).toBe('01:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3599)).toBe('59:59');
  });

  it('formats HH:MM:SS when an hour or more', () => {
    expect(formatClock(3600)).toBe('01:00:00');
    expect(formatClock(3665)).toBe('01:01:05');
    expect(formatClock(36000)).toBe('10:00:00');
    expect(formatClock(360000)).toBe('100:00:00'); // more than 2 digits for hours
  });

  it('handles negative inputs by converting them to 0', () => {
    expect(formatClock(-50)).toBe('00:00');
  });

  it('rounds floating point inputs correctly', () => {
    expect(formatClock(59.4)).toBe('00:59');
    expect(formatClock(59.5)).toBe('01:00');
  });
});

describe('formatDateTime', () => {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  afterEach(() => {
    Intl.DateTimeFormat = originalDateTimeFormat;
    vi.restoreAllMocks();
  });

  it('calls Intl.DateTimeFormat with correct options', () => {
    const formatSpy = vi.fn().mockReturnValue('Mocked Date');
    const dateTimeFormatSpy = vi.fn().mockImplementation(() => ({
      format: formatSpy,
    }));

    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: dateTimeFormatSpy,
    });

    const iso = '2026-04-13T12:00:00.000Z';
    const result = formatDateTime(iso);

    expect(dateTimeFormatSpy).toHaveBeenCalledWith(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Check if format was called with a Date object matching the iso string
    expect(formatSpy).toHaveBeenCalledTimes(1);
    const dateArg = formatSpy.mock.calls[0][0];
    expect(dateArg).toBeInstanceOf(Date);
    expect(dateArg.toISOString()).toBe(iso);

    expect(result).toBe('Mocked Date');
  });

  it('returns a formatted string without crashing using actual Intl implementation', () => {
    Intl.DateTimeFormat = originalDateTimeFormat; // ensure we use real implementation
    const result = formatDateTime('2026-04-13T12:00:00.000Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('compactHours', () => {
  it('formats exactly 0', () => {
    expect(compactHours(0)).toBe('0.0h');
  });

  it('formats under an hour with 1 decimal', () => {
    expect(compactHours(1800)).toBe('0.5h'); // 0.5 hours
    expect(compactHours(1200)).toBe('0.3h'); // ~0.33 hours -> 0.3
  });

  it('formats under 10 hours with 1 decimal', () => {
    expect(compactHours(3600)).toBe('1.0h');
    expect(compactHours(5400)).toBe('1.5h');
    expect(compactHours(35999)).toBe('10.0h'); // 9.9997 hours -> 10.0h
  });

  it('formats 10 hours or more with 0 decimals', () => {
    expect(compactHours(36000)).toBe('10h');
    expect(compactHours(37800)).toBe('11h'); // 10.5 hours -> 11h (due to toFixed(0))
    expect(compactHours(72000)).toBe('20h');
  });
});
