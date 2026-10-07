import { useMemo, useState } from 'react';
import type { AppActions } from '../state/AppStore';
import type { AppState, Label, StudySession } from '../types';
import type { Navigate } from '../navigation';
import { Icon } from './Icon';
import { EmptyState, Field, Segmented } from './ui';
import { addDaysMs, dateKey, startOfDayMs } from '../lib/dates';
import { compactHours, formatDateTime, formatDuration } from '../lib/format';
import { labelName, visibleLabels, visibleSessions } from '../lib/selectors';
import { studyByLabel, type Timeframe } from '../lib/stats';

export interface PageProps {
  state: AppState;
  actions: AppActions;
  navigate: Navigate;
  sub: string;
  syncConfigured: boolean;
  openAuth: (mode: 'signin' | 'signup') => void;
}


const METHOD_LABELS: Record<StudySession['method'], string> = {
  stopwatch: 'Stopwatch',
  timer: 'Countdown',
  pomodoro: 'Pomodoro',
  manual: 'Logged manually',
};

export function methodLabel(method: StudySession['method']): string {
  return METHOD_LABELS[method] || method;
}

export function SessionList({ sessions, state, actions, compact }: { sessions: StudySession[]; state: AppState; actions: AppActions; compact?: boolean }) {
  const labels = visibleLabels(state);
  const [editingId, setEditingId] = useState('');
  if (sessions.length === 0) {
    return <EmptyState icon="timer" title="No sessions yet">Run a focus session or log time manually and it will appear here.</EmptyState>;
  }
  return (
    <div className="sessionList">
      {sessions.map((session) => {
        if (editingId === session.id) {
          return <SessionEditor key={session.id} session={session} labels={labels} actions={actions} onClose={() => setEditingId('')} />;
        }
        const label = session.labelId ? state.labels.find((item) => item.id === session.labelId) : undefined;
        return (
          <article className="sessionRow" key={session.id}>
            <span className="sessionSwatch" style={{ background: label?.color || 'var(--line-strong)' }} />
            <div className="sessionMain">
              <strong>{labelName(state, session)}</strong>
              <span>
                {formatDateTime(session.endAt)}
                {!compact && ` · ${methodLabel(session.method)}`}
              </span>
              {session.note && <p>{session.note}</p>}
            </div>
            <span className="sessionDuration">{formatDuration(session.durationSec)}</span>
            {!compact && (
              <div className="rowActions">
                <button type="button" className="iconButton small" onClick={() => setEditingId(session.id)} aria-label="Edit session" title="Edit">
                  <Icon name="edit" size={15} />
                </button>
                <button type="button" className="iconButton small" onClick={() => actions.deleteSession(session.id)} aria-label="Archive session" title="Archive">
                  <Icon name="archive" size={15} />
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function SessionEditor({ session, labels, actions, onClose }: { session: StudySession; labels: Label[]; actions: AppActions; onClose: () => void }) {
  const [labelId, setLabelId] = useState(session.labelId || '');
  const [note, setNote] = useState(session.note || '');
  return (
    <form
      className="sessionEditor"
      onSubmit={(event) => {
        event.preventDefault();
        actions.updateSession(session.id, { labelId, note });
        onClose();
      }}
    >
      <div className="formGrid">
        <Field label="Label">
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="">No label</option>
            {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
          </select>
        </Field>
        <Field label="What did you work on?">
          <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Past paper, lecture notes, problem sheet…" />
        </Field>
      </div>
      <div className="buttonRow">
        <button className="primaryButton">Save</button>
        <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export function ActivityChart({ sessions, days, goalSec }: { sessions: StudySession[]; days: number; goalSec?: number }) {
  const start = startOfDayMs() - (days - 1) * 86400000;
  const totals = Array.from({ length: days }, (_, index) => {
    const ms = addDaysMs(start, index);
    const key = dateKey(ms);
    return {
      key,
      date: new Date(ms),
      sec: sessions.filter((session) => dateKey(session.endAt) === key).reduce((sum, session) => sum + session.durationSec, 0),
    };
  });
  const max = Math.max(...totals.map((item) => item.sec), goalSec || 0, 1);
  return (
    <div className="activityChart" role="img" aria-label={`Study time over the last ${days} days`}>
      <div className="activityBars">
        {goalSec ? <span className="activityGoal" style={{ bottom: `${(goalSec / max) * 100}%` }} title={`Daily goal ${formatDuration(goalSec)}`} /> : null}
        {totals.map((item) => (
          <div className="activityBar" key={item.key} title={`${item.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${formatDuration(item.sec)}`}>
            <span className={goalSec && item.sec >= goalSec ? 'metGoal' : ''} style={{ height: `${item.sec ? Math.max(4, (item.sec / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="activityAxis" aria-hidden="true">
        {totals.map((item, index) => (
          <small key={item.key}>
            {days <= 14
              ? item.date.toLocaleDateString(undefined, { weekday: 'narrow' })
              : index % 7 === 0 ? item.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}
          </small>
        ))}
      </div>
    </div>
  );
}

export function HourlyGraph({ sessions }: { sessions: StudySession[] }) {
  const values = new Array<number>(24).fill(0);
  for (const session of sessions) values[new Date(session.endAt).getHours()] += session.durationSec;
  const max = Math.max(...values, 1);
  return (
    <div className="miniBars" role="img" aria-label="Study time by hour of day">
      <div className="miniBarsPlot">
        {values.map((sec, hour) => (
          <div className="miniBarWrap" key={hour} title={`${String(hour).padStart(2, '0')}:00 · ${formatDuration(sec)}`}>
            <span className="miniBar" style={{ height: `${sec ? Math.max(4, (sec / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="miniBarsAxis" aria-hidden="true">
        {values.map((_, hour) => <small key={hour}>{hour % 6 === 0 ? `${String(hour).padStart(2, '0')}` : ''}</small>)}
      </div>
    </div>
  );
}

export function WeekdayGraph({ sessions }: { sessions: StudySession[] }) {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = new Array<number>(7).fill(0);
  for (const session of sessions) values[(new Date(session.endAt).getDay() + 6) % 7] += session.durationSec;
  const max = Math.max(...values, 1);
  return (
    <div className="weekdayList">
      {labels.map((label, index) => (
        <div className="breakdownRow" key={label}>
          <span>{label}</span>
          <div className="progressTrack"><span style={{ width: `${(values[index] / max) * 100}%` }} /></div>
          <strong>{compactHours(values[index])}</strong>
        </div>
      ))}
    </div>
  );
}

export function MethodGraph({ sessions }: { sessions: StudySession[] }) {
  const methods: Array<StudySession['method']> = ['pomodoro', 'timer', 'stopwatch', 'manual'];
  const values = methods.map((method) => sessions.filter((session) => session.method === method).reduce((sum, session) => sum + session.durationSec, 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return (
    <div className="weekdayList">
      {methods.map((method, index) => (
        <div className="breakdownRow" key={method}>
          <span>{methodLabel(method)}</span>
          <div className="progressTrack"><span style={{ width: `${(values[index] / total) * 100}%` }} /></div>
          <strong>{Math.round((values[index] / total) * 100)}%</strong>
        </div>
      ))}
    </div>
  );
}

export function LabelBreakdown({ state, initial = 'week' }: { state: AppState; initial?: Timeframe }) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initial);
  const sessions = useMemo(() => visibleSessions(state), [state]);
  const stats = useMemo(() => studyByLabel(sessions, state.labels, timeframe), [sessions, state.labels, timeframe]);
  const stops = useMemo(() => {
    let current = 0;
    return stats.items.map((item) => {
      const degrees = (item.duration / Math.max(1, stats.totalSec)) * 360;
      const stop = `${item.color} ${current}deg ${current + degrees}deg`;
      current += degrees;
      return stop;
    }).join(', ');
  }, [stats]);

  return (
    <div className="labelBreakdown">
      <Segmented<Timeframe>
        value={timeframe}
        onChange={setTimeframe}
        label="Time period"
        items={[['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All']]}
      />
      {stats.totalSec === 0 ? (
        <EmptyState title="Nothing logged in this period" />
      ) : (
        <div className="donutRow">
          <div className="donut" style={{ background: `conic-gradient(${stops})` }}>
            <span>
              <strong>{compactHours(stats.totalSec)}</strong>
              <small>total</small>
            </span>
          </div>
          <div className="legendList">
            {stats.items.slice(0, 7).map((item) => (
              <div className="legendRow" key={item.id}>
                <span className="legendDot" style={{ background: item.color }} />
                <span className="legendName">{item.name}</span>
                <span className="legendValue">{formatDuration(item.duration)}</span>
                <span className="legendPct">{Math.round((item.duration / stats.totalSec) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
