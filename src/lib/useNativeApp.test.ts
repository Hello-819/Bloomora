import { describe, expect, it } from 'vitest';
import { planDeadlineReminders } from './useNativeApp';
import { createDefaultState } from './defaultState';
import type { Deadline } from '../types';

function deadline(id: string, dueAt: string, status: Deadline['status'] = 'not-started'): Deadline {
  return { id, title: `Essay ${id}`, kind: 'coursework', dueAt, status, createdAt: '', updatedAt: '' };
}

describe('planDeadlineReminders', () => {
  const now = new Date('2026-05-10T12:00:00').getTime();

  it('schedules an evening-before and a same-day reminder', () => {
    const state = { ...createDefaultState(), deadlines: [deadline('a', '2026-05-14')] };
    const plan = planDeadlineReminders(state, now);
    expect(plan.map((item) => new Date(item.at).toString())).toEqual([
      new Date('2026-05-13T18:00:00').toString(),
      new Date('2026-05-14T08:30:00').toString(),
    ]);
    expect(plan[0].title).toBe('Due tomorrow: Essay a');
  });

  it('reminds two hours before a timed deadline and skips past reminders', () => {
    const state = { ...createDefaultState(), deadlines: [deadline('b', '2026-05-10T17:00')] };
    const plan = planDeadlineReminders(state, now);
    expect(plan).toHaveLength(1);
    expect(new Date(plan[0].at).getHours()).toBe(15);
  });

  it('ignores submitted, archived and past deadlines', () => {
    const state = {
      ...createDefaultState(),
      deadlines: [
        deadline('c', '2026-05-20', 'submitted'),
        { ...deadline('d', '2026-05-20'), deletedAt: '2026-05-01T00:00:00.000Z' },
        deadline('e', '2026-05-01'),
      ],
    };
    expect(planDeadlineReminders(state, now)).toEqual([]);
  });
});
