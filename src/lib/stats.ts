import type { Label, StudySession } from '../types';
import { addDaysMs, dateKey, startOfDayMs, startOfMonthMs, startOfWeekMs, startOfYearMs } from './dates';

export type Timeframe = 'all' | 'year' | 'month' | 'week' | 'today';

export function timeframeStartMs(timeframe: Timeframe, nowMs = Date.now()): number {
  switch (timeframe) {
    case 'today': return startOfDayMs(nowMs);
    case 'week': return startOfWeekMs(nowMs);
    case 'month': return startOfMonthMs(nowMs);
    case 'year': return startOfYearMs(nowMs);
    case 'all': return 0;
  }
}

export function studyByLabel(sessions: StudySession[], labels: Label[], timeframe: Timeframe, nowMs = Date.now()) {
  const startMs = timeframeStartMs(timeframe, nowMs);
  const filtered = sessions.filter((session) => !session.deletedAt && Date.parse(session.endAt) >= startMs);

  const labelDurations: Record<string, number> = {};
  let totalSec = 0;
  filtered.forEach((session) => {
    const labelId = session.labelId || 'unlabeled';
    labelDurations[labelId] = (labelDurations[labelId] || 0) + session.durationSec;
    totalSec += session.durationSec;
  });

  const items = Object.entries(labelDurations).map(([id, duration]) => {
    const label = id === 'unlabeled'
      ? { id: 'unlabeled', name: 'Unlabelled', color: '#94a3b8' }
      : labels.find((item) => item.id === id) || { id, name: 'Archived label', color: '#94a3b8' };
    return { id: label.id, name: label.name, color: label.color, duration };
  }).sort((a, b) => b.duration - a.duration);

  return { items, totalSec };
}

export function studyTotals(sessions: StudySession[], nowMs = Date.now()) {
  const active = sessions.filter((session) => !session.deletedAt);
  const sumSince = (startMs: number) => active
    .filter((session) => Date.parse(session.endAt) >= startMs)
    .reduce((sum, session) => sum + session.durationSec, 0);
  return {
    totalSec: active.reduce((sum, session) => sum + session.durationSec, 0),
    todaySec: sumSince(startOfDayMs(nowMs)),
    weekSec: sumSince(startOfWeekMs(nowMs)),
    monthSec: sumSince(startOfMonthMs(nowMs)),
    count: active.length,
  };
}

/** Number of distinct days with at least a minute of study in the last `days` days (including today). */
export function activeDays(sessions: StudySession[], days: number, nowMs = Date.now()): number {
  const startMs = addDaysMs(startOfDayMs(nowMs), -(days - 1));
  const keys = new Set(
    sessions
      .filter((session) => !session.deletedAt && session.durationSec >= 60 && Date.parse(session.endAt) >= startMs)
      .map((session) => dateKey(session.endAt)),
  );
  return keys.size;
}

export function computeStreak(sessions: StudySession[], nowMs = Date.now()) {
  const studiedDays = new Set(
    sessions
      .filter((session) => !session.deletedAt && session.durationSec >= 60)
      .map((session) => dateKey(session.endAt)),
  );

  let current = 0;
  const cursor = new Date(startOfDayMs(nowMs));
  while (studiedDays.has(dateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  let longest = 0;
  let run = 0;
  let previous = '';
  for (const key of Array.from(studiedDays).sort()) {
    const prevDate = previous ? new Date(`${previous}T00:00:00`) : null;
    const currentDate = new Date(`${key}T00:00:00`);
    const contiguous = prevDate && Math.round((currentDate.getTime() - prevDate.getTime()) / 86400000) === 1;
    run = contiguous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  return { current, longest };
}

/** Average study time per active day over the last `days` days. */
export function averagePerActiveDay(sessions: StudySession[], days: number, nowMs = Date.now()): number {
  const startMs = addDaysMs(startOfDayMs(nowMs), -(days - 1));
  const recent = sessions.filter((session) => !session.deletedAt && Date.parse(session.endAt) >= startMs);
  const total = recent.reduce((sum, session) => sum + session.durationSec, 0);
  const dayCount = activeDays(recent, days, nowMs);
  return dayCount ? total / dayCount : 0;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function sessionsToCsv(sessions: StudySession[], labelNameFor: (session: StudySession) => string): string {
  const header = ['Date', 'Start', 'End', 'Minutes', 'Method', 'Label', 'Note'];
  const rows = sessions
    .filter((session) => !session.deletedAt)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((session) => {
      const start = new Date(session.startAt);
      const end = new Date(session.endAt);
      const time = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      return [
        dateKey(start),
        time(start),
        time(end),
        Math.round(session.durationSec / 60),
        session.method,
        labelNameFor(session),
        session.note || '',
      ].map(csvCell).join(',');
    });
  return [header.join(','), ...rows].join('\n');
}
