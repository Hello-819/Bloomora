import { useMemo } from 'react';
import type { PageProps } from '../components/study';
import { ActivityChart, LabelBreakdown, SessionList } from '../components/study';
import { Badge, EmptyState, MetricCard, PageHeader, Panel, ProgressBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { activeDays, studyTotals } from '../lib/stats';
import { formatDuration } from '../lib/format';
import { deckSummary } from '../lib/srs';
import {
  daysUntil,
  educationLabel,
  parseDateLoose,
  relativeDays,
  subjectName,
  visibleDeadlines,
  visibleFlashcards,
  visibleSessions,
  visibleSubjects,
  visibleTasks,
} from '../lib/selectors';
import { DEADLINE_KIND_LABELS } from './DeadlinesPage';
import { WEEKDAYS, sortTimes } from './TimetablePage';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface UpNextItem {
  id: string;
  title: string;
  detail: string;
  days: number | null;
  kind: 'deadline' | 'task';
}

export function DashboardPage({ state, actions, navigate }: PageProps) {
  const sessions = useMemo(() => visibleSessions(state), [state]);
  const totals = useMemo(() => studyTotals(sessions), [sessions]);
  const days7 = useMemo(() => activeDays(sessions, 7), [sessions]);
  const deck = useMemo(() => deckSummary(visibleFlashcards(state)), [state]);
  const dailyGoal = Math.max(60, state.profile.dailyGoalMinutes * 60);
  const weeklyGoal = Math.max(1, state.profile.weeklyGoalHours * 3600);
  const now = new Date();
  const firstName = state.profile.displayName.trim().split(/\s+/)[0] || 'there';
  const profileLine = [state.profile.course, state.profile.yearOfStudy, state.profile.institution].filter(Boolean).join(' · ')
    || educationLabel(state.profile.educationLevel);

  const upNext = useMemo<UpNextItem[]>(() => {
    const items: UpNextItem[] = [];
    for (const deadline of visibleDeadlines(state)) {
      if (deadline.status === 'submitted') continue;
      const days = daysUntil(deadline.dueAt);
      if (days !== null && days > 21) continue;
      items.push({
        id: deadline.id,
        title: deadline.title,
        detail: `${DEADLINE_KIND_LABELS[deadline.kind]} · ${subjectName(state, deadline.subjectId)}${deadline.weight ? ` · ${deadline.weight}%` : ''}`,
        days,
        kind: 'deadline',
      });
    }
    for (const task of visibleTasks(state)) {
      if (task.done || !task.dueDate) continue;
      const days = daysUntil(task.dueDate);
      if (days !== null && days > 7) continue;
      items.push({ id: task.id, title: task.text, detail: task.priority === 'high' ? 'Task · high priority' : 'Task', days, kind: 'task' });
    }
    return items.sort((a, b) => (a.days ?? 999) - (b.days ?? 999)).slice(0, 7);
  }, [state]);

  const exams = useMemo(() => visibleSubjects(state)
    .map((subject) => ({ subject, ms: parseDateLoose(subject.examDate), days: daysUntil(subject.examDate) }))
    .filter((item) => item.ms !== null && (item.days ?? -1) >= 0)
    .sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0))
    .slice(0, 4), [state]);

  const today = WEEKDAYS[(now.getDay() + 6) % 7];
  const todaysClasses = useMemo(
    () => sortTimes((state.timetable?.entries || []).filter((entry) => entry.day === today)),
    [state.timetable, today],
  );
  const openTasks = visibleTasks(state).filter((task) => !task.done);

  return (
    <div className="page">
      <PageHeader
        title={`${greeting(now.getHours())}, ${firstName}`}
        description={`${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${profileLine}`}
        actions={
          <>
            <button className="secondaryButton" onClick={() => navigate('plan', 'new')}><Icon name="plus" size={16} /> Task</button>
            <button className="primaryButton" onClick={() => navigate('timer')}><Icon name="timer" size={16} /> Start focus</button>
          </>
        }
      />

      <div className="metricGrid">
        <MetricCard
          icon="clock"
          title="Today"
          value={formatDuration(totals.todaySec)}
          detail={<><ProgressBar value={totals.todaySec} max={dailyGoal} tone={totals.todaySec >= dailyGoal ? 'success' : 'default'} /><span>{Math.min(100, Math.round((totals.todaySec / dailyGoal) * 100))}% of {formatDuration(dailyGoal)} goal</span></>}
        />
        <MetricCard
          icon="calendar"
          title="This week"
          value={formatDuration(totals.weekSec)}
          detail={<><ProgressBar value={totals.weekSec} max={weeklyGoal} tone={totals.weekSec >= weeklyGoal ? 'success' : 'default'} /><span>{Math.min(100, Math.round((totals.weekSec / weeklyGoal) * 100))}% of {state.profile.weeklyGoalHours}h goal</span></>}
        />
        <MetricCard icon="chart" title="Active days" value={`${days7} / 7`} detail="Days with study in the last week" />
        <MetricCard
          icon="cards"
          title="Cards to review"
          value={String(deck.due + deck.fresh)}
          detail={deck.total ? `${deck.due} due · ${deck.fresh} new` : 'No flashcards yet'}
        />
      </div>

      <div className="dashboardGrid">
        <div className="dashboardMain">
          <Panel
            title="Up next"
            description="Deadlines in the next three weeks and tasks due this week"
            action={<button className="textButton" onClick={() => navigate('deadlines')}>All deadlines</button>}
          >
            {upNext.length === 0 ? (
              <EmptyState icon="deadline" title="Nothing due soon" action={<button className="secondaryButton" onClick={() => navigate('deadlines', 'new')}>Add a deadline</button>}>
                Add assignments, coursework and exams to see them here.
              </EmptyState>
            ) : (
              <div className="upNextList">
                {upNext.map((item) => (
                  <button type="button" className="upNextRow" key={`${item.kind}-${item.id}`} onClick={() => navigate(item.kind === 'deadline' ? 'deadlines' : 'plan')}>
                    <Icon name={item.kind === 'deadline' ? 'deadline' : 'tasks'} size={16} />
                    <span className="upNextMain">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                    <Badge tone={item.days !== null && item.days < 0 ? 'danger' : item.days !== null && item.days <= 2 ? 'warning' : 'neutral'}>
                      {item.days !== null && item.days < 0 ? `Overdue ${Math.abs(item.days)}d` : relativeDays(item.days)}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Last 14 days" action={<button className="textButton" onClick={() => navigate('stats')}>Insights</button>}>
            <ActivityChart sessions={sessions} days={14} goalSec={dailyGoal} />
          </Panel>

          <Panel title="Recent sessions" action={<button className="textButton" onClick={() => navigate('stats')}>View all</button>}>
            <SessionList sessions={sessions.slice(0, 5)} state={state} actions={actions} compact />
          </Panel>
        </div>

        <div className="dashboardSide">
          <Panel title={`Today · ${today}`} action={<button className="textButton" onClick={() => navigate('timetable')}>Timetable</button>}>
            {todaysClasses.length === 0 ? (
              <p className="muted smallText">No classes on your timetable today.</p>
            ) : (
              <div className="agendaList">
                {todaysClasses.map((entry) => (
                  <div className="agendaRow" key={entry.id}>
                    <span className="agendaTime">{entry.timeHr}</span>
                    <span>{entry.module}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Exams" action={<button className="textButton" onClick={() => navigate('subjects')}>Subjects</button>}>
            {exams.length === 0 ? (
              <p className="muted smallText">Add exam dates to your subjects to see a countdown.</p>
            ) : (
              <div className="examList">
                {exams.map(({ subject, days }) => (
                  <div className="examRow" key={subject.id}>
                    <div>
                      <strong>{subject.name}</strong>
                      <span>{[subject.qualification, subject.examBoard].filter(Boolean).join(' · ') || subject.examDate}</span>
                    </div>
                    <span className={days !== null && days <= 30 ? 'examDays examDaysSoon' : 'examDays'}>
                      <strong>{days}</strong>
                      <small>{days === 1 ? 'day' : 'days'}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Open tasks" action={<button className="textButton" onClick={() => navigate('plan')}>Tasks</button>}>
            {openTasks.length === 0 ? (
              <p className="muted smallText">No open tasks.</p>
            ) : (
              <div className="miniTaskList">
                {openTasks.slice(0, 5).map((task) => (
                  <label className="miniTask" key={task.id}>
                    <input type="checkbox" className="checkbox" checked={task.done} onChange={(event) => actions.toggleTask(task.id, event.target.checked)} />
                    <span>{task.text}</span>
                    {task.priority === 'high' && <Badge tone="danger">High</Badge>}
                  </label>
                ))}
                {openTasks.length > 5 && <button className="textButton" onClick={() => navigate('plan')}>+{openTasks.length - 5} more</button>}
              </div>
            )}
          </Panel>

          <Panel title="Time by label">
            <LabelBreakdown state={state} initial="week" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
