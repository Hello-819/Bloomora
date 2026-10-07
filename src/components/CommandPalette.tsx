import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppActions } from '../state/AppStore';
import type { AppState } from '../types';
import { ALL_NAV, type Navigate } from '../navigation';
import { Icon, type IconName } from './Icon';
import { visibleDeadlines, visibleFlashcards, visibleNotes, visibleSubjects, visibleTasks } from '../lib/selectors';

interface Command {
  id: string;
  title: string;
  hint: string;
  group: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({
  state,
  actions,
  navigate,
  onClose,
}: {
  state: AppState;
  actions: AppActions;
  navigate: Navigate;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'new-note', title: 'New note', hint: 'Notes', group: 'Actions', icon: 'plus', run: () => navigate('notes', 'new') },
      { id: 'new-task', title: 'New task', hint: 'Tasks', group: 'Actions', icon: 'plus', run: () => navigate('plan', 'new') },
      { id: 'new-deadline', title: 'Add a deadline', hint: 'Deadlines', group: 'Actions', icon: 'plus', run: () => navigate('deadlines', 'new') },
      { id: 'review', title: 'Review due flashcards', hint: 'Flashcards', group: 'Actions', icon: 'cards', run: () => navigate('flashcards', 'review') },
      { id: 'focus', title: 'Start a focus session', hint: 'Focus', group: 'Actions', icon: 'timer', run: () => navigate('timer') },
      {
        id: 'theme',
        title: state.profile.colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        hint: 'Appearance',
        group: 'Actions',
        icon: state.profile.colorMode === 'dark' ? 'sun' : 'moon',
        run: () => actions.setColorMode(state.profile.colorMode === 'dark' ? 'light' : 'dark'),
      },
      ...ALL_NAV.map((item) => ({ id: `page-${item.id}`, title: item.label, hint: item.description, group: 'Pages', icon: item.icon, run: () => navigate(item.id) })),
    ];
    for (const note of visibleNotes(state)) {
      list.push({ id: `note-${note.id}`, title: note.title, hint: note.body.slice(0, 80) || 'Note', group: 'Notes', icon: 'notes', run: () => navigate('notes', note.id) });
    }
    for (const task of visibleTasks(state).filter((item) => !item.done)) {
      list.push({ id: `task-${task.id}`, title: task.text, hint: task.dueDate ? `Due ${task.dueDate}` : 'Open task', group: 'Tasks', icon: 'tasks', run: () => navigate('plan') });
    }
    for (const deadline of visibleDeadlines(state)) {
      list.push({ id: `deadline-${deadline.id}`, title: deadline.title, hint: deadline.dueAt.replace('T', ' '), group: 'Deadlines', icon: 'deadline', run: () => navigate('deadlines') });
    }
    for (const subject of visibleSubjects(state)) {
      list.push({ id: `subject-${subject.id}`, title: subject.name, hint: [subject.qualification, subject.examBoard].filter(Boolean).join(' · ') || 'Subject', group: 'Subjects', icon: 'book', run: () => navigate('subjects') });
    }
    for (const card of visibleFlashcards(state).slice(0, 300)) {
      list.push({ id: `card-${card.id}`, title: card.front, hint: card.back.slice(0, 80), group: 'Flashcards', icon: 'cards', run: () => navigate('flashcards') });
    }
    return list;
  }, [actions, navigate, state]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((command) => command.group === 'Actions' || command.group === 'Pages');
    const terms = q.split(/\s+/);
    return commands
      .filter((command) => {
        const haystack = `${command.title} ${command.hint} ${command.group}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 40);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command?: Command) => {
    if (!command) return;
    command.run();
    onClose();
  };

  let lastGroup = '';

  return (
    <div className="modalBackdrop paletteBackdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="paletteInputRow">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, notes, tasks, deadlines, flashcards…"
            aria-label="Search"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
              if (event.key === 'Enter') { event.preventDefault(); run(results[active]); }
              if (event.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="paletteResults" ref={listRef}>
          {results.length === 0 && <p className="paletteEmpty">No matches for “{query}”.</p>}
          {results.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : '';
            lastGroup = command.group;
            return (
              <div key={command.id}>
                {header && <div className="paletteGroup">{header}</div>}
                <button
                  type="button"
                  data-index={index}
                  className={index === active ? 'paletteItem paletteItemActive' : 'paletteItem'}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <Icon name={command.icon} size={16} />
                  <span className="paletteTitle">{command.title}</span>
                  <span className="paletteHint">{command.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
