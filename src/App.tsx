import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { AppState, ColorMode, Flashcard, Label, StudyNote, StudySession, StudySubject, StudyTask, ThemeName, TimerMode } from './types';
import { useAppStore, type AppActions } from './state/AppStore';
import {
  computeFruitsReady,
  computeIslandLevel,
  computeStreak,
  computeTreeStage,
  dailyQuests,
  nextAchievements,
  studyTotals,
  studyByLabel,
} from './lib/gamification';
import { addDaysMs, dateKey, startOfDayMs, startOfWeekMs, startOfMonthMs, startOfYearMs } from './lib/dates';
import { compactHours, formatClock, formatDateTime, formatDuration } from './lib/format';
import { elapsedForTimer, remainingForTimer } from './lib/timers';
import { createExportPayload, downloadJson, validateImportText, type ImportPreview } from './lib/exportImport';

type Page = 'dashboard' | 'timer' | 'worlds' | 'stats' | 'plan' | 'timetable' | 'notes' | 'flashcards' | 'assistant' | 'archive' | 'settings';
type AiApiResponse = { reply?: string; error?: string; model?: string; usage?: unknown };

const NAV_ITEMS: Array<{ id: Page; label: string }> = [
  { id: 'dashboard', label: 'Home' },
  { id: 'timer', label: 'Timer' },
  { id: 'worlds', label: 'Worlds' },
  { id: 'stats', label: 'Stats' },
  { id: 'plan', label: 'Plan' },
  { id: 'timetable', label: 'Timetable' },
  { id: 'notes', label: 'Notes' },
  { id: 'flashcards', label: 'Cards' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'archive', label: 'Archive' },
  { id: 'settings', label: 'Settings' },
];

const LABEL_COLORS = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#15803d', '#db2777', '#475569'];
const TREE_TYPES = ['Apple', 'Orange', 'Cherry', 'Mango', 'Peach'];
const MOTIVATION_QUOTES = [
  'Small focus blocks become big results.',
  'Your future self is built one session at a time.',
  'Start tiny, stay steady, let momentum do the heavy lifting.',
  'A clear next step beats a perfect plan.',
  'Every saved session is proof you showed up.',
  'Make it easier to begin than to avoid.',
];

function visibleSessions(state: AppState): StudySession[] {
  return state.sessions.filter((session) => !session.deletedAt);
}

function visibleLabels(state: AppState): Label[] {
  return state.labels
    .filter((label) => !label.deletedAt)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
}

