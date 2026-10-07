import { describe, expect, it } from 'vitest';
import { activeDays, computeStreak, sessionsToCsv, studyByLabel, studyTotals } from './stats';
import type { Label, StudySession } from '../types';

function session(id: string, endAt: string, durationSec = 120, labelId?: string): StudySession {
  return {
    id,
    startAt: new Date(Date.parse(endAt) - durationSec * 1000).toISOString(),
    endAt,
    durationSec,
    method: 'manual',
    rewardMode: 'island',
    labelId,
    taskIds: [],
    createdAt: endAt,
    updatedAt: endAt,
  };
}

describe('study stats', () => {
  it('computes current and longest consecutive study days', () => {
    const now = new Date('2026-04-13T12:00:00').getTime();
    const sessions = [
      session('a', '2026-04-11T18:00:00.000Z'),
      session('b', '2026-04-12T18:00:00.000Z'),
      session('c', '2026-04-13T18:00:00.000Z'),
      session('d', '2026-04-08T18:00:00.000Z'),
    ];
    expect(computeStreak(sessions, now)).toEqual({ current: 3, longest: 3 });
  });

  it('totals today, week and all-time study while skipping archived sessions', () => {
    const now = new Date('2026-04-15T12:00:00').getTime();
    const sessions = [
      session('a', new Date('2026-04-15T09:00:00').toISOString(), 1800),
      session('b', new Date('2026-04-13T09:00:00').toISOString(), 600),
      session('c', new Date('2026-03-01T09:00:00').toISOString(), 300),
      { ...session('d', new Date('2026-04-15T10:00:00').toISOString(), 999), deletedAt: '2026-04-15T11:00:00.000Z' },
    ];
    expect(studyTotals(sessions, now)).toMatchObject({ todaySec: 1800, weekSec: 2400, totalSec: 2700, count: 3 });
  });

  it('counts distinct active days in a window', () => {
    const now = new Date('2026-04-15T12:00:00').getTime();
    const sessions = [
      session('a', new Date('2026-04-15T09:00:00').toISOString()),
      session('b', new Date('2026-04-15T15:00:00').toISOString()),
      session('c', new Date('2026-04-10T09:00:00').toISOString()),
      session('d', new Date('2026-04-01T09:00:00').toISOString()),
      session('e', new Date('2026-04-14T09:00:00').toISOString(), 30),
    ];
    expect(activeDays(sessions, 7, now)).toBe(2);
  });

  it('groups study by label with an unlabelled bucket', () => {
    const labels: Label[] = [{ id: 'l1', name: 'Maths', color: '#000', favorite: false, createdAt: '', updatedAt: '' }];
    const result = studyByLabel(
      [session('a', '2026-04-15T09:00:00.000Z', 600, 'l1'), session('b', '2026-04-15T10:00:00.000Z', 300)],
      labels,
      'all',
    );
    expect(result.totalSec).toBe(900);
    expect(result.items.map((item) => item.name)).toEqual(['Maths', 'Unlabelled']);
  });

  it('exports sessions as CSV with quoted fields', () => {
    const csv = sessionsToCsv([{ ...session('a', '2026-04-15T09:30:00.000Z', 1800), note: 'Past paper, Q1-3' }], () => 'Maths');
    const [header, row] = csv.split('\n');
    expect(header).toBe('Date,Start,End,Minutes,Method,Label,Note');
    expect(row).toContain(',30,manual,Maths,"Past paper, Q1-3"');
  });
});
