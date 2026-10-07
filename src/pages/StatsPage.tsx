import { useMemo, useState } from 'react';
import type { PageProps } from '../components/study';
import { ActivityChart, HourlyGraph, LabelBreakdown, MethodGraph, SessionList, WeekdayGraph } from '../components/study';
import { MetricCard, PageHeader, Panel, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { activeDays, averagePerActiveDay, computeStreak, sessionsToCsv, studyTotals } from '../lib/stats';
import { formatDuration } from '../lib/format';
import { dateKey } from '../lib/dates';
import { downloadText } from '../lib/files';
import { labelName, visibleSessions } from '../lib/selectors';

export function StatsPage({ state, actions }: PageProps) {
  const sessions = useMemo(() => visibleSessions(state), [state]);
  const totals = useMemo(() => studyTotals(sessions), [sessions]);
  const consecutive = useMemo(() => computeStreak(sessions), [sessions]);
  const average = useMemo(() => averagePerActiveDay(sessions, 30), [sessions]);
  const days30 = useMemo(() => activeDays(sessions, 30), [sessions]);
  const [range, setRange] = useState<'14' | '28' | '90'>('28');
  const [logCount, setLogCount] = useState(15);

  const bestHour = useMemo(() => {
    const hours = new Array<number>(24).fill(0);
    for (const session of sessions) hours[new Date(session.endAt).getHours()] += session.durationSec;
    const best = hours.reduce((bestIndex, value, index) => (value > hours[bestIndex] ? index : bestIndex), 0);
    return hours[best] ? `${String(best).padStart(2, '0')}:00–${String((best + 1) % 24).padStart(2, '0')}:00` : '—';
  }, [sessions]);

  return (
    <div className="page">
      <PageHeader
        title="Insights"
        description="How, when and what you study."
        actions={
          <button
            className="secondaryButton"
            onClick={() => downloadText(`bloomora_sessions_${dateKey()}.csv`, sessionsToCsv(sessions, (session) => labelName(state, session)), 'text/csv')}
            disabled={!sessions.length}
          >
            <Icon name="download" size={16} /> Export CSV
          </button>
        }
      />
      <div className="metricGrid">
        <MetricCard icon="clock" title="Total study" value={formatDuration(totals.totalSec)} detail={`${totals.count} logged sessions`} />
        <MetricCard icon="calendar" title="This month" value={formatDuration(totals.monthSec)} detail={`${days30} active days in the last 30`} />
        <MetricCard icon="chart" title="Average day" value={formatDuration(average)} detail="Per active day, last 30 days" />
        <MetricCard icon="timer" title="Most productive" value={bestHour} detail={`Consecutive days: ${consecutive.current} (best ${consecutive.longest})`} />
      </div>
      <Panel
        title="Daily study time"
        description="The dashed line is your daily goal."
        action={<Segmented value={range} onChange={setRange} label="Range" items={[['14', '2 weeks'], ['28', '4 weeks'], ['90', '3 months']]} />}
      >
        <ActivityChart sessions={sessions} days={Number(range)} goalSec={state.profile.dailyGoalMinutes * 60} />
      </Panel>
      <div className="threeColumn">
        <Panel title="Time of day"><HourlyGraph sessions={sessions} /></Panel>
        <Panel title="Day of week"><WeekdayGraph sessions={sessions} /></Panel>
        <Panel title="Method"><MethodGraph sessions={sessions} /></Panel>
      </div>
      <div className="twoColumn even">
        <Panel title="Time by label"><LabelBreakdown state={state} initial="month" /></Panel>
        <Panel title="Session log" description={`${sessions.length} sessions`}>
          <SessionList sessions={sessions.slice(0, logCount)} state={state} actions={actions} />
          {sessions.length > logCount && (
            <button className="ghostButton fullWidth" onClick={() => setLogCount((count) => count + 25)}>Show more</button>
          )}
        </Panel>
      </div>
    </div>
  );
}