function visibleTasks(state: AppState): StudyTask[] {
  return state.tasks
    .filter((task) => !task.deletedAt)
    .sort((a, b) => Number(a.done) - Number(b.done) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function visibleNotes(state: AppState): StudyNote[] {
  return (state.notes || [])
    .filter((note) => !note.deletedAt)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function visibleSubjects(state: AppState): StudySubject[] {
  return (state.subjects || [])
    .filter((subject) => !subject.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function visibleFlashcards(state: AppState): Flashcard[] {
  return (state.flashcards || [])
    .filter((card) => !card.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function activeSubject(state: AppState): StudySubject | undefined {
  const subjects = visibleSubjects(state);
  return subjects.find((subject) => subject.id === state.profile.aiTutor.activeSubjectId) || subjects[0];
}

async function readAiResponse(response: Response): Promise<AiApiResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: response.ok
        ? 'The AI route returned an empty response.'
        : `The AI route returned ${response.status} ${response.statusText || 'without a response body'}.`,
    };
  }

  try {
    return JSON.parse(text) as AiApiResponse;
  } catch {
    return {
      error: text.slice(0, 300) || 'The AI route returned a non-JSON response.',
    };
  }
}

function labelName(state: AppState, session: StudySession): string {
  if (session.labelId) {
    const label = state.labels.find((item) => item.id === session.labelId);
    if (label) return label.name;
  }
  return session.labelNameSnapshot || 'No label';
}

function islandAsset(level: number): string {
  const n = Math.min(6, Math.max(1, Math.floor(level) + 1));
  return `/assets/images/v2/island_${String(n).padStart(2, '0')}.jpg`;
}

function useHashPage(): [Page, (page: Page) => void] {
  const pageFromHash = () => {
    const raw = window.location.hash.replace('#/', '') as Page;
    return NAV_ITEMS.some((item) => item.id === raw) ? raw : 'dashboard';
  };
  const [page, setPageState] = useState<Page>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setPage = (next: Page) => {
    window.location.hash = `/${next}`;
    setPageState(next);
  };
  return [page, setPage];
}

function useNow(enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function App() {
  const { state, loading, toasts, actions, syncConfigured } = useAppStore();
  const [page, setPage] = useHashPage();
  const [musicOpen, setMusicOpen] = useState(false);

  useEffect(() => {
    if (!state) return;
    document.body.dataset.theme = state.profile.theme;
    document.body.dataset.mode = state.profile.colorMode;
    if (state.profile.backgroundImage) {
      document.body.dataset.customBg = 'on';
      document.body.style.setProperty('--custom-bg-image', `url("${state.profile.backgroundImage}")`);
    } else {
      delete document.body.dataset.customBg;
      document.body.style.removeProperty('--custom-bg-image');
    }
  }, [state?.profile.backgroundImage, state?.profile.colorMode, state?.profile.theme]);

  useAmbientAudio(state);

  useEffect(() => {
    if (!state || !state.activeTimer?.running) {
      document.title = 'Bloomora V2';
      return;
    }
    const timer = state.activeTimer;
    if (timer.mode === 'stopwatch') {
      const elapsed = elapsedForTimer(timer, Date.now());
      document.title = `${formatClock(elapsed)} - Bloomora`;
    } else {
      const remaining = remainingForTimer(timer, Date.now());
      if (remaining !== null) {
        document.title = `${formatClock(remaining)} - Bloomora`;
      }
    }
  }, [state?.activeTimer, state?.activeTimer?.running, state?.activeTimer?.accumulatedSec]);

  if (loading || !state) {
    return (
      <main className="loadingShell">
        <div className="brandMark">B</div>
        <p>Opening Bloomora...</p>
      </main>
    );
  }

  return (
    <div className="appShell">
      <AsideNav page={page} setPage={setPage} state={state} musicOpen={musicOpen} setMusicOpen={setMusicOpen} />
      <div className="workspace">
        <TopBar state={state} actions={actions} page={page} setPage={setPage} />
        <main className="pageSurface" key={page}>
          {page === 'dashboard' && <DashboardPage state={state} actions={actions} setPage={setPage} />}
          {page === 'timer' && <TimerPage state={state} actions={actions} />}
          {page === 'worlds' && <WorldsPage state={state} actions={actions} />}
          {page === 'stats' && <StatsPage state={state} actions={actions} />}
          {page === 'plan' && <PlanPage state={state} actions={actions} />}
          {page === 'timetable' && <TimetablePage state={state} actions={actions} />}
          {page === 'notes' && <NotesPage state={state} actions={actions} />}
          {page === 'flashcards' && <FlashcardsPage state={state} actions={actions} />}
          {page === 'assistant' && <AssistantPage state={state} actions={actions} setPage={setPage} />}
          {page === 'archive' && <ArchivePage state={state} actions={actions} />}
          {page === 'settings' && <SettingsPage state={state} actions={actions} syncConfigured={syncConfigured} />}
        </main>
      </div>
      <MobileNav page={page} setPage={setPage} />
      <PersistentMusicPlayer state={state} actions={actions} open={musicOpen} />
      <ToastStack toasts={toasts} actions={actions} />
    </div>
  );
}

function AsideNav({
  page,
  setPage,
  state,
  musicOpen,
  setMusicOpen,
}: {
  page: Page;
  setPage: (page: Page) => void;
  state: AppState;
  musicOpen: boolean;
  setMusicOpen: (open: boolean) => void;
}) {
  const totals = studyTotals(visibleSessions(state));
  const dailyGoalSec = Math.max(60, state.profile.dailyGoalMinutes * 60);
  const hiddenItems = state.profile.hiddenSidebarItems || [];
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <aside className="sideNav">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <button className="brandButton" onClick={() => setPage('dashboard')} aria-label="Go home">
          <span className="brandMark">B</span>
          <span>
            <strong>Bloomora</strong>
            <small>Study companion</small>
          </span>
        </button>
        {hiddenItems.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button className="ghostButton" style={{ padding: '4px 8px' }} onClick={() => setMenuOpen(!menuOpen)}>
              ⋮
            </button>
            {menuOpen && (
              <div className="topAiDropdown" style={{ top: '100%', right: 0, marginTop: '4px', minWidth: '150px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {NAV_ITEMS.filter(item => hiddenItems.includes(item.id)).map(item => (
                    <button
                      key={item.id}
                      className="navButton"
                      style={{ background: page === item.id ? 'var(--surface-strong)' : 'transparent' }}
                      onClick={() => {
                        setPage(item.id);
                        setMenuOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <nav aria-label="Main navigation">
        {NAV_ITEMS.filter(item => !hiddenItems.includes(item.id)).map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'navButton navButtonActive' : 'navButton'}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <button className={musicOpen ? 'navButton navButtonActive musicSideButton' : 'navButton musicSideButton'} onClick={() => setMusicOpen(!musicOpen)}>
        Music
      </button>
      <div className="sideSummary">
        <span>Today</span>
        <strong>{formatDuration(totals.todaySec)}</strong>
        <ProgressBar value={totals.todaySec} max={dailyGoalSec} />
        <span>This week</span>
        <strong>{formatDuration(totals.weekSec)}</strong>
        <ProgressBar value={totals.weekSec} max={Math.max(1, state.profile.weeklyGoalHours * 3600)} />
      </div>
    </aside>
  );
}

function TopBar({
  state,
  actions,
  page,
  setPage,
}: {
  state: AppState;
  actions: AppActions;
  page: Page;
  setPage: (page: Page) => void;
}) {
  const level = computeIslandLevel(state.gamification.islandXpSec);
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <header className="topBar">
      <div>
        <p className="eyebrow">Bloomora V2</p>
        <h1>{NAV_ITEMS.find((item) => item.id === page)?.label}</h1>
      </div>
      <div className="topActions">
        <button className="ghostButton" onClick={() => setPage('timer')}>
          Study now
        </button>
        {!state.profile.hideAiTutor && (
          <div className="topAiWrap">
            <button className="topAiButton" onClick={() => setAiOpen((open) => !open)} aria-expanded={aiOpen}>
              AI
            </button>
            {aiOpen && <TopAiDropdown state={state} actions={actions} setPage={setPage} onClose={() => setAiOpen(false)} />}
          </div>
        )}
        <div className="syncPill" title={state.sync.lastError || state.sync.status}>
          {state.sync.enabled ? state.sync.status : 'Local'}
        </div>
        <div className="levelPill">Level {level.level}</div>
      </div>
    </header>
  );
}

function TopAiDropdown({
  state,
  actions,
  setPage,
  onClose,
}: {
  state: AppState;
  actions: AppActions;
  setPage: (page: Page) => void;
  onClose: () => void;
}) {
  const subject = activeSubject(state);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Ask for a quick explanation, quiz, plan, note, or flashcard idea.' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const sendMessage = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content: clean }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    const sessions = visibleSessions(state);
    const tasks = visibleTasks(state);
    const notes = visibleNotes(state);
    const flashcards = visibleFlashcards(state);
    const totals = studyTotals(sessions);
    const streak = computeStreak(sessions);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          messages: nextMessages,
          profile: {
            displayName: state.profile.displayName,
            qualification: subject?.qualification || '',
            examBoard: subject?.examBoard || '',
            subject: subject?.name || '',
            targetGrade: subject?.targetGrade || '',
            examDate: subject?.examDate || '',
          },
          context: {
            todayStudy: formatDuration(totals.todaySec),
            weekStudy: formatDuration(totals.weekSec),
            streakDays: streak.current,
            openTasks: tasks.filter((task) => !task.done).slice(0, 6).map((task) => ({ text: task.text, notes: task.notes })),
            recentNotes: notes.slice(0, 4).map((note) => ({ title: note.title, body: note.body.slice(0, 700) })),
            flashcards: flashcards.slice(0, 12).map((card) => ({ front: card.front, back: card.back })),
          },
        }),
      });
      const data = await readAiResponse(response);
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      setMessages([...nextMessages, { role: 'assistant', content: data.reply || 'I could not generate a response.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The AI assistant could not respond.';
      setMessages([...nextMessages, { role: 'assistant', content: `I could not reach the AI model: ${message}` }]);
    } finally {
      setSending(false);
    }
  };

  const go = (next: Page) => {
    setPage(next);
    onClose();
  };

  return (
    <section className="topAiDropdown" aria-label="Bloomora AI menu">
      <div className="floatingAiHeader">
        <div>
          <strong>Bloomora AI</strong>
          <span>{subject ? subject.name : 'General study'}</span>
        </div>
        <button className="textButton" onClick={onClose}>Close</button>
      </div>
      <div className="chatBox floatingChatBox">
        {messages.map((message, index) => (
          <div className={message.role === 'assistant' ? 'chatBubble chatBubbleAssistant' : 'chatBubble chatBubbleUser'} key={`${message.role}-${index}`}>
            <strong>{message.role === 'assistant' ? 'Bloomora AI' : 'You'}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <form
        className="chatComposer floatingComposer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <textarea className="input chatInput" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask for help..." />
        <button className="primaryButton" disabled={sending}>{sending ? '...' : 'Send'}</button>
      </form>
      <div className="promptChips">
        {['Quiz me', 'Explain this', 'Make flashcards'].map((prompt) => (
          <button className="secondaryButton" key={prompt} onClick={() => void sendMessage(prompt)} disabled={sending}>{prompt}</button>
        ))}
      </div>
      <div className="promptChips">
        <button className="ghostButton" onClick={() => go('assistant')}>Full assistant</button>
        <button className="ghostButton" onClick={() => go('flashcards')}>AI creator</button>
        <button className="ghostButton" onClick={() => go('notes')}>Notes</button>
      </div>
    </section>
  );
}

function MobileNav({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  const items = NAV_ITEMS.filter((item) => ['dashboard', 'timer', 'stats', 'notes', 'flashcards'].includes(item.id));
  return (
    <nav className="mobileNav" aria-label="Mobile navigation">
      {items.map((item) => (
        <button
          key={item.id}
          className={page === item.id ? 'mobileNavButton mobileNavButtonActive' : 'mobileNavButton'}
          onClick={() => setPage(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function DashboardPage({
  state,
  actions,
  setPage,
}: {
  state: AppState;
  actions: AppActions;
  setPage: (page: Page) => void;
}) {
  const sessions = visibleSessions(state);
  const totals = studyTotals(sessions);
  const streak = computeStreak(sessions);
  const level = computeIslandLevel(state.gamification.islandXpSec);
  const tree = computeTreeStage(state.gamification.gardenGrowthSec);
  const quests = dailyQuests(state);
  const recent = sessions.slice(0, 5);
  const weeklyGoal = Math.max(1, state.profile.weeklyGoalHours * 3600);
  const quote = useMemo(() => MOTIVATION_QUOTES[Math.floor(Math.random() * MOTIVATION_QUOTES.length)], []);

  const subjectsWithExamDate = state.subjects.filter((s) => !s.deletedAt && s.examDate);
  const upcomingExams = [...subjectsWithExamDate]
    .filter(s => !isNaN(new Date(s.examDate).getTime()))
    .sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime())
    .slice(0, 3);

  return (
    <section className="stack">
      <div className="heroBand">
        <div>
          <p className="eyebrow">Welcome back, {state.profile.displayName}</p>
          <h2>Build a steady study rhythm today.</h2>
          <p className="muted">
            {formatDuration(totals.todaySec)} studied today. {formatDuration(Math.max(0, weeklyGoal - totals.weekSec))} left for the weekly goal.
          </p>
          <p className="quoteLine">{quote}</p>
          <div className="buttonRow">
            <button className="primaryButton" onClick={() => setPage('timer')}>
              Start focus
            </button>
            <button className="secondaryButton" onClick={() => setPage('plan')}>
              Plan tasks
            </button>
          </div>
        </div>
        <div className="heroWorld">
          <img src={islandAsset(level.level)} alt="Island progress" />
          <span>Island level {level.level}</span>
        </div>
      </div>
      <div className="metricGrid">
        <MetricCard title="Today" value={formatDuration(totals.todaySec)} detail={`${sessions.filter((s) => dateKey(s.endAt) === dateKey()).length} sessions`} />
        <MetricCard title="This week" value={formatDuration(totals.weekSec)} detail={`${Math.floor((totals.weekSec / weeklyGoal) * 100)} percent of goal`} />
        <MetricCard title="Streak" value={`${streak.current} days`} detail={`Best: ${streak.longest} days`} />
        <MetricCard title="Garden" value={tree.current.name} detail={`${tree.pct} percent to next stage`} />
      </div>
      <div className="splitGrid">
        <LabelStats state={state} />
        {upcomingExams.length > 0 && (
          <Panel title="Upcoming Exams" action={<button className="textButton" onClick={() => setPage('plan')}>Manage subjects</button>}>
            <div className="questList">
              {upcomingExams.map(subject => {
                const daysLeft = Math.ceil((new Date(subject.examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                return (
                  <div className="questItem" key={subject.id}>
                    <strong>{subject.name} ({subject.qualification})</strong>
                    <span style={{ color: daysLeft < 30 ? 'var(--danger)' : 'var(--muted)' }}>{daysLeft > 0 ? `${daysLeft} days left` : 'Past'}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
        <Panel title="Recent sessions" action={<button className="textButton" onClick={() => setPage('stats')}>All stats</button>}>
          <SessionList sessions={recent} state={state} actions={actions} />
        </Panel>
      </div>
    </section>
  );
}

function TimerPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const labels = visibleLabels(state);
  const tasks = visibleTasks(state).filter((task) => !task.done);
  const [mode, setMode] = useState<TimerMode>('stopwatch');
  const [labelId, setLabelId] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [countdownMin, setCountdownMin] = useState(25);
  const [manualMinutes, setManualMinutes] = useState(30);
  const now = useNow(Boolean(state.activeTimer?.running));
  const timer = state.activeTimer;
  const elapsed = timer ? elapsedForTimer(timer, now) : 0;
  const remaining = timer ? remainingForTimer(timer, now) : null;

  useEffect(() => {
    if (state.activeTimer) {
      setLabelId(state.activeTimer.labeling.labelId || '');
    }
  }, [state.activeTimer?.labeling.labelId]);

  useEffect(() => {
    if (!timer?.running || !timer.totalSec || remaining === null || remaining > 0) return;
    if (timer.mode === 'pomodoro') actions.completePomodoroPhase();
    else actions.pauseTimer();
  }, [actions, remaining, timer?.id, timer?.mode, timer?.running, timer?.totalSec]);

  const labeling = useMemo(
    () => ({ rewardMode: 'island' as const, labelId: labelId || undefined, taskIds: selectedTasks }),
    [labelId, selectedTasks],
  );

  const start = () => {
    if (state.activeTimer) return;
    if (state.profile.timerRequireLabel && !labelId) {
      actions.notify('Label required', 'Please select a label before starting the timer.', 'warning');
      return;
    }
    if (mode === 'stopwatch') {
      actions.startTimer({ mode, labeling });
      return;
    }
    if (mode === 'countdown') {
      actions.startTimer({ mode, totalSec: Math.max(1, countdownMin) * 60, labeling });
      return;
    }
    const settings = state.profile.pomodoro;
    actions.startTimer({
      mode,
      totalSec: settings.focusMin * 60,
      pomodoro: {
        phase: 'focus',
        round: 1,
        focusMin: settings.focusMin,
        shortBreakMin: settings.shortBreakMin,
        longBreakMin: settings.longBreakMin,
        longEvery: settings.longEvery,
      },
      labeling,
    });
  };

  const manualSave = () => {
    const ok = actions.addSession({
      durationSec: manualMinutes * 60,
      method: 'manual',
      rewardMode: 'island',
      labelId: labelId || undefined,
      taskIds: selectedTasks,
    });
    if (ok) setSelectedTasks([]);
  };

  return (
    <section className="timerLayout">
      <div className="timerStage">
        {timer ? (
          <>
            <p className="eyebrow">
              {timer.mode === 'pomodoro' && timer.pomodoro
                ? `${timer.pomodoro.phase} round ${timer.pomodoro.round}`
                : timer.mode}
            </p>
            <div className="timerDisplay">
              {timer.totalSec ? formatClock(remaining ?? 0) : formatClock(elapsed)}
            </div>
            <p className="muted">
              {timer.running ? 'In progress' : remaining === 0 ? 'Finished' : 'Paused'} - {formatDuration(elapsed)} focused
            </p>
            <div className="buttonRow center">
              {timer.running ? (
                <button className="secondaryButton" onClick={() => actions.pauseTimer()}>
                  Pause
                </button>
              ) : (
                <button className="secondaryButton" onClick={() => actions.resumeTimer()} disabled={remaining === 0}>
                  Resume
                </button>
              )}
              <button className="primaryButton" onClick={() => actions.saveActiveTimer()}>
                Save session
              </button>
              <button className="ghostButton" onClick={() => actions.resetTimer()}>
                Reset
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Ready</p>
            <div className="timerDisplay">
              {mode === 'countdown'
                ? formatClock(countdownMin * 60)
                : mode === 'pomodoro'
                  ? formatClock(state.profile.pomodoro.focusMin * 60)
                  : '00:00'}
            </div>
            <p className="muted">Choose a label, link tasks, then let the session grow both worlds.</p>
            <button className="primaryButton largeAction" onClick={start}>
              Start {mode}
            </button>
          </>
        )}
      </div>

      <aside className="controlPanel">
        <Panel title="Session setup">
          <Segmented<TimerMode>
            value={mode}
            onChange={setMode}
            items={[
              ['stopwatch', 'Stopwatch'],
              ['countdown', 'Countdown'],
              ['pomodoro', 'Pomodoro'],
            ]}
            disabled={Boolean(state.activeTimer)}
          />
          {mode === 'countdown' && (
            <label className="fieldLabel">
              Minutes
              <input
                className="input"
                type="number"
                min={1}
                max={240}
                value={countdownMin}
                onChange={(event) => setCountdownMin(Math.max(1, Number(event.target.value)))}
                disabled={Boolean(state.activeTimer)}
              />
            </label>
          )}
          <label className="fieldLabel">
            Label
            <select
              className="input"
              value={labelId}
              onChange={(event) => {
                setLabelId(event.target.value);
                if (state.activeTimer) {
                  actions.updateActiveTimerLabel(event.target.value || undefined);
                }
              }}
            >
              <option value="">No label</option>
              {labels.map((label) => (
                <option value={label.id} key={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </label>
          <TaskPicker tasks={tasks} selected={selectedTasks} setSelected={setSelectedTasks} disabled={Boolean(state.activeTimer)} />
        </Panel>
        <Panel title="Quick manual add">
          <div className="inlineForm">
            <input
              className="input"
              type="number"
              min={1}
              value={manualMinutes}
              onChange={(event) => setManualMinutes(Math.max(1, Number(event.target.value)))}
              aria-label="Manual session minutes"
            />
            <button className="secondaryButton" onClick={manualSave}>
              Add minutes
            </button>
          </div>
        </Panel>
      </aside>
    </section>
  );
}

function WorldsPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const level = computeIslandLevel(state.gamification.islandXpSec);
  const tree = computeTreeStage(state.gamification.gardenGrowthSec);
  const readyFruit = computeFruitsReady(state.gamification);
  const asset = islandAsset(level.level);

  return (
    <section className="stack">
      <div className="worldGrid">
        <Panel title="Island">
          <div className="worldVisual islandVisual">
            <img src={asset} alt={`Island level ${level.level}`} />
          </div>
          <div className="worldHeader">
            <strong>Level {level.level}</strong>
            <span>{formatDuration(level.remainingSec)} to level {level.nextLevel}</span>
          </div>
          <ProgressBar value={level.pct} max={100} />
          <UpgradeList level={level.level} />
        </Panel>
        <Panel title="Garden">
          <div className="worldVisual gardenVisual">
            <img src={tree.current.asset} alt={`${tree.current.name} stage`} />
          </div>
          <div className="worldHeader">
            <strong>{state.gamification.gardenTreeType} {tree.current.name}</strong>
            <span>{tree.next ? `${formatDuration(tree.remainingSec)} to ${tree.next.name}` : 'Fully grown'}</span>
          </div>
          <ProgressBar value={tree.pct} max={100} />
          <div className="buttonRow">
            <button className="primaryButton" onClick={() => actions.harvestFruits()}>
              Harvest {readyFruit}
            </button>
            <select className="input compact" value={state.gamification.gardenTreeType} onChange={(event) => actions.restartGarden(event.target.value)}>
              {TREE_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </div>
        </Panel>
      </div>
      <Panel title="Fruit collection">
        <div className="collectionGrid">
          {Object.entries(state.gamification.fruitCollection).map(([name, count]) => (
            <div className="collectionItem" key={name}>
              <img src="/assets/images/plant_fruit.png" alt="" />
              <strong>{name}</strong>
              <span>{count}</span>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function StatsPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const sessions = useMemo(() => visibleSessions(state), [state]);
  const totals = useMemo(() => studyTotals(sessions), [sessions]);
  const streak = useMemo(() => computeStreak(sessions), [sessions]);
  const level = useMemo(() => computeIslandLevel(state.gamification.islandXpSec), [state.gamification.islandXpSec]);
  const achievements = useMemo(() => nextAchievements(state), [state]);
  const [labelFilter, setLabelFilter] = useState<'today' | 'week' | 'month' | 'year' | 'all'>('all');

  const byLabel = useMemo(() => {
    const map = new Map<string, number>();
    const now = Date.now();
    let threshold = 0;
    if (labelFilter === 'today') threshold = startOfDayMs(now);
    if (labelFilter === 'week') threshold = startOfWeekMs(now);
    if (labelFilter === 'month') threshold = startOfMonthMs(now);
    if (labelFilter === 'year') threshold = startOfYearMs(now);

    for (const session of sessions) {
      if (Date.parse(session.endAt) >= threshold) {
        const name = labelName(state, session);
        map.set(name, (map.get(name) || 0) + session.durationSec);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [sessions, state, labelFilter]);

  const bestHour = useMemo(() => {
    const hours = new Array<number>(24).fill(0);
    for (const session of sessions) hours[new Date(session.endAt).getHours()] += session.durationSec;
    const best = hours.reduce((bestIndex, value, index) => (value > hours[bestIndex] ? index : bestIndex), 0);
    return hours[best] ? `${String(best).padStart(2, '0')}:00` : 'None yet';
  }, [sessions]);

  return (
    <section className="stack">
      <div className="metricGrid">
        <MetricCard title="Total study" value={formatDuration(totals.totalSec)} detail={`${totals.count} saved sessions`} />
        <MetricCard title="This month" value={formatDuration(totals.monthSec)} detail="Logged from saved sessions" />
        <MetricCard title="Current streak" value={`${streak.current} days`} detail={`Best: ${streak.longest} days`} />
        <MetricCard title="Best hour" value={bestHour} detail={`Island level ${level.level}`} />
      </div>
      <Panel title="Activity">
        <ActivityChart sessions={sessions} days={28} />
      </Panel>
      <div className="statsGraphGrid">
        <Panel title="Best focus hours">
          <HourlyGraph sessions={sessions} />
        </Panel>
        <Panel title="Study methods">
          <MethodGraph sessions={sessions} />
        </Panel>
        <Panel title="Weekday rhythm">
          <WeekdayGraph sessions={sessions} />
        </Panel>
      </div>
      <div className="splitGrid">
        <Panel
          title="Study by label"
          action={
            <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={labelFilter} onChange={(e) => setLabelFilter(e.target.value as any)}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
              <option value="all">All Time</option>
            </select>
          }
        >
          <div className="breakdownList">
            {byLabel.length === 0 ? (
              <p className="muted">No labelled study in this period.</p>
            ) : (
              byLabel.map(([name, sec]) => (
                <div className="breakdownRow" key={name}>
                  <span>{name}</span>
                  <ProgressBar value={sec} max={Math.max(...byLabel.map(([, value]) => value), 1)} />
                  <strong>{compactHours(sec)}</strong>
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Achievements">
          <div className="achievementList">
            {achievements.map((achievement) => (
              <div className="achievementItem" key={achievement.id}>
                <strong>{achievement.title}</strong>
                <span>{achievement.detail}</span>
                <ProgressBar value={achievement.progress} max={1} />
              </div>
            ))}
            {achievements.length === 0 && <p className="muted">All current achievements are complete.</p>}
          </div>
        </Panel>
      </div>
      <Panel title="Session log">
        <SessionList sessions={sessions.slice(0, 20)} state={state} actions={actions} />
      </Panel>
    </section>
  );
}

function PlanPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const labels = visibleLabels(state);
  const tasks = visibleTasks(state);
  const [labelNameInput, setLabelNameInput] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [taskText, setTaskText] = useState('');
  const [taskNotes, setTaskNotes] = useState('');
  const [taskLabel, setTaskLabel] = useState('');

  return (
    <section className="planGrid">
      <Panel title="Labels">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            actions.createLabel(labelNameInput, color);
            setLabelNameInput('');
          }}
        >
          <input className="input" value={labelNameInput} onChange={(event) => setLabelNameInput(event.target.value)} placeholder="Label name" />
          <div className="colorRow">
            {LABEL_COLORS.map((item) => (
              <button
                type="button"
                key={item}
                aria-label={`Use color ${item}`}
                className={color === item ? 'colorDot colorDotActive' : 'colorDot'}
                style={{ background: item }}
                onClick={() => setColor(item)}
              />
            ))}
          </div>
          <button className="primaryButton">Create label</button>
        </form>
        <div className="labelGrid">
          {labels.map((label) => (
            <div className="labelCard" key={label.id}>
              <span className="labelSwatch" style={{ background: label.color }} />
              <strong>{label.name}</strong>
              <div className="itemActions">
                <button className="textButton" onClick={() => actions.toggleLabelFavorite(label.id)}>
                  {label.favorite ? 'Favorited' : 'Favorite'}
                </button>
                <button className="textButton dangerText" onClick={() => actions.deleteLabel(label.id)}>
                  Archive
                </button>
              </div>
            </div>
          ))}
          {labels.length === 0 && <p className="muted">Create labels for subjects, projects, or exam topics.</p>}
        </div>
      </Panel>

      <Panel title="Tasks">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            actions.addTask(taskText, taskNotes, taskLabel);
            setTaskText('');
            setTaskNotes('');
          }}
        >
          <input className="input" value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder="Study task" />
          <input className="input" value={taskNotes} onChange={(event) => setTaskNotes(event.target.value)} placeholder="Notes, optional" />
          <select className="input" value={taskLabel} onChange={(event) => setTaskLabel(event.target.value)}>
            <option value="">No label</option>
            {labels.map((label) => (
              <option value={label.id} key={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          <button className="primaryButton">Add task</button>
        </form>
        <div className="taskList">
          {tasks.map((task) => (
            <TaskRow task={task} state={state} actions={actions} key={task.id} />
          ))}
          {tasks.length === 0 && <p className="muted">Add a task, then link it to a focus session.</p>}
        </div>
      </Panel>
    </section>
  );
}

function downloadText(filename: string, text: string, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameSafe(value: string): string {
  return (value.trim() || 'note').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 70) || 'note';
}

function titleFromMarkdownFile(file: File, text: string): string {
  const heading = text.split(/\r?\n/).find((line) => line.trim().startsWith('# '));
  if (heading) return heading.replace(/^#\s+/, '').trim().slice(0, 80) || file.name.replace(/\.md$/i, '');
  return file.name.replace(/\.md$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported note';
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <span key={index}>{part}</span>;
  });
}

function MarkdownView({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = body.split(/\r?\n/);
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
      </ul>,
    );
    listItems = [];
  };

  const flushCode = () => {
    blocks.push(<pre key={`code-${blocks.length}`}><code>{codeLines.join('\n')}</code></pre>);
    codeLines = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCode) flushCode();
      else flushList();
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!trimmed) {
      flushList();
      return;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }
    flushList();
    if (trimmed.startsWith('### ')) blocks.push(<h4 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(4))}</h4>);
    else if (trimmed.startsWith('## ')) blocks.push(<h3 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(3))}</h3>);
    else if (trimmed.startsWith('# ')) blocks.push(<h2 key={blocks.length}>{renderInlineMarkdown(trimmed.slice(2))}</h2>);
    else if (trimmed.startsWith('> ')) blocks.push(<blockquote key={blocks.length}>{renderInlineMarkdown(trimmed.slice(2))}</blockquote>);
    else blocks.push(<p key={blocks.length}>{renderInlineMarkdown(trimmed)}</p>);
  });
  if (inCode) flushCode();
  flushList();
  return <div className="markdownBody">{blocks.length ? blocks : <p className="muted">No note body yet.</p>}</div>;
}

function NotesPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const labels = visibleLabels(state);
  const notes = visibleNotes(state);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labelId, setLabelId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [readerIndex, setReaderIndex] = useState<number | null>(null);
  const filtered = notes.filter((note) => {
    const haystack = `${note.title} ${note.body}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const selectedNote = selectedNoteId ? notes.find((note) => note.id === selectedNoteId) : undefined;

  const onMarkdownFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    actions.createNote(titleFromMarkdownFile(file, text), text, labelId);
    event.target.value = '';
  };

  if (readerIndex !== null) {
    return (
      <NoteReader
        notes={filtered.length ? filtered : notes}
        index={readerIndex}
        setIndex={setReaderIndex}
        onClose={() => setReaderIndex(null)}
      />
    );
  }

  if (selectedNote) {
    return <NoteEditor note={selectedNote} labels={labels} state={state} actions={actions} onClose={() => setSelectedNoteId('')} />;
  }

  return (
    <section className="notesLayout">
      <Panel title="New note">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            actions.createNote(title, body, labelId);
            setTitle('');
            setBody('');
          }}
        >
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Note title" />
          <textarea className="input textArea" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Summaries, formulas, essay plans, tricky ideas..." />
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="">No label</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>{label.name}</option>
            ))}
          </select>
          <div className="buttonRow">
            <button className="primaryButton">Save note</button>
            <label className="fileButton">
              Import .md
              <input type="file" accept=".md,text/markdown,text/plain" onChange={onMarkdownFile} />
            </label>
          </div>
        </form>
      </Panel>
      <Panel
        title="Study notes"
        action={
          <div className="panelActions">
            <button className="secondaryButton" onClick={() => setReaderIndex(0)} disabled={filtered.length === 0}>
              Read
            </button>
            <input className="input searchInput" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
          </div>
        }
      >
        <div className="noteGrid">
          {filtered.map((note) => (
            <NoteCard key={note.id} note={note} state={state} actions={actions} onOpen={() => setSelectedNoteId(note.id)} />
          ))}
          {filtered.length === 0 && <p className="muted">No notes yet. Add one for a topic you want to remember.</p>}
        </div>
      </Panel>
    </section>
  );
}

function NoteReader({
  notes,
  index,
  setIndex,
  onClose,
}: {
  notes: StudyNote[];
  index: number;
  setIndex: (index: number) => void;
  onClose: () => void;
}) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, notes.length - 1));
  const note = notes[safeIndex];
  const [turn, setTurn] = useState(0);

  const go = (nextIndex: number) => {
    setTurn((value) => value + 1);
    setIndex(Math.min(Math.max(nextIndex, 0), Math.max(0, notes.length - 1)));
  };

  if (!note) {
    return (
      <section className="noteFocus">
        <button className="ghostButton" onClick={onClose}>Back to notes</button>
        <p className="muted">No notes to read yet.</p>
      </section>
    );
  }

  return (
    <section className="readerShell">
      <div className="readerToolbar">
        <div>
          <p className="eyebrow">Reading notes</p>
          <h2>{note.title}</h2>
        </div>
        <div className="buttonRow">
          <button className="secondaryButton" onClick={() => downloadText(`${filenameSafe(note.title)}.md`, `# ${note.title}\n\n${note.body}`)}>
            Export .md
          </button>
          <button className="ghostButton" onClick={onClose}>Back to notes</button>
        </div>
      </div>
      <article className="readerBook" key={`${note.id}-${turn}`}>
        <MarkdownView body={note.body} />
      </article>
      <div className="readerControls">
        <button className="secondaryButton" onClick={() => go(safeIndex - 1)} disabled={safeIndex === 0}>Previous note</button>
        <span className="muted smallText">{safeIndex + 1} of {notes.length}</span>
        <button className="secondaryButton" onClick={() => go(safeIndex + 1)} disabled={safeIndex >= notes.length - 1}>Next note</button>
      </div>
    </section>
  );
}

function NoteEditor({
  note,
  labels,
  state,
  actions,
  onClose,
}: {
  note: StudyNote;
  labels: Label[];
  state: AppState;
  actions: AppActions;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [labelId, setLabelId] = useState(note.labelId || '');
  const label = note.labelId ? state.labels.find((item) => item.id === note.labelId) : undefined;

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setLabelId(note.labelId || '');
  }, [note.body, note.id, note.labelId, note.title]);

  const save = () => {
    actions.updateNote(note.id, { title, body, labelId });
    actions.notify('Note updated', title.trim() || 'Untitled note', 'success');
  };

  return (
    <section className="noteFocus">
      <div className="noteFocusHeader">
        <div>
          <p className="eyebrow">Focused note</p>
          <h2>{note.title}</h2>
          <p className="muted">
            {label ? `${label.name} - ` : ''}Updated {formatDateTime(note.updatedAt)}
          </p>
        </div>
        <div className="buttonRow">
          <button className="secondaryButton" onClick={save}>Save changes</button>
          <button className="ghostButton" onClick={onClose}>Back to notes</button>
        </div>
      </div>
      <Panel title="Edit note">
        <label className="fieldLabel">
          Title
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="fieldLabel">
          Note
          <textarea className="input textArea noteEditorText" value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <div className="markdownPreview">
          <MarkdownView body={body} />
        </div>
        <label className="fieldLabel">
          Label
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="">No label</option>
            {labels.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="buttonRow">
          <button className="primaryButton" onClick={save}>Save</button>
          <button className="secondaryButton" onClick={() => actions.updateNote(note.id, { pinned: !note.pinned })}>
            {note.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="secondaryButton" onClick={() => downloadText(`${filenameSafe(title)}.md`, `# ${title.trim() || 'Untitled note'}\n\n${body}`)}>
            Export .md
          </button>
          <button className="dangerButton" onClick={() => { actions.deleteNote(note.id); onClose(); }}>Archive</button>
        </div>
      </Panel>
    </section>
  );
}

function NoteCard({ note, state, actions, onOpen }: { note: StudyNote; state: AppState; actions: AppActions; onOpen: () => void }) {
  const label = note.labelId ? state.labels.find((item) => item.id === note.labelId) : undefined;
  return (
    <article className="noteCard noteCardClickable" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen()}>
      <div className="noteCardHeader">
        <strong>{note.title}</strong>
        <button className="textButton" onClick={(event) => { event.stopPropagation(); actions.updateNote(note.id, { pinned: !note.pinned }); }}>
          {note.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
      <p>{note.body || 'No body yet.'}</p>
      <div className="itemFooter">
        {label && <span className="labelBadge" style={{ borderColor: label.color }}>{label.name}</span>}
        <span className="muted smallText">Updated {formatDateTime(note.updatedAt)}</span>
        <button className="textButton dangerText" onClick={(event) => { event.stopPropagation(); actions.deleteNote(note.id); }}>Archive</button>
      </div>
    </article>
  );
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function FlashcardCreator({
  state,
  actions,
  subjects,
  notes,
  allCards,
  subjectId,
  labelId,
}: {
  state: AppState;
  actions: AppActions;
  subjects: StudySubject[];
  notes: StudyNote[];
  allCards: Flashcard[];
  subjectId: string;
  labelId: string;
}) {
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [includeNotes, setIncludeNotes] = useState(false);

  const generateCards = async () => {
    const subject = subjects.find((item) => item.id === subjectId) || activeSubject(state);
    const prompt = aiPrompt.trim() || `Create revision flashcards for ${subject?.name || 'my subject'}.`;
    setGenerating(true);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `${prompt}\nCreate exactly 5 revision flashcards. Return only JSON like [{"front":"question","back":"answer"}].`,
            },
          ],
          profile: {
            displayName: state.profile.displayName,
            qualification: subject?.qualification || '',
            examBoard: subject?.examBoard || '',
            subject: subject?.name || '',
            targetGrade: subject?.targetGrade || '',
            examDate: subject?.examDate || '',
          },
          context: {
            recentNotes: includeNotes ? notes.slice(0, 8).map((note) => ({ title: note.title, body: note.body.slice(0, 1200) })) : [],
            existingFlashcards: allCards.slice(0, 12).map((card) => ({ front: card.front, back: card.back })),
          },
        }),
      });
      const data = await readAiResponse(response);
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      const text = String(data.reply || '');
      const jsonText = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
      const parsed = JSON.parse(jsonText) as Array<{ front?: unknown; back?: unknown }>;
      actions.createFlashcards(parsed.map((card) => ({
        front: String(card.front || ''),
        back: String(card.back || ''),
        subjectId: subject?.id,
      })));
    } catch (error) {
      actions.notify('Could not create flashcards', error instanceof Error ? error.message : 'The AI response was not valid flashcard JSON.', 'danger');
    } finally {
      setGenerating(false);
    }
  };

  const generateNote = async () => {
    const subject = subjects.find((item) => item.id === subjectId) || activeSubject(state);
    const prompt = aiPrompt.trim();
    if (!prompt) {
      actions.notify('Prompt needed', 'Describe the note you want the AI to create.', 'warning');
      return;
    }
    setGenerating(true);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Create a concise study note in Markdown from this prompt: ${prompt}. Use headings, bullet points, and bold key terms where useful.`,
            },
          ],
          profile: {
            displayName: state.profile.displayName,
            qualification: subject?.qualification || '',
            examBoard: subject?.examBoard || '',
            subject: subject?.name || '',
            targetGrade: subject?.targetGrade || '',
            examDate: subject?.examDate || '',
          },
          context: {
            recentNotes: includeNotes ? notes.slice(0, 6).map((note) => ({ title: note.title, body: note.body.slice(0, 900) })) : [],
            existingFlashcards: allCards.slice(0, 8).map((card) => ({ front: card.front, back: card.back })),
          },
        }),
      });
      const data = await readAiResponse(response);
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      actions.createNote(`AI note: ${prompt.slice(0, 48)}`, String(data.reply || 'No note generated.'), labelId);
    } catch (error) {
      actions.notify('Could not create note', error instanceof Error ? error.message : 'The AI note request failed.', 'danger');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Panel title="AI creator">
      <label className="fieldLabel">
        Prompt
        <textarea className="input textArea flashcardInput" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Make flashcards on AQA Biology infection and response, or create a note explaining completing the square..." />
      </label>
      <label className="checkRow aiOptionRow">
        <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} />
        <span>Use my saved notes as extra context</span>
      </label>
      <div className="buttonRow">
        <button className="primaryButton" onClick={generateCards} disabled={generating}>
          {generating ? 'Creating...' : 'Create flashcards'}
        </button>
        <button className="secondaryButton" onClick={generateNote} disabled={generating}>
          Create note
        </button>
      </div>
    </Panel>
  );
}

function FlashcardStudy({
  subjects,
  allCards,
  studySubjectId,
  setStudySubjectId,
}: {
  subjects: StudySubject[];
  allCards: Flashcard[];
  studySubjectId: string;
  setStudySubjectId: (id: string) => void;
}) {
  const [studyIndex, setStudyIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [studyFullscreen, setStudyFullscreen] = useState(false);
  const cards = allCards.filter((card) => !studySubjectId || card.subjectId === studySubjectId);
  const currentCard = cards[Math.min(studyIndex, Math.max(0, cards.length - 1))];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.code === 'Space' && currentCard) {
        event.preventDefault();
        setFlipped((value) => !value);
      }
      if (event.key === 'ArrowRight' && currentCard) {
        setStudyIndex((value) => Math.min(cards.length - 1, value + 1));
        setFlipped(false);
      }
      if (event.key === 'ArrowLeft' && currentCard) {
        setStudyIndex((value) => Math.max(0, value - 1));
        setFlipped(false);
      }
      if (event.key === 'Escape') setStudyFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards.length, currentCard?.id]);

  useEffect(() => {
    setStudyIndex(0);
    setFlipped(false);
  }, [studySubjectId]);

  return (
    <>
      {studyFullscreen && currentCard && (
        <FlashcardFullscreen
          card={currentCard}
          flipped={flipped}
          setFlipped={setFlipped}
          index={Math.min(studyIndex + 1, cards.length)}
          total={cards.length}
          onPrev={() => { setStudyIndex(Math.max(0, studyIndex - 1)); setFlipped(false); }}
          onNext={() => { setStudyIndex(Math.min(cards.length - 1, studyIndex + 1)); setFlipped(false); }}
          onClose={() => setStudyFullscreen(false)}
        />
      )}
      <Panel title="Study mode">
        <label className="fieldLabel">
          Study subject
          <select className="input" value={studySubjectId} onChange={(event) => setStudySubjectId(event.target.value)}>
            <option value="">All cards</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </label>
        {currentCard ? (
          <>
            <button className={flipped ? 'flashcardStudy flashcardStudyBack' : 'flashcardStudy'} onClick={() => setFlipped(!flipped)}>
              <span>{flipped ? 'Back' : 'Front'}</span>
              <strong>{flipped ? currentCard.back : currentCard.front}</strong>
              <small>Click or press Space to flip. Arrow keys move through the deck.</small>
            </button>
            <div className="buttonRow center">
              <button className="secondaryButton" onClick={() => { setStudyIndex(Math.max(0, studyIndex - 1)); setFlipped(false); }}>Previous</button>
              <span className="muted smallText">{Math.min(studyIndex + 1, cards.length)} of {cards.length}</span>
              <button className="secondaryButton" onClick={() => { setStudyIndex(Math.min(cards.length - 1, studyIndex + 1)); setFlipped(false); }}>Next</button>
              <button className="primaryButton" onClick={() => setStudyFullscreen(true)}>Fullscreen</button>
            </div>
          </>
        ) : (
          <p className="muted">Create a card or ask the AI to make cards from a prompt.</p>
        )}
      </Panel>
    </>
  );
}

function FlashcardDeck({
  allCards,
  subjects,
  actions,
  editCard,
}: {
  allCards: Flashcard[];
  subjects: StudySubject[];
  actions: AppActions;
  editCard: (card: Flashcard) => void;
}) {
  return (
    <Panel title="Card deck">
      <div className="flashcardGrid">
        {allCards.map((card) => {
          const subject = card.subjectId ? subjects.find((item) => item.id === card.subjectId) : undefined;
          return (
            <article className="flashcardMini" key={card.id}>
              <strong>{card.front}</strong>
              <p>{card.back}</p>
              <div className="itemFooter">
                {subject && <span className="labelBadge">{subject.name}</span>}
                <button className="textButton" onClick={() => editCard(card)}>Edit</button>
                <button className="textButton dangerText" onClick={() => actions.deleteFlashcard(card.id)}>Archive</button>
              </div>
            </article>
          );
        })}
        {allCards.length === 0 && <p className="muted">Your deck is empty. One good question is enough to start.</p>}
      </div>
    </Panel>
  );
}

function FlashcardEditor({
  front,
  setFront,
  back,
  setBack,
  subjectId,
  setSubjectId,
  labelId,
  setLabelId,
  editingId,
  resetForm,
  saveCard,
  subjects,
  labels,
}: {
  front: string;
  setFront: (value: string) => void;
  back: string;
  setBack: (value: string) => void;
  subjectId: string;
  setSubjectId: (value: string) => void;
  labelId: string;
  setLabelId: (value: string) => void;
  editingId: string;
  resetForm: () => void;
  saveCard: () => void;
  subjects: StudySubject[];
  labels: Label[];
}) {
  return (
    <Panel title={editingId ? 'Edit flashcard' : 'New flashcard'}>
      <label className="fieldLabel">
        Front
        <textarea className="input textArea flashcardInput" value={front} onChange={(event) => setFront(event.target.value)} placeholder="Question, prompt, term, or quote..." />
      </label>
      <label className="fieldLabel">
        Back
        <textarea className="input textArea flashcardInput" value={back} onChange={(event) => setBack(event.target.value)} placeholder="Answer, explanation, mark-scheme point..." />
      </label>
      <div className="fieldGridTwo">
        <label className="fieldLabel">
          Subject
          <select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            <option value="">General</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </label>
        <label className="fieldLabel">
          Label
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="">No label</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>{label.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="buttonRow">
        <button className="primaryButton" onClick={saveCard}>{editingId ? 'Save card' : 'Add card'}</button>
        {editingId && <button className="ghostButton" onClick={resetForm}>Cancel edit</button>}
      </div>
    </Panel>
  );
}

function FlashcardsPage({ state, actions }: { state: AppState; actions: AppActions }) {
  const labels = visibleLabels(state);
  const subjects = visibleSubjects(state);
  const notes = visibleNotes(state);
  const allCards = visibleFlashcards(state);

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [subjectId, setSubjectId] = useState(state.profile.aiTutor.activeSubjectId);
  const [labelId, setLabelId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [studySubjectId, setStudySubjectId] = useState(state.profile.aiTutor.activeSubjectId);

  const resetForm = () => {
    setFront('');
    setBack('');
    setLabelId('');
    setEditingId('');
  };

  const saveCard = () => {
    if (editingId) actions.updateFlashcard(editingId, { front, back, subjectId, labelId });
    else actions.createFlashcard(front, back, subjectId, labelId);
    resetForm();
  };

  const editCard = (card: Flashcard) => {
    setEditingId(card.id);
    setFront(card.front);
    setBack(card.back);
    setSubjectId(card.subjectId || '');
    setLabelId(card.labelId || '');
  };

  return (
    <section className="stack">
      <div className="flashcardHero">
        <div>
          <p className="eyebrow">Flashcards</p>
          <h2>Test recall without leaving your flow.</h2>
          <p className="muted">Press Space to flip the study card. Ask AI from a prompt, with notes optional.</p>
        </div>
      </div>

      <FlashcardCreator
        state={state}
        actions={actions}
        subjects={subjects}
        notes={notes}
        allCards={allCards}
        subjectId={subjectId}
        labelId={labelId}
      />

      <div className="splitGrid">
        <FlashcardEditor
          front={front}
          setFront={setFront}
          back={back}
          setBack={setBack}
          subjectId={subjectId}
          setSubjectId={setSubjectId}
          labelId={labelId}
          setLabelId={setLabelId}
          editingId={editingId}
          resetForm={resetForm}
          saveCard={saveCard}
          subjects={subjects}
          labels={labels}
        />

        <FlashcardStudy
          subjects={subjects}
          allCards={allCards}
          studySubjectId={studySubjectId}
          setStudySubjectId={setStudySubjectId}
        />
      </div>

      <FlashcardDeck
        allCards={allCards}
        subjects={subjects}
        actions={actions}
        editCard={editCard}
      />
    </section>
  );
}

function FlashcardFullscreen({
  card,
  flipped,
  setFlipped,
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  card: Flashcard;
  flipped: boolean;
  setFlipped: (flipped: boolean | ((value: boolean) => boolean)) => void;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <div className="studyFullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen flashcard study mode">
      <div className="studyFullscreenTop">
        <strong>{index} of {total}</strong>
        <button className="ghostButton" onClick={onClose}>Close</button>
      </div>
      <button className={flipped ? 'flashcardFullscreenCard flashcardStudyBack' : 'flashcardFullscreenCard'} onClick={() => setFlipped((value) => !value)}>
        <span>{flipped ? 'Back' : 'Front'}</span>
        <strong>{flipped ? card.back : card.front}</strong>
        <small>Space flips. Arrow keys move.</small>
      </button>
      <div className="studyFullscreenControls">
        <button className="secondaryButton" onClick={onPrev}>Previous</button>
        <button className="primaryButton" onClick={() => setFlipped((value) => !value)}>Flip</button>
        <button className="secondaryButton" onClick={onNext}>Next</button>
      </div>
    </div>
  );
}

function SubjectManager({ state, actions }: { state: AppState; actions: AppActions }) {
  const subjects = visibleSubjects(state);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({
    name: '',
    qualification: '',
    examBoard: '',
    targetGrade: '',
    examDate: '',
  });
  const editingSubject = editingId ? subjects.find((subject) => subject.id === editingId) : undefined;

  useEffect(() => {
    if (!editingSubject) return;
    setDraft({
      name: editingSubject.name,
      qualification: editingSubject.qualification,
      examBoard: editingSubject.examBoard,
      targetGrade: editingSubject.targetGrade,
      examDate: editingSubject.examDate,
    });
  }, [editingSubject?.id]);

  const resetDraft = () => {
    setEditingId('');
    setDraft({ name: '', qualification: '', examBoard: '', targetGrade: '', examDate: '' });
  };

  const save = () => {
    if (editingId) actions.updateSubject(editingId, draft);
    else actions.createSubject(draft);
    resetDraft();
  };

  return (
    <div className="subjectManager">
      <label className="fieldLabel">
        Active subject
        <select className="input" value={state.profile.aiTutor.activeSubjectId} onChange={(event) => actions.setActiveSubject(event.target.value)}>
          <option value="">General study</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>{subject.name}</option>
          ))}
        </select>
      </label>
      <div className="fieldGridTwo">
        <label className="fieldLabel">
          Subject
          <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Biology, Maths, English Literature..." />
        </label>
        <label className="fieldLabel">
          Qualification
          <input className="input" value={draft.qualification} onChange={(event) => setDraft({ ...draft, qualification: event.target.value })} placeholder="GCSE, A level, BTEC..." />
        </label>
        <label className="fieldLabel">
          Exam board
          <input className="input" value={draft.examBoard} onChange={(event) => setDraft({ ...draft, examBoard: event.target.value })} placeholder="AQA, Edexcel, OCR, WJEC..." />
        </label>
        <label className="fieldLabel">
          Target grade
          <input className="input" value={draft.targetGrade} onChange={(event) => setDraft({ ...draft, targetGrade: event.target.value })} placeholder="Grade 8, A*, Distinction..." />
        </label>
        <label className="fieldLabel">
          Exam date
          <input className="input" value={draft.examDate} onChange={(event) => setDraft({ ...draft, examDate: event.target.value })} placeholder="June 2026, Paper 1 next week..." />
        </label>
      </div>
      <div className="buttonRow">
        <button className="primaryButton" onClick={save}>{editingId ? 'Save subject' : 'Add subject'}</button>
        {editingId && <button className="ghostButton" onClick={resetDraft}>Cancel edit</button>}
      </div>
      <div className="subjectList">
        {subjects.map((subject) => (
          <article className="subjectCard" key={subject.id}>
            <div>
              <strong>{subject.name}</strong>
              <span>{[subject.qualification, subject.examBoard, subject.targetGrade].filter(Boolean).join(' - ') || 'No exam details yet'}</span>
            </div>
            <div className="buttonRow">
              <button className="textButton" onClick={() => actions.setActiveSubject(subject.id)}>Use</button>
              <button className="textButton" onClick={() => setEditingId(subject.id)}>Edit</button>
              <button className="textButton dangerText" onClick={() => actions.deleteSubject(subject.id)}>Archive</button>
            </div>
          </article>
        ))}
        {subjects.length === 0 && <p className="muted">Add each subject once, then switch between them when you chat.</p>}
      </div>
    </div>
  );
}

function AssistantPage({
  state,
  actions,
  setPage,
}: {
  state: AppState;
  actions: AppActions;
  setPage: (page: Page) => void;
}) {
  const sessions = visibleSessions(state);
  const tasks = visibleTasks(state);
  const notes = visibleNotes(state);
  const totals = studyTotals(sessions);
  const streak = computeStreak(sessions);
  const quests = dailyQuests(state);
  const nextQuest = quests.find((quest) => !quest.completed);
  const openTasks = tasks.filter((task) => !task.done);
  const tutor = activeSubject(state);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Tell me what you are studying, or ask for a revision plan, explanation, quiz, essay structure, or exam technique help.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const suggestions = [
    totals.todaySec < 25 * 60 ? 'Start with a 25 minute focus block to complete today’s Focus bloom quest.' : 'You already hit a good focus base today. A short review block would lock it in.',
    openTasks.length ? `Pick "${openTasks[0].text}" as the next task and attach it to a timer.` : 'Add one small task before your next session so the timer has a clear target.',
    notes.length ? `Review your latest note, "${notes[0].title}", before starting.` : 'Create a note after your next session with three things you learned.',
    streak.current > 0 ? `Protect your ${streak.current} day streak with a tiny session if energy is low.` : 'Begin a new streak today with one focused minute.',
  ];

  const sendMessage = async (text = input) => {
    const clean = text.trim();
    if (!clean || sending) return;
    const nextMessages = [...messages, { role: 'user' as const, content: clean }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    const flashcards = visibleFlashcards(state);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${import.meta.env.VITE_API_AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          messages: nextMessages,
          profile: {
            displayName: state.profile.displayName,
            qualification: tutor?.qualification || '',
            examBoard: tutor?.examBoard || '',
            subject: tutor?.name || '',
            targetGrade: tutor?.targetGrade || '',
            examDate: tutor?.examDate || '',
          },
          context: {
            todayStudy: formatDuration(totals.todaySec),
            weekStudy: formatDuration(totals.weekSec),
            streakDays: streak.current,
            openTasks: openTasks.slice(0, 8).map((task) => ({ text: task.text, notes: task.notes })),
            recentNotes: notes.slice(0, 6).map((note) => ({ title: note.title, body: note.body.slice(0, 900) })),
            flashcards: flashcards
              .filter((card) => !tutor || card.subjectId === tutor.id || !card.subjectId)
              .slice(0, 16)
              .map((card) => ({ front: card.front, back: card.back })),
            dailyQuests: quests.map((quest) => ({ title: quest.title, completed: quest.completed })),
          },
        }),
      });
      const data = await readAiResponse(response);
      if (!response.ok) throw new Error(data?.error || 'AI request failed.');
      setMessages([...nextMessages, { role: 'assistant', content: data.reply || 'I could not generate a response.' }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The AI assistant could not respond.';
      setMessages([...nextMessages, { role: 'assistant', content: `I could not reach the AI model: ${message}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="assistantLayout">
      <div className="assistantHero">
        <p className="eyebrow">AI study assistant</p>
        <h2>Exam-aware revision help</h2>
        <p>{tutor ? `${tutor.name}${tutor.qualification ? ` - ${tutor.qualification}` : ''}${tutor.examBoard ? ` - ${tutor.examBoard}` : ''}` : 'Add your subjects so the assistant can tailor its advice.'}</p>
        <div className="buttonRow">
          <button className="primaryButton" onClick={() => setPage('timer')}>Start timer</button>
          <button className="secondaryButton" onClick={() => setPage('notes')}>Open notes</button>
          <button className="secondaryButton" onClick={() => setPage('flashcards')}>Open flashcards</button>
        </div>
      </div>
      <Panel title="Subjects">
        <SubjectManager state={state} actions={actions} />
      </Panel>
      <Panel title="Chat">
        <div className="chatBox">
          {messages.map((message, index) => (
            <div className={message.role === 'assistant' ? 'chatBubble chatBubbleAssistant' : 'chatBubble chatBubbleUser'} key={`${message.role}-${index}`}>
              <strong>{message.role === 'assistant' ? 'Bloomora AI' : 'You'}</strong>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
        <form
          className="chatComposer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea className="input chatInput" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask for a revision plan, quiz, explanation, flashcards, or exam technique help..." />
          <button className="primaryButton" disabled={sending}>{sending ? 'Thinking...' : 'Send'}</button>
        </form>
        <div className="promptChips">
          {['Quiz me from my flashcards', 'Make me a 7 day revision plan', 'Explain this like I am stuck', 'Make exam-style questions'].map((prompt) => (
            <button className="secondaryButton" key={prompt} onClick={() => void sendMessage(prompt)} disabled={sending}>{prompt}</button>
          ))}
        </div>
      </Panel>
      <div className="splitGrid">
        <Panel title="Suggested plan">
          <div className="assistantList">
            {suggestions.map((item) => <p key={item}>{item}</p>)}
          </div>
        </Panel>
        <Panel title="Quick actions">
          <div className="assistantList">
            <button className="secondaryButton" onClick={() => actions.addTask('Review weakest topic', 'Generated by assistant')}>Add review task</button>
            <button className="secondaryButton" onClick={() => actions.createNote('Session reflection', 'What went well? What felt hard? What should I do next?')}>Create reflection note</button>
            <button className="secondaryButton" onClick={() => actions.harvestFruits()}>Check harvest</button>
          </div>
        </Panel>
      </div>
      <Panel title="Today’s context">
        <div className="metricGrid metricGridCompact">
          <MetricCard title="Today" value={formatDuration(totals.todaySec)} detail="Saved focus time" />
          <MetricCard title="Open tasks" value={String(openTasks.length)} detail="Ready to attach" />
          <MetricCard title="Notes" value={String(notes.length)} detail="Saved study notes" />
          <MetricCard title="Quest" value={nextQuest ? nextQuest.title : 'Complete'} detail={nextQuest ? nextQuest.detail : 'All daily quests done'} />
        </div>
      </Panel>
    </section>
  );
}

function PersistentMusicPlayer({ state, actions, open }: { state: AppState; actions: AppActions; open: boolean }) {
  const videoId = state.profile.music.lofiVideoId.trim();
  if (!videoId) return null;

  return (
    <aside className={open ? 'musicDock musicDockOpen' : 'musicDock'} aria-label="Music player">
      <div className="musicMiniHeader">
        <strong>Music</strong>
        <input
          className="input musicMiniInput"
          value={videoId}
          onChange={(event) => actions.updateProfile({ music: { ...state.profile.music, lofiVideoId: event.target.value.trim() } })}
          aria-label="YouTube video ID"
        />
      </div>
      <div className="musicFrame musicMiniFrame">
        <iframe title="LoFi music" src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`} allow="autoplay; encrypted-media; picture-in-picture" />
      </div>
    </aside>
  );
}

function ArchivePage({ state, actions }: { state: AppState; actions: AppActions }) {
  const archived = [
    ...state.notes.filter((item) => item.deletedAt).map((item) => ({
      kind: 'note' as const,
      id: item.id,
      title: item.title,
      detail: item.body.slice(0, 180) || 'Archived note',
      updatedAt: item.updatedAt,
    })),
    ...state.sessions.filter((item) => item.deletedAt).map((item) => ({
      kind: 'session' as const,
      id: item.id,
      title: `${formatDuration(item.durationSec)} study session`,
      detail: `${labelName(state, item)} - ${formatDateTime(item.endAt)}${item.note ? ` - ${item.note}` : ''}`,
      updatedAt: item.updatedAt,
    })),
    ...state.flashcards.filter((item) => item.deletedAt).map((item) => ({
      kind: 'flashcard' as const,
      id: item.id,
      title: item.front,
      detail: item.back,
      updatedAt: item.updatedAt,
    })),
    ...state.tasks.filter((item) => item.deletedAt).map((item) => ({
      kind: 'task' as const,
      id: item.id,
      title: item.text,
      detail: item.notes || 'Archived task',
      updatedAt: item.updatedAt,
    })),
    ...state.labels.filter((item) => item.deletedAt).map((item) => ({
      kind: 'label' as const,
      id: item.id,
      title: item.name,
      detail: 'Archived label',
      updatedAt: item.updatedAt,
    })),
    ...state.subjects.filter((item) => item.deletedAt).map((item) => ({
      kind: 'subject' as const,
      id: item.id,
      title: item.name,
      detail: [item.qualification, item.examBoard, item.targetGrade].filter(Boolean).join(' - ') || 'Archived subject',
      updatedAt: item.updatedAt,
    })),
  ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return (
    <section className="stack">
      <div className="flashcardHero">
        <div>
          <p className="eyebrow">Archive</p>
          <h2>Review hidden Bloomora items.</h2>
          <p className="muted">Restore something you still need, or permanently delete it when you are sure.</p>
        </div>
      </div>
      <Panel title="Archived items">
        <div className="archiveList">
          {archived.map((item) => (
            <article className="archiveItem" key={`${item.kind}-${item.id}`}>
              <div>
                <span className="labelBadge">{item.kind}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small className="muted">Archived {formatDateTime(item.updatedAt)}</small>
              </div>
              <div className="buttonRow">
                <button className="secondaryButton" onClick={() => actions.restoreArchived(item.kind, item.id)}>
                  Restore
                </button>
                <button className="dangerButton" onClick={() => void actions.permanentlyDeleteArchived(item.kind, item.id)}>
                  Delete forever
                </button>
              </div>
            </article>
          ))}
          {archived.length === 0 && <p className="muted">Nothing archived yet.</p>}
        </div>
      </Panel>
    </section>
  );
}

function SettingsProfilePanel({ state, actions }: { state: AppState; actions: AppActions }) {
  const onBackgroundFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      actions.notify('Choose an image', 'Use a JPG, PNG, WebP, or GIF background.', 'warning');
      event.target.value = '';
      return;
    }
    if (file.size > 2_500_000) {
      actions.notify('Image is too large', 'Choose an image under 2.5 MB so Bloomora stays quick to sync.', 'warning');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      actions.updateProfile({ backgroundImage: typeof reader.result === 'string' ? reader.result : undefined });
      actions.notify('Background updated', file.name, 'success');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  return (
    <Panel title="Study profile">
      <label className="fieldLabel">
        Display name
        <input className="input" value={state.profile.displayName} onChange={(event) => actions.updateProfile({ displayName: event.target.value })} />
      </label>
      <label className="fieldLabel">
        Weekly goal hours
        <input
          className="input"
          type="number"
          min={0}
          max={80}
          value={state.profile.weeklyGoalHours}
          onChange={(event) => actions.updateProfile({ weeklyGoalHours: Math.max(0, Number(event.target.value)) })}
        />
      </label>
      <label className="fieldLabel">
        Daily goal minutes
        <input
          className="input"
          type="number"
          min={1}
          max={1440}
          value={state.profile.dailyGoalMinutes}
          onChange={(event) => actions.updateProfile({ dailyGoalMinutes: Math.min(1440, Math.max(1, Number(event.target.value))) })}
        />
      </label>
      <label className="fieldLabel">
        Theme
        <select className="input" value={state.profile.theme} onChange={(event) => actions.setTheme(event.target.value as ThemeName)}>
          <option value="daybreak">Daybreak</option>
          <option value="grove">Grove</option>
          <option value="aqua">Aqua</option>
          <option value="ink">Ink</option>
        </select>
      </label>
      <label className="fieldLabel">
        Light or dark
        <select className="input" value={state.profile.colorMode} onChange={(event) => actions.setColorMode(event.target.value as ColorMode)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="fieldLabel">
        Require label for timer
        <select
          className="input"
          value={state.profile.timerRequireLabel ? 'yes' : 'no'}
          onChange={(event) => actions.updateProfile({ timerRequireLabel: event.target.value === 'yes' })}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      <label className="fieldLabel">
        Website background
        <span className="backgroundPicker">
          <label className="fileButton">
            Import image
            <input type="file" accept="image/*" onChange={onBackgroundFile} />
          </label>
          {state.profile.backgroundImage && (
            <button className="ghostButton" onClick={() => actions.updateProfile({ backgroundImage: undefined })}>
              Clear image
            </button>
          )}
        </span>
      </label>
      <label className="fieldLabel">
        Hide AI Tutor button
        <select
          className="input"
          value={state.profile.hideAiTutor ? 'yes' : 'no'}
          onChange={(event) => actions.updateProfile({ hideAiTutor: event.target.value === 'yes' })}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      <label className="fieldLabel">
        Hide sidebar items
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {NAV_ITEMS.filter(item => !['dashboard', 'timer', 'settings'].includes(item.id)).map(item => {
            const isHidden = state.profile.hiddenSidebarItems?.includes(item.id);
            return (
              <label key={item.id} className="checkRow" style={{ background: 'var(--surface-strong)', padding: '6px 12px', borderRadius: '100px' }}>
                <input
                  type="checkbox"
                  checked={isHidden}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...(state.profile.hiddenSidebarItems || []), item.id]
                      : (state.profile.hiddenSidebarItems || []).filter(id => id !== item.id);
                    actions.updateProfile({ hiddenSidebarItems: next });
                  }}
                />
                {item.label}
              </label>
            );
          })}
        </div>
      </label>
    </Panel>
  );
}

function SettingsTimersPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  return (
    <Panel title="Timers and sound">
      <div className="fieldGridTwo">
        <label className="fieldLabel">
          Focus minutes
          <input className="input" type="number" min={1} max={180} value={state.profile.pomodoro.focusMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...state.profile.pomodoro, focusMin: Number(event.target.value) } })} />
        </label>
        <label className="fieldLabel">
          Break minutes
          <input className="input" type="number" min={1} max={60} value={state.profile.pomodoro.shortBreakMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...state.profile.pomodoro, shortBreakMin: Number(event.target.value) } })} />
        </label>
        <label className="fieldLabel">
          Long break
          <input className="input" type="number" min={1} max={120} value={state.profile.pomodoro.longBreakMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...state.profile.pomodoro, longBreakMin: Number(event.target.value) } })} />
        </label>
        <label className="fieldLabel">
          Long every
          <input className="input" type="number" min={2} max={12} value={state.profile.pomodoro.longEvery} onChange={(event) => actions.updateProfile({ pomodoro: { ...state.profile.pomodoro, longEvery: Number(event.target.value) } })} />
        </label>
      </div>
      <label className="fieldLabel">
        Ambient while studying
        <select className="input" value={state.profile.sessionAmbient.type} onChange={(event) => actions.updateProfile({ sessionAmbient: { ...state.profile.sessionAmbient, type: event.target.value as AppState['profile']['sessionAmbient']['type'] } })}>
          <option value="off">Off</option>
          <option value="fire">Fire</option>
          <option value="wind">Wind</option>
          <option value="sea">Sea</option>
          <option value="nature">Nature</option>
        </select>
      </label>
    </Panel>
  );
}

function SettingsMusicPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  return (
    <Panel title="Music">
      <label className="fieldLabel">
        YouTube video ID
        <input className="input" value={state.profile.music.lofiVideoId} onChange={(event) => actions.updateProfile({ music: { ...state.profile.music, lofiVideoId: event.target.value.trim() } })} />
      </label>
      <p className="muted">The mini player stays loaded while you move around Bloomora.</p>
    </Panel>
  );
}

function SettingsBackupPanel({ state, actions }: { state: AppState; actions: AppActions }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = validateImportText(text);
    if ('error' in result) {
      actions.notify('Import failed', result.error, 'danger');
      setPreview(null);
      return;
    }
    setPreview(result);
  };

  return (
    <Panel title="Backup">
      <div className="buttonRow">
        <button className="secondaryButton" onClick={() => downloadJson(`bloomora_v2_${dateKey()}.json`, createExportPayload(state))}>
          Export backup
        </button>
        <label className="fileButton">
          Import backup
          <input type="file" accept="application/json" onChange={onImportFile} />
        </label>
      </div>
      {preview && (
        <div className="importPreview">
          <strong>Ready to import</strong>
          <span>
            {preview.sessions} sessions, {preview.labels} labels, {preview.tasks} tasks, {preview.notes} notes, {preview.flashcards} flashcards, {formatDuration(preview.totalStudySec)} total.
          </span>
          <button className="primaryButton" onClick={() => actions.replaceState(preview.state)}>
            Replace local data
          </button>
        </div>
      )}
      <button className="dangerButton" onClick={() => window.confirm('Reset Bloomora V2 local data?') && actions.resetAll()}>
        Reset V2 data
      </button>
    </Panel>
  );
}

function SettingsSyncPanel({ state, actions, syncConfigured }: { state: AppState; actions: AppActions; syncConfigured: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Panel title="Optional sync">
      <div className="syncStatusBox">
        <strong>{syncConfigured ? state.sync.status : 'Not configured'}</strong>
        <span>{state.sync.userEmail || state.sync.lastError || 'Local data stays on this browser.'}</span>
      </div>
      <div className="fieldGridTwo">
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input className="input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
      </div>
      <div className="buttonRow">
        <button className="secondaryButton" onClick={() => actions.signIn(email, password)}>
          Sign in
        </button>
        <button className="secondaryButton" onClick={() => actions.signUp(email, password)}>
          Create account
        </button>
        <button className="primaryButton" onClick={() => actions.syncNow()}>
          Sync now
        </button>
        <button className="secondaryButton" onClick={() => actions.importLegacyCloudProgress()}>
          Import V1 cloud progress
        </button>
        <button className="ghostButton" onClick={() => actions.signOut()}>
          Sign out
        </button>
      </div>
    </Panel>
  );
}

function SettingsPage({
  state,
  actions,
  syncConfigured,
}: {
  state: AppState;
  actions: AppActions;
  syncConfigured: boolean;
}) {
  return (
    <section className="settingsGrid">
      <SettingsProfilePanel state={state} actions={actions} />
      <SettingsTimersPanel state={state} actions={actions} />
      <SettingsMusicPanel state={state} actions={actions} />
      <SettingsBackupPanel state={state} actions={actions} />
      <SettingsSyncPanel state={state} actions={actions} syncConfigured={syncConfigured} />
    </section>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="metricCard">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="progressTrack" aria-label={`${Math.round(pct)} percent`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  items,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<[T, string]>;
  disabled?: boolean;
}) {
  return (
    <div className="segmented">
      {items.map(([id, label]) => (
        <button
          type="button"
          key={id}
          className={value === id ? 'segment segmentActive' : 'segment'}
          onClick={() => onChange(id)}
          disabled={disabled}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TaskPicker({
  tasks,
  selected,
  setSelected,
  disabled,
}: {
  tasks: StudyTask[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  disabled?: boolean;
}) {
  if (tasks.length === 0) return <p className="muted smallText">No open tasks yet.</p>;
  return (
    <div className="taskPicker">
      {tasks.slice(0, 5).map((task) => (
        <label key={task.id} className="checkRow">
          <input
            type="checkbox"
            checked={selected.includes(task.id)}
            disabled={disabled}
            onChange={(event) =>
              setSelected(event.target.checked ? [...selected, task.id] : selected.filter((id) => id !== task.id))
            }
          />
          <span>{task.text}</span>
        </label>
      ))}
    </div>
  );
}

function SessionList({ sessions, state, actions }: { sessions: StudySession[]; state: AppState; actions: AppActions }) {
  const labels = visibleLabels(state);
  const [editingId, setEditingId] = useState('');
  if (sessions.length === 0) return <p className="muted">No sessions yet. Start with one focused minute.</p>;
  return (
    <div className="sessionList">
      {sessions.map((session) =>
        editingId === session.id ? (
          <SessionEditor key={session.id} session={session} labels={labels} actions={actions} onClose={() => setEditingId('')} />
        ) : (
          <article className="sessionItem" key={session.id}>
            <div>
              <strong>{formatDuration(session.durationSec)}</strong>
              <span>
                {labelName(state, session)} - {formatDateTime(session.endAt)}
              </span>
              {session.note && <p className="muted smallText">{session.note}</p>}
            </div>
            <div className="buttonRow">
              <button className="textButton" onClick={() => setEditingId(session.id)}>
                Edit
              </button>
              <button className="textButton dangerText" onClick={() => actions.deleteSession(session.id)}>
                Archive
              </button>
            </div>
          </article>
        ),
      )}
    </div>
  );
}

function SessionEditor({
  session,
  labels,
  actions,
  onClose,
}: {
  session: StudySession;
  labels: Label[];
  actions: AppActions;
  onClose: () => void;
}) {
  const [labelId, setLabelId] = useState(session.labelId || '');
  const [note, setNote] = useState(session.note || '');

  return (
    <article className="sessionEditor">
      <div className="fieldGridTwo">
        <label className="fieldLabel">
          Label
          <select className="input" value={labelId} onChange={(event) => setLabelId(event.target.value)}>
            <option value="">No label</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>{label.name}</option>
            ))}
          </select>
        </label>
        <label className="fieldLabel">
          What did you do?
          <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Past paper, summary notes, exam questions..." />
        </label>
      </div>
      <div className="buttonRow">
        <button className="primaryButton" onClick={() => { actions.updateSession(session.id, { labelId, note }); onClose(); }}>
          Save session
        </button>
        <button className="ghostButton" onClick={onClose}>Cancel</button>
      </div>
    </article>
  );
}

function TaskRow({ task, state, actions }: { task: StudyTask; state: AppState; actions: AppActions }) {
  const label = task.labelId ? state.labels.find((item) => item.id === task.labelId) : undefined;
  return (
    <article className={task.done ? 'taskRow taskRowDone' : 'taskRow'}>
      <label className="checkRow">
        <input type="checkbox" checked={task.done} onChange={(event) => actions.toggleTask(task.id, event.target.checked)} />
        <span>{task.text}</span>
      </label>
      {task.notes && <p className="muted">{task.notes}</p>}
      <div className="itemFooter">
        {label && <span className="labelBadge" style={{ borderColor: label.color }}>{label.name}</span>}
        <button className="textButton dangerText" onClick={() => actions.deleteTask(task.id)}>
          Archive
        </button>
      </div>
    </article>
  );
}

function ActivityChart({ sessions, days }: { sessions: StudySession[]; days: number }) {
  const start = startOfDayMs() - (days - 1) * 86400000;
  const totals = Array.from({ length: days }, (_, index) => {
    const key = dateKey(addDaysMs(start, index));
    return {
      key,
      sec: sessions.filter((session) => dateKey(session.endAt) === key).reduce((sum, session) => sum + session.durationSec, 0),
    };
  });
  const max = Math.max(...totals.map((item) => item.sec), 1);
  return (
    <div className="activityChart" aria-label="Study activity chart">
      {totals.map((item) => (
        <div className="activityBar" key={item.key} title={`${item.key}: ${formatDuration(item.sec)}`}>
          <span style={{ height: `${Math.max(6, (item.sec / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function HourlyGraph({ sessions }: { sessions: StudySession[] }) {
  const values = new Array<number>(24).fill(0);
  for (const session of sessions) values[new Date(session.endAt).getHours()] += session.durationSec;
  const max = Math.max(...values, 1);
  return (
    <div className="miniBars">
      <div className="miniBarsPlot">
        {values.map((sec, hour) => (
          <div className="miniBarWrap" key={hour} title={`${hour}:00 - ${formatDuration(sec)}`}>
            <span className="miniBar" style={{ height: `${Math.max(4, (sec / max) * 100)}%`, background: `hsl(${170 + hour * 4} 70% 38%)` }} />
          </div>
        ))}
      </div>
      <div className="miniBarsAxis" aria-hidden="true">
        {values.map((_, hour) => (
          <small key={hour}>{hour % 4 === 0 ? hour : ''}</small>
        ))}
      </div>
    </div>
  );
}

function MethodGraph({ sessions }: { sessions: StudySession[] }) {
  const methods: Array<StudySession['method']> = ['stopwatch', 'timer', 'pomodoro', 'manual'];
  const colors = ['#0f766e', '#2563eb', '#be123c', '#7c3aed'];
  const values = methods.map((method) => sessions.filter((session) => session.method === method).reduce((sum, session) => sum + session.durationSec, 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return (
    <div className="methodGraph">
      {methods.map((method, index) => (
        <div className="methodRow" key={method}>
          <span className="methodDot" style={{ background: colors[index] }} />
          <strong>{method}</strong>
          <ProgressBar value={values[index]} max={total} />
          <span>{compactHours(values[index])}</span>
        </div>
      ))}
    </div>
  );
}

function WeekdayGraph({ sessions }: { sessions: StudySession[] }) {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const values = new Array<number>(7).fill(0);
  for (const session of sessions) values[new Date(session.endAt).getDay()] += session.durationSec;
  const max = Math.max(...values, 1);
  return (
    <div className="weekdayScroller">
      <div className="weekdayGrid">
        {labels.map((label, index) => {
          const pct = values[index] / max;
          return (
            <div className="weekdayCell" key={label} style={{ background: `rgba(15, 118, 110, ${0.1 + pct * 0.75})` }}>
              <strong>{label}</strong>
              <span>{formatDuration(values[index])}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UpgradeList({ level }: { level: number }) {
  const upgrades = ['Harbor lights', 'Study cottage', 'Palm grove', 'Reading pier', 'Observatory', 'Festival path'];
  return (
    <div className="upgradeList">
      {upgrades.map((upgrade, index) => (
        <span className={level >= index + 1 ? 'upgradeUnlocked' : ''} key={upgrade}>
          {upgrade}
        </span>
      ))}
    </div>
  );
}

function ToastStack({ toasts, actions }: { toasts: { id: string; title: string; detail?: string; kind: string }[]; actions: AppActions }) {
  return (
    <div className="toastStack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <button className={`toast toast-${toast.kind}`} key={toast.id} onClick={() => actions.dismissToast(toast.id)}>
          <strong>{toast.title}</strong>
          {toast.detail && <span>{toast.detail}</span>}
        </button>
      ))}
    </div>
  );
}

function useAmbientAudio(state: AppState | null) {
  useEffect(() => {
    if (!state?.activeTimer?.running) return undefined;
    const type = state.profile.sessionAmbient.type;
    if (type === 'off') return undefined;
    const audio = new Audio(`/assets/audio/${type}.wav`);
    audio.loop = true;
    audio.volume = state.profile.sessionAmbient.volume;
    void audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [state?.activeTimer?.running, state?.profile.sessionAmbient.type, state?.profile.sessionAmbient.volume]);
}

export default App;



function TimetablePage({ state, actions }: { state: AppState; actions: AppActions }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        const entries: import('./types').TimetableEntry[] = [];
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        let dayColIndices: Record<string, number> = {};

        // Find header row
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(10, data.length); i++) {
          if (data[i] && data[i].some((cell: any) => typeof cell === 'string' && cell.toLowerCase().includes('monday'))) {
            headerRowIdx = i;
            break;
          }
        }

        if (headerRowIdx !== -1) {
          const headerRow = data[headerRowIdx];
          days.forEach(day => {
            const idx = headerRow.findIndex((cell: any) => typeof cell === 'string' && cell.toLowerCase().includes(day.toLowerCase()));
            if (idx !== -1) dayColIndices[day] = idx;
          });

          // Read data
          for (let i = headerRowIdx + 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;

            const timeHr = row[0]; // Assuming first column is time
            if (!timeHr) continue;

            days.forEach(day => {
              const colIdx = dayColIndices[day];
              if (colIdx !== undefined) {
                const cell = row[colIdx];
                if (cell && typeof cell === 'string' && cell.trim() !== '-' && cell.trim() !== '') {
                  entries.push({
                    id: Math.random().toString(36).substring(7),
                    day,
                    timeHr: String(timeHr).trim(),
                    module: cell.trim()
                  });
                }
              }
            });
          }
        }

        if (entries.length > 0) {
          actions.setTimetable({ entries, updatedAt: new Date().toISOString() });
          actions.notify('Timetable imported', `Imported ${entries.length} entries successfully.`, 'success');
        } else {
          actions.notify('Import failed', 'Could not find timetable data in the selected file.', 'danger');
        }
      } catch (err) {
        console.error(err);
        actions.notify('Import failed', 'Error reading the Excel file.', 'danger');
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <section className="stack">
      <Panel title="My Timetable">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <p className="muted">Upload your Excel (.xlsx) timetable to view it here.</p>
          <div>
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <button className="primaryButton" onClick={() => fileInputRef.current?.click()}>
              Import Excel
            </button>
          </div>
        </div>

        {state.timetable?.entries && state.timetable.entries.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  <th style={{ padding: '8px', color: 'var(--muted)' }}>Time</th>
                  {days.map(day => (
                    <th key={day} style={{ padding: '8px', color: 'var(--muted)' }}>{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Find all unique times and sort them simply based on appearance or just show uniquely */}
                {Array.from(new Set(state.timetable.entries.map(e => e.timeHr))).map(time => (
                  <tr key={time} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>{time}</td>
                    {days.map(day => {
                      const entry = state.timetable!.entries.find(e => e.timeHr === time && e.day === day);
                      return (
                        <td key={day} style={{ padding: '8px', verticalAlign: 'top' }}>
                          {entry ? (
                            <div style={{ background: 'var(--surface-strong)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85em' }}>
                              {entry.module}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
            No timetable data yet.
          </div>
        )}
      </Panel>
    </section>
  );
}

function LabelStats({ state }: { state: AppState }) {
  const [timeframe, setTimeframe] = useState<'all' | 'year' | 'month' | 'week' | 'today'>('all');
  const sessions = useMemo(() => visibleSessions(state), [state.sessions]);
  const stats = useMemo(() => studyByLabel(sessions, state.labels, timeframe), [sessions, state.labels, timeframe]);

  const conicStops = useMemo(() => {
    let currentDeg = 0;
    return stats.items.map(item => {
      const degrees = (item.duration / Math.max(1, stats.totalSec)) * 360;
      const stop = `${item.color} ${currentDeg}deg ${currentDeg + degrees}deg`;
      currentDeg += degrees;
      return stop;
    }).join(', ');
  }, [stats]);

  return (
    <Panel title="Study by label">
      <Segmented
        value={timeframe}
        onChange={setTimeframe}
        items={[
          ['all', 'All'],
          ['year', 'Year'],
          ['month', 'Month'],
          ['week', 'Week'],
          ['today', 'Today'],
        ]}
      />
      {stats.totalSec === 0 ? (
        <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No sessions found.</p>
      ) : (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', marginTop: '16px' }}>
          <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: `conic-gradient(${conicStops})`, flexShrink: 0 }}></div>
          <div className="questList" style={{ flexGrow: 1 }}>
            {stats.items.map(item => (
              <div className="questItem" key={item.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: item.color }}></span>
                  <strong>{item.name}</strong>
                </div>
                <span>{formatDuration(item.duration)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
