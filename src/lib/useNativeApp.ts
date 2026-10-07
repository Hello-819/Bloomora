import { useEffect, useMemo } from 'react';
import type { AppState } from '../types';
import { remainingForTimer } from './timers';
import { parseDateLoose } from './selectors';
import {
  cancelNativeReminder,
  cancelNativeReminderGroup,
  exitNativeApp,
  isNativeApp,
  reminderId,
  scheduleNativeReminder,
  setNativeKeepScreenOn,
  setNativeSystemBars,
} from './native';

const TIMER_REMINDER_ID = 1;
const MAX_DEADLINE_REMINDERS = 60;

interface PlannedReminder {
  key: string;
  title: string;
  body: string;
  at: number;
}

/** Reminders for unsubmitted deadlines: the evening before, and the morning of (or two hours before a timed deadline). */
export function planDeadlineReminders(state: AppState, nowMs = Date.now()): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const deadline of state.deadlines || []) {
    if (deadline.deletedAt || deadline.status === 'submitted') continue;
    const dueMs = parseDateLoose(deadline.dueAt);
    if (dueMs === null || dueMs <= nowMs) continue;
    const hasTime = deadline.dueAt.includes('T');
    const due = new Date(dueMs);
    const dueLabel = hasTime ? due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'today';

    const eveBefore = new Date(due);
    eveBefore.setDate(eveBefore.getDate() - 1);
    eveBefore.setHours(18, 0, 0, 0);
    planned.push({
      key: `deadline:${deadline.id}:eve`,
      title: `Due tomorrow: ${deadline.title}`,
      body: deadline.status === 'not-started' ? 'You have not started this yet.' : 'Final checks before it is due.',
      at: eveBefore.getTime(),
    });

    const sameDay = new Date(due);
    if (hasTime) sameDay.setTime(dueMs - 2 * 3600 * 1000);
    else sameDay.setHours(8, 30, 0, 0);
    planned.push({
      key: `deadline:${deadline.id}:day`,
      title: `Due ${hasTime ? `at ${dueLabel}` : 'today'}: ${deadline.title}`,
      body: deadline.weight ? `Worth ${deadline.weight}% of your grade.` : 'Open Bloomora to see your deadlines.',
      at: sameDay.getTime(),
    });
  }
  return planned
    .filter((item) => item.at > nowMs)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_DEADLINE_REMINDERS);
}

/**
 * Keeps Android-only behaviour in sync with app state: status bar colours,
 * timer and deadline notifications, keeping the screen awake and the back button.
 */
export function useNativeApp(state: AppState | null, onBack: () => boolean) {
  const native = isNativeApp();

  useEffect(() => {
    if (!native || !state) return;
    const dark = state.profile.colorMode === 'dark';
    setNativeSystemBars(dark ? '#0d0e11' : '#f6f6f7', dark);
  }, [native, state?.profile.colorMode]);

  useEffect(() => {
    if (!native) return undefined;
    window.__bloomoraBack = () => {
      if (onBack()) return true;
      exitNativeApp();
      return true;
    };
    return () => {
      delete window.__bloomoraBack;
    };
  }, [native, onBack]);

  const timer = state?.activeTimer;
  const timerKey = timer ? `${timer.id}:${timer.running}:${timer.accumulatedSec}:${timer.lastStartedAt}:${timer.totalSec}` : 'none';
  useEffect(() => {
    if (!native || !state) return;
    const keepAwake = state.profile.keepScreenOn !== false && Boolean(timer?.running);
    setNativeKeepScreenOn(keepAwake);
    cancelNativeReminder(TIMER_REMINDER_ID);
    if (!timer?.running || !timer.totalSec || state.profile.notifyTimer === false) return;
    const remaining = remainingForTimer(timer, Date.now());
    if (remaining === null || remaining <= 0) return;
    const isBreak = timer.pomodoro?.phase === 'break';
    const title = timer.mode === 'pomodoro' ? (isBreak ? 'Break over' : 'Focus round complete') : 'Timer finished';
    const body = timer.mode === 'pomodoro'
      ? isBreak ? 'Ready for the next focus round?' : 'Nice work — your session has been logged. Time for a break.'
      : 'Open Bloomora to log your session.';
    scheduleNativeReminder(TIMER_REMINDER_ID, 'timer', title, body, Date.now() + remaining * 1000);
  }, [native, timerKey, state?.profile.notifyTimer, state?.profile.keepScreenOn]);

  const deadlineKey = useMemo(
    () => (state ? JSON.stringify((state.deadlines || []).map((item) => [item.id, item.title, item.dueAt, item.status, item.deletedAt, item.weight])) : ''),
    [state?.deadlines],
  );
  useEffect(() => {
    if (!native || !state) return;
    cancelNativeReminderGroup('deadline');
    if (state.profile.notifyDeadlines === false) return;
    for (const reminder of planDeadlineReminders(state)) {
      scheduleNativeReminder(reminderId(reminder.key), 'deadline', reminder.title, reminder.body, reminder.at);
    }
  }, [native, deadlineKey, state?.profile.notifyDeadlines]);
}
