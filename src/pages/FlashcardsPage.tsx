import { useEffect, useMemo, useRef, useState } from 'react';
import type { Flashcard, ReviewGrade } from '../types';
import type { PageProps } from '../components/study';
import { Badge, EmptyState, Field, MetricCard, Modal, PageHeader, Panel, Segmented, Toggle } from '../components/ui';
import { Icon } from '../components/Icon';
import { deckSummary, describeInterval, isDue, isNew } from '../lib/srs';
import { activeSubject, subjectName, subjectNoun, visibleFlashcards, visibleLabels, visibleNotes, visibleSubjects } from '../lib/selectors';
import { aiProfile, askAi } from '../lib/ai';

type Tab = 'review' | 'browse' | 'create';
const NEW_PER_SESSION = 20;
const GRADES: Array<{ grade: ReviewGrade; label: string; key: string }> = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' },
];

function buildQueue(cards: Flashcard[], practice: boolean): string[] {
  if (practice) return [...cards].sort(() => Math.random() - 0.5).map((card) => card.id);
  const now = Date.now();
  const due = cards.filter((card) => !isNew(card) && isDue(card, now)).sort((a, b) => Date.parse(a.review!.dueAt) - Date.parse(b.review!.dueAt));
  const fresh = cards.filter((card) => isNew(card)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(0, NEW_PER_SESSION);
  return [...due, ...fresh].map((card) => card.id);
}

function ReviewSession({ props, cards, subjectId }: { props: PageProps; cards: Flashcard[]; subjectId: string }) {
  const { actions } = props;
  const [practice, setPractice] = useState(false);
  const [queue, setQueue] = useState<string[]>(() => buildQueue(cards, false));
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const graded = useRef(new Set<string>());
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const current = queue.map((id) => byId.get(id)).find(Boolean);

  useEffect(() => {
    graded.current = new Set();
    setQueue(buildQueue(cards, practice));
    setRevealed(false);
    setReviewed(0);
  }, [subjectId, practice]);

  // Cards created or edited mid-session join the end of the queue if they are due.
  useEffect(() => {
    if (practice) return;
    setQueue((items) => {
      const additions = buildQueue(cards, false).filter((id) => !items.includes(id) && !graded.current.has(id));
      return additions.length ? [...items, ...additions] : items;
    });
  }, [cards, practice]);

  const grade = (value: ReviewGrade) => {
    if (!current) return;
    graded.current.add(current.id);
    if (!practice) actions.reviewFlashcard(current.id, value);
    setReviewed((count) => count + 1);
    setRevealed(false);
    setQueue((items) => {
      const rest = items.filter((id) => id !== current.id);
      return value === 'again' ? [...rest, current.id] : rest;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || !current) return;
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        setRevealed(true);
      }
      const match = GRADES.find((item) => item.key === event.key);
      if (match && revealed) grade(match.grade);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nextDue = cards
    .filter((card) => card.review)
    .map((card) => Date.parse(card.review!.dueAt))
    .filter((ms) => ms > Date.now())
    .sort((a, b) => a - b)[0];

  return (
    <div className="reviewWrap">
      <div className="reviewTopRow">
        <span className="muted smallText">{current ? `${queue.length} left · ${reviewed} reviewed` : `${reviewed} reviewed this session`}</span>
        <Toggle checked={practice} onChange={setPractice} label="Practice mode" description="Go through every card without changing its schedule" />
      </div>
      {!current ? (
        <Panel>
          <EmptyState icon="check" title={cards.length ? 'All caught up' : 'No cards in this deck'}>
            {cards.length
              ? nextDue ? `Next card is due ${new Date(nextDue).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'Nothing is scheduled.'
              : 'Create some cards first, or generate them from a prompt.'}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <button type="button" className={revealed ? 'reviewCard reviewCardRevealed' : 'reviewCard'} onClick={() => setRevealed(true)}>
            <span className="reviewMeta">
              {isNew(current) ? <Badge tone="accent">New</Badge> : <Badge>Review</Badge>}
              <span>{subjectName(props.state, current.subjectId)}</span>
            </span>
            <span className="reviewFront">{current.front}</span>
            {revealed ? (
              <>
                <hr />
                <span className="reviewBack">{current.back}</span>
              </>
            ) : (
              <span className="reviewHint">Click or press Space to show the answer</span>
            )}
          </button>
          {revealed ? (
            <div className="gradeRow">
              {GRADES.map((item) => (
                <button type="button" key={item.grade} className={`gradeButton grade-${item.grade}`} onClick={() => grade(item.grade)}>
                  <strong>{item.label}</strong>
                  <small>{practice ? `Key ${item.key}` : describeInterval(current.review, item.grade)}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="buttonRow center">
              <button className="primaryButton largeButton" onClick={() => setRevealed(true)}>Show answer</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardDialog({ props, card, onClose }: { props: PageProps; card: Flashcard | 'new'; onClose: () => void }) {
  const { state, actions } = props;
  const existing = card === 'new' ? undefined : card;
  const [front, setFront] = useState(existing?.front || '');
  const [back, setBack] = useState(existing?.back || '');
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? state.profile.aiTutor.activeSubjectId ?? '');
  const [labelId, setLabelId] = useState(existing?.labelId || '');
  const noun = subjectNoun(state.profile.educationLevel);
  return (
    <Modal title={existing ? 'Edit flashcard' : 'New flashcard'} onClose={onClose} width={560}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (existing) actions.updateFlashcard(existing.id, { front, back, subjectId, labelId });
          else actions.createFlashcard(front, back, subjectId, labelId);
          if (existing) onClose();
          else { setFront(''); setBack(''); }
        }}
      >
        <Field label="Front"><textarea className="input textArea" value={front} onChange={(event) => setFront(event.target.value)} placeholder="Question, term or prompt" /></Field>
        <Field label="Back"><textarea className="input textArea" value={back} onChange={(event) => setBack(event.target.value)} placeholder="Answer, definition or mark-scheme point" /></Field>
        <div className="formGrid">
          <Field label={noun[0].toUpperCase() + noun.slice(1)}>
            <select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">General</option>
              {visibleSubjects(state).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </Field>
          <Field label="Label">
            <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
              <option value="">No label</option>
              {visibleLabels(state).map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="buttonRow end">
          {existing?.review && (
            <button type="button" className="ghostButton" onClick={() => { actions.resetFlashcardProgress(existing.id); onClose(); }}>Reset progress</button>
          )}
          <button type="button" className="ghostButton" onClick={onClose}>{existing ? 'Cancel' : 'Done'}</button>
          <button className="primaryButton" disabled={!front.trim() || !back.trim()}>{existing ? 'Save' : 'Add card'}</button>
        </div>
      </form>
    </Modal>
  );
}

function AiGenerator({ props, subjectId }: { props: PageProps; subjectId: string }) {
  const { state, actions } = props;
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(8);
  const [useNotes, setUseNotes] = useState(false);
  const [busy, setBusy] = useState<'cards' | 'note' | null>(null);
  const subject = visibleSubjects(state).find((item) => item.id === subjectId) || activeSubject(state);
  const notes = visibleNotes(state);

  const run = async (kind: 'cards' | 'note') => {
    const topic = prompt.trim() || (kind === 'cards' ? `Key ideas in ${subject?.name || 'my subject'}` : '');
    if (!topic) {
      actions.notify('Describe the topic first', 'For example “Keynesian multiplier” or “Le Chatelier’s principle”.', 'warning');
      return;
    }
    setBusy(kind);
    try {
      const reply = await askAi({
        messages: [{
          role: 'user',
          content: kind === 'cards'
            ? `${topic}\nCreate exactly ${count} revision flashcards pitched at my level. Keep fronts short and backs precise. Return only JSON like [{"front":"question","back":"answer"}].`
            : `Write a concise, well-structured study note in Markdown on: ${topic}. Use headings, bullet points and bold key terms.`,
        }],
        profile: aiProfile(state, subject),
        context: {
          recentNotes: useNotes ? notes.slice(0, 8).map((note) => ({ title: note.title, body: note.body.slice(0, 1200) })) : [],
          existingFlashcards: visibleFlashcards(state).slice(0, 12).map((card) => ({ front: card.front })),
        },
      });
      if (kind === 'cards') {
        const json = reply.slice(reply.indexOf('['), reply.lastIndexOf(']') + 1);
        const parsed = JSON.parse(json) as Array<{ front?: unknown; back?: unknown }>;
        actions.createFlashcards(parsed.map((card) => ({ front: String(card.front || ''), back: String(card.back || ''), subjectId: subject?.id })));
      } else {
        actions.createNote(topic.slice(0, 80), reply || 'No note generated.');
      }
    } catch (error) {
      actions.notify(kind === 'cards' ? 'Could not create flashcards' : 'Could not create note', error instanceof Error ? error.message : 'The AI response could not be used.', 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Generate with AI" description={`Cards are filed under ${subject ? subject.name : 'General'}. Always check generated content against your course materials.`}>
      <Field label="Topic or instructions">
        <textarea className="input textArea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="e.g. OCR A level Chemistry — enthalpy changes, or Lecture 5 on monetary policy transmission" />
      </Field>
      <div className="formGrid">
        <Field label="Number of cards">
          <select className="input" value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {[5, 8, 10, 15, 20].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <div className="field">
          <span className="fieldName">Context</span>
          <label className="checkRow"><input type="checkbox" className="checkbox" checked={useNotes} onChange={(event) => setUseNotes(event.target.checked)} /> Use my notes</label>
        </div>
      </div>
      <div className="buttonRow">
        <button className="primaryButton" onClick={() => void run('cards')} disabled={Boolean(busy)}>{busy === 'cards' ? 'Generating…' : 'Generate flashcards'}</button>
        <button className="secondaryButton" onClick={() => void run('note')} disabled={Boolean(busy)}>{busy === 'note' ? 'Writing…' : 'Write a note instead'}</button>
      </div>
    </Panel>
  );
}

export function FlashcardsPage(props: PageProps) {
  const { state, actions, sub } = props;
  const subjects = visibleSubjects(state);
  const allCards = visibleFlashcards(state);
  const [tab, setTab] = useState<Tab>(sub === 'browse' ? 'browse' : sub === 'create' ? 'create' : 'review');
  const [subjectId, setSubjectId] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Flashcard | 'new' | null>(null);
  const deck = useMemo(() => allCards.filter((card) => !subjectId || card.subjectId === subjectId), [allCards, subjectId]);
  const summary = deckSummary(deck);
  const noun = subjectNoun(state.profile.educationLevel);

  const browsed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deck.filter((card) => !q || `${card.front} ${card.back}`.toLowerCase().includes(q));
  }, [deck, query]);

  return (
    <div className="page">
      <PageHeader
        title="Flashcards"
        description="Spaced repetition schedules each card just before you are likely to forget it."
        actions={<button className="primaryButton" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> New card</button>}
      />
      <div className="toolbar">
        <Segmented<Tab> value={tab} onChange={setTab} label="Flashcard view" items={[['review', 'Review'], ['browse', `Browse (${deck.length})`], ['create', 'Generate']]} />
        <select className="input toolbarSelect" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label={`Deck ${noun}`}>
          <option value="">All {subjectNoun(state.profile.educationLevel, true)}</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </div>

      <div className="metricGrid compact">
        <MetricCard title="Due" value={String(summary.due)} detail="Ready to review" />
        <MetricCard title="New" value={String(summary.fresh)} detail={`Up to ${NEW_PER_SESSION} per session`} />
        <MetricCard title="Mature" value={String(summary.mature)} detail="Interval of 3+ weeks" />
        <MetricCard title="Total" value={String(summary.total)} detail="Cards in this deck" />
      </div>

      {tab === 'review' && <ReviewSession props={props} cards={deck} subjectId={subjectId} key={subjectId} />}

      {tab === 'browse' && (
        <Panel
          title="Cards"
          action={
            <div className="searchField">
              <Icon name="search" size={16} />
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cards" aria-label="Search cards" />
            </div>
          }
        >
          {browsed.length === 0 ? (
            <EmptyState icon="cards" title={deck.length ? 'No cards match' : 'This deck is empty'} />
          ) : (
            <div className="cardTable">
              {browsed.map((card) => {
                const due = card.review ? new Date(card.review.dueAt) : null;
                return (
                  <div className="cardRow" key={card.id}>
                    <div className="cardFront">{card.front}</div>
                    <div className="cardBack">{card.back}</div>
                    <div className="cardInfo">
                      <span>{subjectName(state, card.subjectId)}</span>
                      <span>{isNew(card) ? 'New' : due && due.getTime() <= Date.now() ? 'Due now' : due ? `Due ${due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</span>
                    </div>
                    <div className="rowActions">
                      <button type="button" className="iconButton small" onClick={() => setEditing(card)} aria-label="Edit card" title="Edit"><Icon name="edit" size={15} /></button>
                      <button type="button" className="iconButton small" onClick={() => actions.deleteFlashcard(card.id)} aria-label="Archive card" title="Archive"><Icon name="archive" size={15} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {tab === 'create' && <AiGenerator props={props} subjectId={subjectId} />}

      {editing && <CardDialog props={props} card={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
