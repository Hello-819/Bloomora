import { useMemo, useState } from 'react';
import type { Assessment } from '../types';
import type { AssessmentDraft } from '../state/AppStore';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, Field, MetricCard, Modal, PageHeader, Panel, ProgressBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { assessmentPercent, classificationFor, weightCompleted, weightedAverage } from '../lib/grades';
import { dateKey } from '../lib/dates';
import { subjectName, subjectNoun, visibleAssessments, visibleSubjects } from '../lib/selectors';

function ResultDialog({ props, initial, onClose }: { props: PageProps; initial: Assessment | 'new'; onClose: () => void }) {
  const { state, actions } = props;
  const existing = initial === 'new' ? undefined : initial;
  const [draft, setDraft] = useState<AssessmentDraft>(() => existing
    ? { title: existing.title, subjectId: existing.subjectId, score: existing.score, maxScore: existing.maxScore, weight: existing.weight, date: existing.date, notes: existing.notes }
    : { title: '', subjectId: state.profile.aiTutor.activeSubjectId, score: 0, maxScore: 100, weight: undefined, date: dateKey(), notes: '' });
  const set = (patch: Partial<AssessmentDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const pct = assessmentPercent(draft);
  const noun = subjectNoun(state.profile.educationLevel);

  return (
    <Modal title={existing ? 'Edit result' : 'Record a result'} onClose={onClose} width={520}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (existing) actions.updateAssessment(existing.id, draft);
          else actions.createAssessment(draft);
          if (draft.title.trim() && draft.maxScore > 0) onClose();
        }}
      >
        <Field label="Assessment">
          <input className="input" value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Mock Paper 1, Essay 2, Midterm…" />
        </Field>
        <div className="formGrid">
          <Field label={noun[0].toUpperCase() + noun.slice(1)}>
            <select className="input" value={draft.subjectId || ''} onChange={(event) => set({ subjectId: event.target.value })}>
              <option value="">General</option>
              {visibleSubjects(state).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} />
          </Field>
          <Field label="Score">
            <input className="input" type="number" min={0} step="any" value={draft.score} onChange={(event) => set({ score: Number(event.target.value) })} />
          </Field>
          <Field label="Out of">
            <input className="input" type="number" min={1} step="any" value={draft.maxScore} onChange={(event) => set({ maxScore: Number(event.target.value) })} />
          </Field>
          <Field label="Weighting" hint={`% of the ${noun}, optional`}>
            <input className="input" type="number" min={0} max={100} step="any" value={draft.weight ?? ''} onChange={(event) => set({ weight: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </Field>
          <div className="field">
            <span className="fieldName">Percentage</span>
            <strong className="bigNumber">{pct.toFixed(1)}%</strong>
          </div>
        </div>
        <Field label="Feedback / notes">
          <textarea className="input textArea" value={draft.notes || ''} onChange={(event) => set({ notes: event.target.value })} placeholder="What to improve next time" />
        </Field>
        <div className="buttonRow end">
          <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
          <button className="primaryButton" disabled={!draft.title.trim() || !(draft.maxScore > 0)}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function GradesPage(props: PageProps) {
  const { state, actions } = props;
  const results = visibleAssessments(state);
  const subjects = visibleSubjects(state);
  const level = state.profile.educationLevel;
  const noun = subjectNoun(level);
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const [subjectFilter, setSubjectFilter] = useState('');

  const bySubject = useMemo(() => {
    const groups = [...subjects.map((subject) => ({ id: subject.id, name: subject.name, target: subject.targetGrade })), { id: '', name: 'General', target: '' }];
    return groups
      .map((group) => {
        const items = results.filter((item) => (item.subjectId || '') === group.id || (!group.id && item.subjectId && !subjects.some((subject) => subject.id === item.subjectId)));
        return { ...group, items, average: weightedAverage(items), completed: weightCompleted(items) };
      })
      .filter((group) => group.items.length > 0);
  }, [results, subjects]);

  const overall = useMemo(() => {
    const averages = bySubject.map((group) => group.average).filter((value): value is number => value !== null);
    return averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
  }, [bySubject]);
  const classification = overall === null ? null : classificationFor(level, overall);
  const best = results.reduce<Assessment | null>((top, item) => (!top || assessmentPercent(item) > assessmentPercent(top) ? item : top), null);
  const shown = subjectFilter ? results.filter((item) => (item.subjectId || '') === subjectFilter) : results;

  return (
    <div className="page">
      <PageHeader
        title="Grades"
        description={`Record marks to track weighted averages per ${noun}.`}
        actions={<button className="primaryButton" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Record result</button>}
      />
      <div className="metricGrid">
        <MetricCard icon="grades" title="Overall average" value={overall === null ? '—' : `${overall.toFixed(1)}%`} detail={`Mean of ${bySubject.length} ${subjectNoun(level, bySubject.length !== 1)}`} />
        <MetricCard icon="chart" title={classification ? 'On track for' : 'Results'} value={classification || String(results.length)} detail={classification ? 'Based on UK classification bands' : 'Recorded assessments'} />
        <MetricCard icon="check" title="Best result" value={best ? `${assessmentPercent(best).toFixed(0)}%` : '—'} detail={best ? best.title : 'No results yet'} />
      </div>

      {bySubject.length > 0 && (
        <div className="gradeSummaryGrid">
          {bySubject.map((group) => (
            <article className="panel gradeSummary" key={group.id || 'general'}>
              <div className="gradeSummaryHead">
                <strong>{group.name}</strong>
                {group.target && <Badge>Target {group.target}</Badge>}
              </div>
              <span className="bigNumber">{group.average === null ? '—' : `${group.average.toFixed(1)}%`}</span>
              <ProgressBar value={group.average ?? 0} max={100} tone={(group.average ?? 0) >= 70 ? 'success' : (group.average ?? 0) < 40 ? 'warning' : 'default'} />
              <span className="muted smallText">
                {group.items.length} {group.items.length === 1 ? 'result' : 'results'}
                {group.completed !== null && ` · ${group.completed.toFixed(0)}% of weighting assessed`}
                {classificationFor(level, group.average ?? 0) && group.average !== null && ` · ${classificationFor(level, group.average)}`}
              </span>
            </article>
          ))}
        </div>
      )}

      <Panel
        title="Results"
        action={
          <select className="input toolbarSelect" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label={`Filter by ${noun}`}>
            <option value="">All</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        }
      >
        {shown.length === 0 ? (
          <EmptyState icon="grades" title="No results recorded" action={<button className="secondaryButton" onClick={() => setEditing('new')}>Record a result</button>}>
            Add mock exams, essays and assignments with their marks and weighting.
          </EmptyState>
        ) : (
          <div className="resultTable">
            {shown.map((item) => {
              const pct = assessmentPercent(item);
              return (
                <div className="resultRow" key={item.id}>
                  <div className="resultMain">
                    <strong>{item.title}</strong>
                    <span>{subjectName(state, item.subjectId)}{item.date ? ` · ${new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}{item.weight != null ? ` · ${item.weight}% weighting` : ''}</span>
                    {item.notes && <span className="resultNotes">{item.notes}</span>}
                  </div>
                  <span className="resultScore">{item.score} / {item.maxScore}</span>
                  <Badge tone={pct >= 70 ? 'success' : pct < 40 ? 'danger' : 'neutral'}>{pct.toFixed(1)}%</Badge>
                  <div className="rowActions">
                    <button type="button" className="iconButton small" onClick={() => setEditing(item)} aria-label="Edit result" title="Edit"><Icon name="edit" size={15} /></button>
                    <button type="button" className="iconButton small" onClick={() => actions.deleteAssessment(item.id)} aria-label="Archive result" title="Archive"><Icon name="archive" size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {editing && <ResultDialog props={props} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
