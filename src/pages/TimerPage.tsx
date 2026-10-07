import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TimerMode } from '../types';
import type { PageProps } from '../components/study';
import { SessionList } from '../components/study';
import { Field, PageHeader, Panel, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { useNow } from '../lib/hooks';
import { elapsedForTimer, remainingForTimer } from '../lib/timers';
import { formatClock, formatDuration } from '../lib/format';
import { dateKey } from '../lib/dates';
import { visibleLabels, visibleSessions, visibleTasks } from '../lib/selectors';
import { studyTotals } from '../lib/stats';

function ProgressRing({ pct, children }: { pct: number; children: ReactNode }) {
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ring">
      <svg viewBox="0 0 260 260" aria-hidden="true">
        <circle cx="130" cy="130" r={radius} className="ringTrack" />
        <circle
          cx="130"
          cy="130"
          r={radius}
          className="ringValue"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, pct)))}
        />
      </svg>
      <div className="ringContent">{children}</div>
    </div>
  );
}

export function TimerPage({ state, actions }: PageProps) {
  const labels = visibleLabels(state);
  const tasks = visibleTasks(state).filter((task) => !task.done);
  const [mode, setMode] = useState<TimerMode>('pomodoro');
  const [labelId, setLabelId] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [countdownMin, setCountdownMin] = useState(45);
  const [note, setNote] = useState('');
  const [manualMinutes, setManualMinutes] = useState(30);
  const [manualDate, setManualDate] = useState(dateKey());
  const [manualNote, setManualNote] = useState('');
  const timer = state.activeTimer;
  const now = useNow(Boolean(timer?.running));
  const elapsed = timer ? elapsedForTimer(timer, now) : 0;
  const remaining = timer ? remainingForTimer(timer, now) : null;
  const sessions = useMemo(() => visibleSessions(state), [state]);
  const todaySessions = sessions.filter((session) => dateKey(session.endAt) === dateKey());
  const totals = studyTotals(sessions);

  useEffect(() => {
    if (timer) {
      setLabelId(timer.labeling.labelId || '');
      setSelectedTasks(timer.labeling.taskIds || []);
      setMode(timer.mode);
    }
  }, [timer?.id]);

  useEffect(() => {
    if (!timer?.running || !timer.totalSec || remaining === null || remaining > 0) return;
    if (timer.mode === 'pomodoro') actions.completePomodoroPhase();
    else actions.pauseTimer();
  }, [actions, remaining, timer?.id, timer?.mode, timer?.running, timer?.totalSec]);

  const labeling = { labelId: labelId || undefined, taskIds: selectedTasks };

  const start = () => {
    if (timer) return;
    if (state.profile.timerRequireLabel && !labelId) {
      actions.notify('Choose a label first', 'Your settings require a label for every session.', 'warning');
      return;
    }
    if (mode === 'stopwatch') {
      actions.startTimer({ mode, labeling });
      return;
    }
    if (mode === 'countdown') {
      actions.startTimer({ mode, totalSec: Math.max(1, countdownMin) * 60, labeling });
      return;
    }
    const settings = state.profile.pomodoro;
    actions.startTimer({
      mode,
      totalSec: settings.focusMin * 60,
      pomodoro: { phase: 'focus', round: 1, ...settings },
      labeling,
    });
  };

  const save = () => {
    if (actions.saveActiveTimer(note)) {
      setNote('');
      setSelectedTasks([]);
    }
  };

  const logManual = () => {
    const today = dateKey();
    const endedAt = manualDate === today ? new Date() : new Date(`${manualDate}T18:00:00`);
    const ok = actions.addSession({
      durationSec: manualMinutes * 60,
      method: 'manual',
      labelId: labelId || undefined,
      taskIds: selectedTasks,
      note: manualNote,
      endedAt: endedAt.toISOString(),
    });
    if (ok) {
      setManualNote('');
      setSelectedTasks([]);
    }
  };

  const plannedSec = mode === 'countdown' ? countdownMin * 60 : mode === 'pomodoro' ? state.profile.pomodoro.focusMin * 60 : 0;
  const displaySec = timer ? (timer.totalSec ? remaining ?? 0 : elapsed) : plannedSec;
  const pct = timer?.totalSec ? 1 - (remaining ?? 0) / timer.totalSec : timer ? (elapsed % 3600) / 3600 : 0;
  const isBreak = timer?.pomodoro?.phase === 'break';
  const phaseLabel = timer
    ? timer.mode === 'pomodoro' && timer.pomodoro
      ? `${isBreak ? 'Break' : 'Focus'} · round ${timer.pomodoro.round}`
      : timer.mode === 'countdown' ? 'Countdown' : 'Stopwatch'
    : 'Ready';
  const activeLabel = labels.find((label) => label.id === labelId);

  return (
    <div className="page">
      <PageHeader title="Focus" description="Time a study block, then log what you did." />
      <div className="focusLayout">
        <section className={isBreak ? 'panel focusStage focusStageBreak' : 'panel focusStage'}>
          <Segmented<TimerMode>
            value={mode}
            onChange={setMode}
            label="Timer mode"
            items={[['pomodoro', 'Pomodoro'], ['countdown', 'Countdown'], ['stopwatch', 'Stopwatch']]}
            disabled={Boolean(timer)}
          />
          <ProgressRing pct={pct}>
            <span className="ringPhase">{phaseLabel}</span>
            <span className="ringClock">{formatClock(displaySec)}</span>
            <span className="ringMeta">
              {timer
                ? `${timer.running ? 'Running' : remaining === 0 ? 'Finished' : 'Paused'} · ${formatDuration(elapsed)} so far`
                : activeLabel ? activeLabel.name : 'No label selected'}
            </span>
          </ProgressRing>
          {timer ? (
            <>
              <input
                className="input focusNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What are you working on? (saved with the session)"
                aria-label="Session note"
              />
              <div className="buttonRow center">
                {timer.running ? (
                  <button className="secondaryButton" onClick={() => actions.pauseTimer()}><Icon name="pause" size={16} /> Pause</button>
                ) : (
                  <button className="secondaryButton" onClick={() => actions.resumeTimer()} disabled={remaining === 0}><Icon name="play" size={16} /> Resume</button>
                )}
                <button className="primaryButton" onClick={save} disabled={isBreak}><Icon name="check" size={16} /> Finish &amp; log</button>
                <button className="ghostButton" onClick={() => window.confirm('Discard this session without logging it?') && actions.resetTimer()}>Discard</button>
              </div>
            </>
          ) : (
            <>
              {mode === 'countdown' && (
                <div className="presetRow">
                  {[25, 45, 60, 90].map((minutes) => (
                    <button key={minutes} type="button" className={countdownMin === minutes ? 'chip chipActive' : 'chip'} onClick={() => setCountdownMin(minutes)}>{minutes} min</button>
                  ))}
                  <input
                    className="input compactInput"
                    type="number"
                    min={1}
                    max={240}
                    value={countdownMin}
                    onChange={(event) => setCountdownMin(Math.min(240, Math.max(1, Number(event.target.value) || 1)))}
                    aria-label="Countdown minutes"
                  />
                </div>
              )}
              {mode === 'pomodoro' && (
                <p className="muted smallText">
                  {state.profile.pomodoro.focusMin} min focus · {state.profile.pomodoro.shortBreakMin} min break · long break every {state.profile.pomodoro.longEvery} rounds. Focus rounds log automatically.
                </p>
              )}
              <button className="primaryButton largeButton" onClick={start}><Icon name="play" size={18} /> Start</button>
            </>
          )}
        </section>

        <div className="focusSide">
          <Panel title="Session details">
            <Field label="Label" hint={state.profile.timerRequireLabel ? 'Required by your settings' : undefined}>
              <select
                className="input"
                value={labelId}
                onChange={(event) => {
                  setLabelId(event.target.value);
                  if (timer) actions.updateActiveTimerLabel(event.target.value || undefined);
                }}
              >
                <option value="">No label</option>
                {labels.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}
              </select>
            </Field>
            <div className="field">
              <span className="fieldName">Link tasks</span>
              {tasks.length === 0 ? (
                <p className="muted smallText">No open tasks.</p>
              ) : (
                <div className="checkList">
                  {tasks.slice(0, 6).map((task) => (
                    <label key={task.id} className="checkRow">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selectedTasks.includes(task.id)}
                        disabled={Boolean(timer)}
                        onChange={(event) => setSelectedTasks(event.target.checked ? [...selectedTasks, task.id] : selectedTasks.filter((id) => id !== task.id))}
                      />
                      <span>{task.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Log time manually" description="For study you did away from the timer.">
            <div className="formGrid">
              <Field label="Minutes">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={720}
                  value={manualMinutes}
                  onChange={(event) => setManualMinutes(Math.max(1, Number(event.target.value) || 1))}
                  aria-label="Manual session minutes"
                />
              </Field>
              <Field label="Date">
                <input className="input" type="date" max={dateKey()} value={manualDate} onChange={(event) => setManualDate(event.target.value || dateKey())} />
              </Field>
            </div>
            <Field label="Note">
              <input className="input" value={manualNote} onChange={(event) => setManualNote(event.target.value)} placeholder="Library session, seminar reading…" />
            </Field>
            <button className="secondaryButton" onClick={logManual}><Icon name="plus" size={16} /> Log session</button>
          </Panel>

          <Panel title="Today" description={`${formatDuration(totals.todaySec)} across ${todaySessions.length} ${todaySessions.length === 1 ? 'session' : 'sessions'}`}>
            <SessionList sessions={todaySessions.slice(0, 4)} state={state} actions={actions} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}
