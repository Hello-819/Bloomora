import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudyTask, TaskPriority } from '../types';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, Field, PageHeader, Panel, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { daysUntil, relativeDays, visibleLabels, visibleTasks } from '../lib/selectors';
import type { AppActions } from '../state/AppStore';
import type { AppState } from '../types';

const LABEL_COLORS = ['#4f46e5', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#475569'];
type Filter = 'open' | 'today' | 'done' | 'all';

const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;

function bucketFor(task: StudyTask): string {
  if (task.done) return 'Completed';
  const days = daysUntil(task.dueDate);
  if (days === null) return 'No due date';
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  if (days <= 7) return 'Next 7 days';
  return 'Later';
}

const BUCKET_ORDER = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No due date', 'Completed'];

function TaskRow({ task, state, actions }: { task: StudyTask; state: AppState; actions: AppActions }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.text);
  const [notes, setNotes] = useState(task.notes || '');
  const [dueDate, setDueDate] = useState(task.dueDate || '');
  const [priority, setPriority] = useState<TaskPriority | ''>(task.priority || '');
  const [labelId, setLabelId] = useState(task.labelId || '');
  const label = task.labelId ? state.labels.find((item) => item.id === task.labelId) : undefined;
  const days = daysUntil(task.dueDate);

  if (editing) {
    return (
      <form
        className="taskRow taskRowEditing"
        onSubmit={(event) => {
          event.preventDefault();
          actions.updateTask(task.id, { text, notes, dueDate, priority: priority || undefined, labelId });
          setEditing(false);
        }}
      >
        <input className="input" value={text} onChange={(event) => setText(event.target.value)} aria-label="Task" autoFocus />
        <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" aria-label="Notes" />
        <div className="formGrid three">
          <input className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
          <select className="input" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label="Priority">
            <option value="">No priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)} aria-label="Label">
            <option value="">No label</option>
            {visibleLabels(state).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="buttonRow">
          <button className="primaryButton">Save</button>
          <button type="button" className="ghostButton" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <article className={task.done ? 'taskRow taskRowDone' : 'taskRow'}>
      <input type="checkbox" className="checkbox" checked={task.done} onChange={(event) => actions.toggleTask(task.id, event.target.checked)} aria-label={`Mark ${task.text} ${task.done ? 'not done' : 'done'}`} />
      <div className="taskMain">
        <span className="taskText">{task.text}</span>
        {task.notes && <span className="taskNotes">{task.notes}</span>}
        <div className="taskMeta">
          {task.dueDate && (
            <Badge tone={!task.done && days !== null && days < 0 ? 'danger' : !task.done && days === 0 ? 'warning' : 'neutral'}>
              <Icon name="calendar" size={12} /> {relativeDays(days)}
            </Badge>
          )}
          {task.priority && <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority[0].toUpperCase() + task.priority.slice(1)}</Badge>}
          {label && <Badge color={label.color}>{label.name}</Badge>}
        </div>
      </div>
      <div className="rowActions">
        <button type="button" className="iconButton small" onClick={() => setEditing(true)} aria-label="Edit task" title="Edit"><Icon name="edit" size={15} /></button>
        <button type="button" className="iconButton small" onClick={() => actions.deleteTask(task.id)} aria-label="Archive task" title="Archive"><Icon name="archive" size={15} /></button>
      </div>
    </article>
  );
}

