import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { StudyNote } from '../types';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, PageHeader, Panel, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { MarkdownView } from '../components/Markdown';
import { formatDateTime } from '../lib/format';
import { downloadText, filenameSafe } from '../lib/files';
import { visibleLabels, visibleNotes } from '../lib/selectors';

function titleFromMarkdownFile(file: File, text: string): string {
  const heading = text.split(/\r?\n/).find((line) => line.trim().startsWith('# '));
  if (heading) return heading.replace(/^#\s+/, '').trim().slice(0, 80) || file.name.replace(/\.md$/i, '');
  return file.name.replace(/\.md$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported note';
}

function plainPreview(body: string): string {
  return body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function NoteEditor({ note, props, onClose }: { note?: StudyNote; props: PageProps; onClose: () => void }) {
  const { state, actions } = props;
  const labels = visibleLabels(state);
  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [labelId, setLabelId] = useState(note?.labelId || '');
  const [view, setView] = useState<'write' | 'split' | 'preview'>(note ? 'preview' : 'write');
  const dirty = !note || title !== note.title || body !== note.body || (labelId || '') !== (note.labelId || '');

  useEffect(() => {
    setTitle(note?.title || '');
    setBody(note?.body || '');
    setLabelId(note?.labelId || '');
  }, [note?.id]);

  const save = () => {
    if (note) {
      actions.updateNote(note.id, { title, body, labelId });
      actions.notify('Note saved', title.trim() || 'Untitled note', 'success');
    } else {
      if (!title.trim() && !body.trim()) return;
      actions.createNote(title, body, labelId);
      onClose();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="page">
      <div className="editorToolbar">
        <button className="ghostButton" onClick={() => (!dirty || !note || window.confirm('Discard unsaved changes?')) && onClose()}>
          <Icon name="chevronLeft" size={16} /> Notes
        </button>
        <div className="buttonRow">
          <Segmented value={view} onChange={setView} label="Editor view" items={[['write', 'Write'], ['split', 'Split'], ['preview', 'Preview']]} />
          {note && (
            <>
              <button className="iconButton" onClick={() => actions.updateNote(note.id, { pinned: !note.pinned, labelId: note.labelId })} aria-label={note.pinned ? 'Unpin' : 'Pin'} title={note.pinned ? 'Unpin' : 'Pin'}>
                <Icon name="pin" />
              </button>
              <button className="iconButton" onClick={() => downloadText(`${filenameSafe(title)}.md`, `# ${title.trim() || 'Untitled note'}\n\n${body}`)} aria-label="Export as Markdown" title="Export .md">
                <Icon name="download" />
              </button>
              <button className="iconButton" onClick={() => { actions.deleteNote(note.id); onClose(); }} aria-label="Archive note" title="Archive">
                <Icon name="archive" />
              </button>
            </>
          )}
          <button className="primaryButton" onClick={save} disabled={!dirty}>{note ? (dirty ? 'Save' : 'Saved') : 'Create note'}</button>
        </div>
      </div>
      <div className="noteEditorMeta">
        <input className="noteTitleInput" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled note" aria-label="Note title" />
        <div className="noteEditorInfo">
          <select className="input toolbarSelect" value={labelId} onChange={(event) => setLabelId(event.target.value)} aria-label="Label">
            <option value="">No label</option>
            {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
          </select>
          {note && <span className="muted smallText">Last edited {formatDateTime(note.updatedAt)}</span>}
          <span className="muted smallText">Markdown supported · Ctrl+S to save</span>
        </div>
      </div>
      <div className={`noteEditorBody view-${view}`}>
        {view !== 'preview' && (
          <textarea
            className="noteTextArea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={'# Heading\n\n- Key point\n- **Important term**\n\n> Quote or definition'}
            aria-label="Note body"
            autoFocus={!note}
          />
        )}
        {view !== 'write' && (
          <article className="notePreview">
            <MarkdownView body={body} />
          </article>
        )}
      </div>
    </div>
  );
}

export function NotesPage(props: PageProps) {
  const { state, actions, sub, navigate } = props;
  const labels = visibleLabels(state);
  const notes = visibleNotes(state);
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((note) => (!labelFilter || note.labelId === labelFilter) && (!q || `${note.title} ${note.body}`.toLowerCase().includes(q)));
  }, [labelFilter, notes, query]);

  if (sub) {
    const note = sub === 'new' ? undefined : notes.find((item) => item.id === sub);
    if (sub === 'new' || note) return <NoteEditor note={note} props={props} onClose={() => navigate('notes')} />;
  }

  const onMarkdownFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      const text = await file.text();
      actions.createNote(titleFromMarkdownFile(file, text), text, labelFilter);
    }
    event.target.value = '';
  };

  return (
    <div className="page">
      <PageHeader
        title="Notes"
        description={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        actions={
          <>
            <label className="secondaryButton fileButton">
              <Icon name="upload" size={16} /> Import .md
              <input type="file" accept=".md,text/markdown,text/plain" multiple onChange={onMarkdownFile} />
            </label>
            <button className="primaryButton" onClick={() => navigate('notes', 'new')}><Icon name="plus" size={16} /> New note</button>
          </>
        }
      />
      <div className="toolbar">
        <div className="searchField">
          <Icon name="search" size={16} />
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </div>
        <select className="input toolbarSelect" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)} aria-label="Filter by label">
          <option value="">All labels</option>
          {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <Panel>
          <EmptyState icon="notes" title={notes.length ? 'No notes match' : 'No notes yet'} action={!notes.length ? <button className="secondaryButton" onClick={() => navigate('notes', 'new')}>Write a note</button> : undefined}>
            {notes.length ? 'Try a different search or label.' : 'Summaries, formulae, essay plans — written in Markdown and searchable.'}
          </EmptyState>
        </Panel>
      ) : (
        <div className="noteGrid">
          {filtered.map((note) => {
            const label = note.labelId ? state.labels.find((item) => item.id === note.labelId) : undefined;
            return (
              <button type="button" className="noteCard" key={note.id} onClick={() => navigate('notes', note.id)}>
                <span className="noteCardTitle">
                  {note.pinned && <Icon name="pin" size={14} />}
                  <strong>{note.title}</strong>
                </span>
                <span className="noteCardBody">{plainPreview(note.body) || 'Empty note'}</span>
                <span className="noteCardFooter">
                  {label && <Badge color={label.color}>{label.name}</Badge>}
                  <span>{formatDateTime(note.updatedAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
