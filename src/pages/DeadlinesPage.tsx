import { useEffect, useMemo, useState } from 'react';
import type { Deadline, DeadlineKind, DeadlineStatus } from '../types';
import type { DeadlineDraft } from '../state/AppStore';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, Field, Modal, PageHeader, Panel, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { daysUntil, parseDateLoose, relativeDays, subjectName, subjectNoun, visibleDeadlines, visibleSubjects } from '../lib/selectors';

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  assignment: 'Assignment',
  coursework: 'Coursework',
  exam: 'Exam',
  presentation: 'Presentation',
  reading: 'Reading',
  other: 'Other',
};

const STATUS_LABELS: Record<DeadlineStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  submitted: 'Submitted',
};

type View = 'upcoming' | 'submitted' | 'all';

function formatDue(dueAt: string): string {
  const ms = parseDateLoose(dueAt);
  if (ms === null) return dueAt;
  const date = new Date(ms);
  const hasTime = dueAt.includes('T');
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function emptyDraft(subjectId = ''): DeadlineDraft {
  return { title: '', kind: 'assignment', subjectId, dueAt: '', weight: undefined, status: 'not-started', notes: '' };
}

function DeadlineDialog({
  initial,
  subjects,
  noun,
  onSave,
  onClose,
}: {
  initial: DeadlineDraft;
  subjects: ReturnType<typeof visibleSubjects>;
  noun: string;
  onSave: (draft: DeadlineDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [date, setDate] = useState(initial.dueAt.slice(0, 10));
  const [time, setTime] = useState(initial.dueAt.includes('T') ? initial.dueAt.slice(11, 16) : '');
  const set = (patch: Partial<DeadlineDraft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Modal title={initial.title ? 'Edit deadline' : 'Add a deadline'} onClose={onClose} width={520}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...draft, dueAt: date ? (time ? `${date}T${time}` : date) : '' });
        }}
      >
        <Field label="Title">
          <input className="input" value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Essay: causes of the First World War" />
        </Field>
        <div className="formGrid">
          <Field label="Type">
            <select className="input" value={draft.kind} onChange={(event) => set({ kind: event.target.value as DeadlineKind })}>
              {Object.entries(DEADLINE_KIND_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label={noun[0].toUpperCase() + noun.slice(1)}>
            <select className="input" value={draft.subjectId || ''} onChange={(event) => set({ subjectId: event.target.value })}>
              <option value="">General</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </Field>
          <Field label="Time" hint="Optional">
            <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </Field>
          <Field label="Weighting" hint="% of the final grade, optional">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={draft.weight ?? ''}
              onChange={(event) => set({ weight: event.target.value === '' ? undefined : Number(event.target.value) })}
            />
          </Field>
          <Field label="Status">
            <select className="input" value={draft.status} onChange={(event) => set({ status: event.target.value as DeadlineStatus })}>
              {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="input textArea" value={draft.notes || ''} onChange={(event) => set({ notes: event.target.value })} placeholder="Word count, submission portal, brief link…" />
        </Field>
        <div className="buttonRow end">
          <button type="button" className="ghostButton" onClick={onClose}>Cancel</button>
          <button className="primaryButton" disabled={!draft.title.trim() || !date}>Save deadline</button>
        </div>
      </form>
    </Modal>
  );
}

export function DeadlinesPage({ state, actions, sub, navigate }: PageProps) {
  const deadlines = visibleDeadlines(state);
  const subjects = visibleSubjects(state);
  const noun = subjectNoun(state.profile.educationLevel);
  const [view, setView] = useState<View>('upcoming');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [editing, setEditing] = useState<Deadline | 'new' | null>(null);

  useEffect(() => {
    if (sub === 'new') {
      setEditing('new');
      navigate('deadlines');
    }
  }, [sub]);

  const filtered = useMemo(() => deadlines.filter((deadline) => {
    if (subjectFilter && deadline.subjectId !== subjectFilter) return false;
    if (view === 'upcoming') return deadline.status !== 'submitted';
    if (view === 'submitted') return deadline.status === 'submitted';
    return true;
  }), [deadlines, subjectFilter, view]);

  const overdue = deadlines.filter((deadline) => deadline.status !== 'submitted' && (daysUntil(deadline.dueAt) ?? 0) < 0).length;
  const thisWeek = deadlines.filter((deadline) => {
    const days = daysUntil(deadline.dueAt);
    return deadline.status !== 'submitted' && days !== null && days >= 0 && days <= 7;
  }).length;

  return (
    <div className="page">
      <PageHeader
        title="Deadlines"
        description={`${thisWeek} due in the next 7 days${overdue ? ` · ${overdue} overdue` : ''}`}
        actions={<button className="primaryButton" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Add deadline</button>}
      />
      <div className="toolbar">
        <Segmented<View> value={view} onChange={setView} label="Show" items={[['upcoming', 'Upcoming'], ['submitted', 'Submitted'], ['all', 'All']]} />
        <select className="input toolbarSelect" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label={`Filter by ${noun}`}>
          <option value="">All {subjectNoun(state.profile.educationLevel, true)}</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </div>
      <Panel>
        {filtered.length === 0 ? (
          <EmptyState icon="deadline" title={view === 'submitted' ? 'Nothing submitted yet' : 'No upcoming deadlines'} action={<button className="secondaryButton" onClick={() => setEditing('new')}>Add a deadline</button>}>
            Track essays, problem sheets, coursework and exams with their weighting and status.
          </EmptyState>
        ) : (
          <div className="deadlineTable" role="table" aria-label="Deadlines">
            <div className="deadlineHead" role="row">
              <span role="columnheader">Deadline</span>
              <span role="columnheader">Due</span>
              <span role="columnheader">Weight</span>
              <span role="columnheader">Status</span>
              <span role="columnheader" className="srOnly">Actions</span>
            </div>
            {filtered.map((deadline) => {
              const days = daysUntil(deadline.dueAt);
              const late = deadline.status !== 'submitted' && days !== null && days < 0;
              return (
                <div className={deadline.status === 'submitted' ? 'deadlineRow deadlineRowDone' : 'deadlineRow'} role="row" key={deadline.id}>
                  <div className="deadlineTitle" role="cell">
                    <strong>{deadline.title}</strong>
                    <span>{DEADLINE_KIND_LABELS[deadline.kind]} · {subjectName(state, deadline.subjectId)}</span>
                    {deadline.notes && <span className="deadlineNotes">{deadline.notes}</span>}
                  </div>
                  <div role="cell" className="deadlineDue">
                    <span>{formatDue(deadline.dueAt)}</span>
                    {deadline.status !== 'submitted' && (
                      <Badge tone={late ? 'danger' : days !== null && days <= 3 ? 'warning' : 'neutral'}>
                        {late ? `${Math.abs(days!)}d overdue` : relativeDays(days)}
                      </Badge>
                    )}
                  </div>
                  <span role="cell" className="deadlineWeight">{deadline.weight != null ? `${deadline.weight}%` : '—'}</span>
                  <div role="cell">
                    <select
                      className={`input statusSelect status-${deadline.status}`}
                      value={deadline.status}
                      onChange={(event) => actions.updateDeadline(deadline.id, { status: event.target.value as DeadlineStatus })}
                      aria-label={`Status of ${deadline.title}`}
                    >
                      {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </div>
                  <div role="cell" className="rowActions">
                    <button type="button" className="iconButton small" onClick={() => setEditing(deadline)} aria-label="Edit deadline" title="Edit"><Icon name="edit" size={15} /></button>
                    <button type="button" className="iconButton small" onClick={() => actions.deleteDeadline(deadline.id)} aria-label="Archive deadline" title="Archive"><Icon name="archive" size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {editing && (
        <DeadlineDialog
          initial={editing === 'new' ? emptyDraft(subjectFilter) : { ...editing }}
          subjects={subjects}
          noun={noun}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing === 'new') actions.createDeadline(draft);
            else actions.updateDeadline(editing.id, draft);
            if (draft.title.trim() && draft.dueAt) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
