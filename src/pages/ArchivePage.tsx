import { useMemo, useState } from 'react';
import type { ArchiveKind } from '../state/AppStore';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, PageHeader, Panel } from '../components/ui';
import { formatDateTime, formatDuration } from '../lib/format';
import { labelName } from '../lib/selectors';

const KIND_LABELS: Record<ArchiveKind, string> = {
  note: 'Note',
  session: 'Session',
  flashcard: 'Flashcard',
  task: 'Task',
  label: 'Label',
  subject: 'Subject',
  deadline: 'Deadline',
  assessment: 'Result',
};

export function ArchivePage({ state, actions }: PageProps) {
  const [kind, setKind] = useState<ArchiveKind | ''>('');
  const archived = useMemo(() => [
    ...state.notes.filter((item) => item.deletedAt).map((item) => ({ kind: 'note' as const, id: item.id, title: item.title, detail: item.body.slice(0, 160), updatedAt: item.updatedAt })),
    ...state.sessions.filter((item) => item.deletedAt).map((item) => ({
      kind: 'session' as const,
      id: item.id,
      title: `${formatDuration(item.durationSec)} · ${labelName(state, item)}`,
      detail: `${formatDateTime(item.endAt)}${item.note ? ` · ${item.note}` : ''}`,
      updatedAt: item.updatedAt,
    })),
    ...state.flashcards.filter((item) => item.deletedAt).map((item) => ({ kind: 'flashcard' as const, id: item.id, title: item.front, detail: item.back, updatedAt: item.updatedAt })),
    ...state.tasks.filter((item) => item.deletedAt).map((item) => ({ kind: 'task' as const, id: item.id, title: item.text, detail: item.notes || '', updatedAt: item.updatedAt })),
    ...state.labels.filter((item) => item.deletedAt).map((item) => ({ kind: 'label' as const, id: item.id, title: item.name, detail: '', updatedAt: item.updatedAt })),
    ...state.subjects.filter((item) => item.deletedAt).map((item) => ({
      kind: 'subject' as const,
      id: item.id,
      title: item.name,
      detail: [item.qualification, item.examBoard, item.targetGrade].filter(Boolean).join(' · '),
      updatedAt: item.updatedAt,
    })),
    ...(state.deadlines || []).filter((item) => item.deletedAt).map((item) => ({ kind: 'deadline' as const, id: item.id, title: item.title, detail: `Due ${item.dueAt.replace('T', ' ')}`, updatedAt: item.updatedAt })),
    ...(state.assessments || []).filter((item) => item.deletedAt).map((item) => ({ kind: 'assessment' as const, id: item.id, title: item.title, detail: `${item.score} / ${item.maxScore}`, updatedAt: item.updatedAt })),
  ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [state]);

  const counts = archived.reduce<Partial<Record<ArchiveKind, number>>>((map, item) => ({ ...map, [item.kind]: (map[item.kind] || 0) + 1 }), {});
  const shown = kind ? archived.filter((item) => item.kind === kind) : archived;

  return (
    <div className="page">
      <PageHeader title="Archive" description="Archived items are hidden everywhere else. Restore them, or delete them permanently." />
      {archived.length > 0 && (
        <div className="chipRow">
          <button type="button" className={kind === '' ? 'chip chipActive' : 'chip'} onClick={() => setKind('')}>All ({archived.length})</button>
          {(Object.keys(KIND_LABELS) as ArchiveKind[]).filter((key) => counts[key]).map((key) => (
            <button type="button" key={key} className={kind === key ? 'chip chipActive' : 'chip'} onClick={() => setKind(key)}>
              {KIND_LABELS[key]}s ({counts[key]})
            </button>
          ))}
        </div>
      )}
      <Panel>
        {shown.length === 0 ? (
          <EmptyState icon="archive" title="The archive is empty">Anything you archive shows up here.</EmptyState>
        ) : (
          <div className="archiveList">
            {shown.map((item) => (
              <article className="archiveRow" key={`${item.kind}-${item.id}`}>
                <Badge>{KIND_LABELS[item.kind]}</Badge>
                <div className="archiveMain">
                  <strong>{item.title}</strong>
                  {item.detail && <span>{item.detail}</span>}
                </div>
                <span className="muted smallText archiveDate">{formatDateTime(item.updatedAt)}</span>
                <div className="buttonRow">
                  <button className="secondaryButton small" onClick={() => actions.restoreArchived(item.kind, item.id)}>Restore</button>
                  <button className="dangerButton small" onClick={() => void actions.permanentlyDeleteArchived(item.kind, item.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
