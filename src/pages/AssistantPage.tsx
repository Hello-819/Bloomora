import { useEffect, useRef, useState } from 'react';
import type { PageProps } from '../components/study';
import { PageHeader, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { MarkdownView } from '../components/Markdown';
import { aiProfile, askAi, type ChatMessage } from '../lib/ai';
import { activeSubject, educationLabel, subjectNoun, visibleDeadlines, visibleFlashcards, visibleNotes, visibleSessions, visibleSubjects, visibleTasks } from '../lib/selectors';
import { studyTotals } from '../lib/stats';
import { formatDuration } from '../lib/format';

function promptsFor(level: string): string[] {
  if (level === 'university' || level === 'postgraduate') {
    return [
      'Explain this concept step by step, then check my understanding',
      'Help me plan an essay structure with a clear argument',
      'Give me five seminar discussion questions on this topic',
      'Build a revision timetable around my deadlines',
      'Critique this paragraph for clarity and academic tone',
    ];
  }
  return [
    'Quiz me with exam-style questions',
    'Explain this topic as if I am stuck on it',
    'Make a 7 day revision plan before my exam',
    'Show me how marks are typically awarded for a 6-mark answer',
    'Summarise my latest note into key points',
  ];
}

export function AssistantPage({ state, actions, navigate }: PageProps) {
  const subjects = visibleSubjects(state);
  const subject = activeSubject(state);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const noun = subjectNoun(state.profile.educationLevel);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending) return;
    const next = [...messages, { role: 'user' as const, content: clean }];
    setMessages(next);
    setInput('');
    setSending(true);
    const totals = studyTotals(visibleSessions(state));
    try {
      const reply = await askAi({
        messages: next,
        profile: aiProfile(state, subject),
        context: {
          todayStudy: formatDuration(totals.todaySec),
          weekStudy: formatDuration(totals.weekSec),
          openTasks: visibleTasks(state).filter((task) => !task.done).slice(0, 8).map((task) => ({ text: task.text, notes: task.notes, due: task.dueDate })),
          upcomingDeadlines: visibleDeadlines(state).filter((item) => item.status !== 'submitted').slice(0, 8).map((item) => ({ title: item.title, due: item.dueAt, weight: item.weight })),
          recentNotes: visibleNotes(state).slice(0, 6).map((note) => ({ title: note.title, body: note.body.slice(0, 900) })),
          flashcards: visibleFlashcards(state)
            .filter((card) => !subject || card.subjectId === subject.id || !card.subjectId)
            .slice(0, 16)
            .map((card) => ({ front: card.front, back: card.back })),
        },
      });
      setMessages([...next, { role: 'assistant', content: reply || 'I could not generate a response.' }]);
    } catch (error) {
      setMessages([...next, { role: 'assistant', content: `I could not reach the AI service: ${error instanceof Error ? error.message : 'unknown error'}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page assistantPage">
      <PageHeader
        title="AI Tutor"
        description={`Answers are tailored to ${educationLabel(state.profile.educationLevel).toLowerCase()} and your active ${noun}. Check anything important against your course materials.`}
        actions={
          <>
            <select className="input toolbarSelect" value={state.profile.aiTutor.activeSubjectId} onChange={(event) => actions.setActiveSubject(event.target.value)} aria-label={`Active ${noun}`}>
              <option value="">General study</option>
              {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {messages.length > 0 && <button className="ghostButton" onClick={() => setMessages([])}>New chat</button>}
          </>
        }
      />
      <Panel className="chatPanel">
        <div className="chatScroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="chatIntro">
              <span className="emptyIcon"><Icon name="sparkles" size={22} /></span>
              <strong>What are you working on?</strong>
              <p>Ask for an explanation, worked example, practice questions, or feedback on your writing. Your notes, tasks and deadlines are shared as context.</p>
              <div className="promptGrid">
                {promptsFor(state.profile.educationLevel).map((prompt) => (
                  <button type="button" key={prompt} className="promptCard" onClick={() => void send(prompt)}>{prompt}</button>
                ))}
              </div>
              {subjects.length === 0 && (
                <button type="button" className="textButton" onClick={() => navigate('subjects')}>Add your {subjectNoun(state.profile.educationLevel, true)} for better answers</button>
              )}
            </div>
          ) : (
            messages.map((message, index) => (
              <div className={message.role === 'assistant' ? 'chatMessage chatMessageAssistant' : 'chatMessage chatMessageUser'} key={index}>
                <span className="chatAuthor">{message.role === 'assistant' ? 'Tutor' : 'You'}</span>
                {message.role === 'assistant' ? <MarkdownView body={message.content} /> : <p>{message.content}</p>}
                {message.role === 'assistant' && (
                  <div className="chatTools">
                    <button type="button" className="textButton" onClick={() => actions.createNote(`Tutor: ${messages[index - 1]?.content.slice(0, 60) || 'answer'}`, message.content)}>Save as note</button>
                    <button type="button" className="textButton" onClick={() => void navigator.clipboard?.writeText(message.content).then(() => actions.notify('Copied', undefined, 'success'))}>Copy</button>
                  </div>
                )}
              </div>
            ))
          )}
          {sending && <div className="chatMessage chatMessageAssistant"><span className="chatAuthor">Tutor</span><p className="typing">Thinking…</p></div>}
        </div>
        <form className="chatComposer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea
            className="input chatInput"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Message the tutor… (Shift+Enter for a new line)"
            aria-label="Message"
            rows={2}
          />
          <button className="primaryButton" disabled={sending || !input.trim()}><Icon name="send" size={16} /> Send</button>
        </form>
      </Panel>
    </div>
  );
}