export function PlanPage({ state, actions, sub }: PageProps) {
  const labels = visibleLabels(state);
  const tasks = visibleTasks(state);
  const [filter, setFilter] = useState<Filter>('open');
  const [labelFilter, setLabelFilter] = useState('');
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [taskLabel, setTaskLabel] = useState('');
  const [labelNameInput, setLabelNameInput] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sub === 'new') inputRef.current?.focus();
  }, [sub]);

  const filtered = useMemo(() => tasks.filter((task) => {
    if (labelFilter && task.labelId !== labelFilter) return false;
    if (filter === 'open') return !task.done;
    if (filter === 'done') return task.done;
    if (filter === 'today') {
      const days = daysUntil(task.dueDate);
      return !task.done && days !== null && days <= 0;
    }
    return true;
  }), [filter, labelFilter, tasks]);

  const groups = useMemo(() => {
    const map = new Map<string, StudyTask[]>();
    for (const task of filtered) {
      const bucket = bucketFor(task);
      map.set(bucket, [...(map.get(bucket) || []), task]);
    }
    return BUCKET_ORDER.filter((bucket) => map.has(bucket)).map((bucket) => [bucket, map.get(bucket)!] as const);
  }, [filtered]);

  const openCount = tasks.filter((task) => !task.done).length;
  const doneCount = tasks.length - openCount;

  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        description={`${openCount} open · ${doneCount} completed`}
        actions={doneCount > 0 ? <button className="ghostButton" onClick={() => actions.clearDoneTasks()}>Archive completed</button> : undefined}
      />
      <div className="twoColumn">
        <div className="stack">
          <Panel>
            <form
              className="taskComposer"
              onSubmit={(event) => {
                event.preventDefault();
                actions.addTask(text, notes, taskLabel, { dueDate: dueDate || undefined, priority: priority || undefined });
                setText('');
                setNotes('');
                setDueDate('');
                setPriority('');
              }}
            >
              <input ref={inputRef} className="input taskComposerInput" value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a task, e.g. Finish problem sheet 4" aria-label="Task" />
              <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" aria-label="Task notes" />
              <div className="taskComposerRow">
                <input className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Due date" />
                <select className="input" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label="Priority">
                  <option value="">Priority</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select className="input" value={taskLabel} onChange={(event) => setTaskLabel(event.target.value)} aria-label="Label">
                  <option value="">No label</option>
                  {labels.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}
                </select>
                <button className="primaryButton" disabled={!text.trim()}><Icon name="plus" size={16} /> Add task</button>
              </div>
            </form>
          </Panel>

          <div className="toolbar">
            <Segmented<Filter> value={filter} onChange={setFilter} label="Filter tasks" items={[['open', 'Open'], ['today', 'Due & overdue'], ['done', 'Completed'], ['all', 'All']]} />
            <select className="input toolbarSelect" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)} aria-label="Filter by label">
              <option value="">All labels</option>
              {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select>
          </div>

          {groups.length === 0 ? (
            <Panel><EmptyState icon="tasks" title={filter === 'done' ? 'No completed tasks' : 'You are all caught up'}>Tasks you add appear here, grouped by when they are due.</EmptyState></Panel>
          ) : (
            groups.map(([bucket, items]) => (
              <Panel key={bucket} title={bucket} action={<span className="countPill">{items.length}</span>} className={bucket === 'Overdue' ? 'panelDanger' : undefined}>
                <div className="taskList">
                  {items.map((task) => <TaskRow key={task.id} task={task} state={state} actions={actions} />)}
                </div>
              </Panel>
            ))
          )}
        </div>

        <Panel title="Labels" description="Labels tag tasks and focus sessions so Insights can break down your time.">
          <form
            className="labelComposer"
            onSubmit={(event) => {
              event.preventDefault();
              actions.createLabel(labelNameInput, color);
              setLabelNameInput('');
            }}
          >
            <input className="input" value={labelNameInput} onChange={(event) => setLabelNameInput(event.target.value)} placeholder="Label name" aria-label="Label name" />
            <div className="colorRow" role="radiogroup" aria-label="Label colour">
              {LABEL_COLORS.map((item) => (
                <button
                  type="button"
                  key={item}
                  role="radio"
                  aria-checked={color === item}
                  aria-label={`Colour ${item}`}
                  className={color === item ? 'colorDot colorDotActive' : 'colorDot'}
                  style={{ background: item }}
                  onClick={() => setColor(item)}
                />
              ))}
            </div>
            <button className="secondaryButton">Create label</button>
          </form>
          <div className="labelList">
            {labels.map((label) => (
              <div className="labelRow" key={label.id}>
                <span className="legendDot" style={{ background: label.color }} />
                <strong>{label.name}</strong>
                <button type="button" className={label.favorite ? 'iconButton small iconButtonActive' : 'iconButton small'} onClick={() => actions.toggleLabelFavorite(label.id)} aria-label={label.favorite ? 'Unpin label' : 'Pin label to top'} title={label.favorite ? 'Pinned' : 'Pin to top'}>
                  <Icon name="pin" size={14} />
                </button>
                <button type="button" className="iconButton small" onClick={() => actions.deleteLabel(label.id)} aria-label={`Archive ${label.name}`} title="Archive"><Icon name="archive" size={14} /></button>
              </div>
            ))}
            {labels.length === 0 && <p className="muted smallText">No labels yet. Try one per subject or module.</p>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
