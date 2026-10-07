import { useCallback, useState } from 'react';
import type { AppActions } from '../state/AppStore';
import type { AppState } from '../types';
import type { Navigate } from '../navigation';
import { Icon } from './Icon';
import { Avatar, useDismiss } from './ui';
import { useNow } from '../lib/hooks';
import { elapsedForTimer, remainingForTimer } from '../lib/timers';
import { formatClock, formatDuration } from '../lib/format';
import { activeSubject, educationLabel, visibleFlashcards, visibleNotes, visibleSessions, visibleTasks } from '../lib/selectors';
import { aiProfile, askAi, type ChatMessage } from '../lib/ai';
import { studyTotals } from '../lib/stats';
import type { AuthMode } from './AuthDialog';

function TimerChip({ state, navigate }: { state: AppState; navigate: Navigate }) {
  const timer = state.activeTimer;
  const now = useNow(Boolean(timer?.running));
  if (!timer) {
    return (
      <button type="button" className="secondaryButton topFocusButton" onClick={() => navigate('timer')}>
        <Icon name="timer" size={16} />
        <span>Focus</span>
      </button>
    );
  }
  const remaining = remainingForTimer(timer, now);
  const shown = timer.totalSec ? remaining ?? 0 : elapsedForTimer(timer, now);
  const label = timer.pomodoro?.phase === 'break' ? 'Break' : timer.running ? 'Studying' : 'Paused';
  return (
    <button type="button" className={timer.running ? 'timerChip timerChipRunning' : 'timerChip'} onClick={() => navigate('timer')} title="Open focus timer">
      <span className="timerChipDot" />
      <span className="timerChipLabel">{label}</span>
      <strong>{formatClock(shown)}</strong>
    </button>
  );
}

function AiQuickPanel({ state, navigate, onClose }: { state: AppState; navigate: Navigate; onClose: () => void }) {
  const subject = activeSubject(state);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

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
          openTasks: visibleTasks(state).filter((task) => !task.done).slice(0, 6).map((task) => ({ text: task.text, due: task.dueDate })),
          recentNotes: visibleNotes(state).slice(0, 4).map((note) => ({ title: note.title, body: note.body.slice(0, 700) })),
          flashcards: visibleFlashcards(state).slice(0, 12).map((card) => ({ front: card.front, back: card.back })),
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
    <div className="popover aiPopover" role="dialog" aria-label="Quick AI tutor">
      <div className="popoverHeader">
        <div>
          <strong>Quick question</strong>
          <span>{subject ? subject.name : 'General study'}</span>
        </div>
        <button type="button" className="textButton" onClick={() => { navigate('assistant'); onClose(); }}>Open tutor</button>
      </div>
      <div className="aiPopoverBody">
        {messages.length === 0 ? (
          <p className="muted smallText">Ask for an explanation, a quick quiz or a worked example. Your active subject, notes and tasks are used as context.</p>
        ) : (
          messages.map((message, index) => (
            <div className={message.role === 'assistant' ? 'chatBubble chatBubbleAssistant' : 'chatBubble chatBubbleUser'} key={index}>
              <p>{message.content}</p>
            </div>
          ))
        )}
        {sending && <p className="muted smallText">Thinking…</p>}
      </div>
      <form className="aiPopoverComposer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask anything…" autoFocus />
        <button className="primaryButton iconOnly" disabled={sending || !input.trim()} aria-label="Send">
          <Icon name="send" size={16} />
        </button>
      </form>
    </div>
  );
}

function ProfileMenu({
  state,
  actions,
  navigate,
  syncConfigured,
  onAuth,
  onClose,
}: {
  state: AppState;
  actions: AppActions;
  navigate: Navigate;
  syncConfigured: boolean;
  onAuth: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const signedIn = Boolean(state.sync.enabled && state.sync.userEmail);
  const go = (sub: string) => {
    navigate('settings', sub);
    onClose();
  };
  const subtitle = [state.profile.course, state.profile.institution].filter(Boolean).join(' · ') || educationLabel(state.profile.educationLevel);
  const syncLine = !syncConfigured
    ? 'Saved on this device'
    : signedIn
      ? state.sync.status === 'syncing'
        ? 'Syncing…'
        : state.sync.status === 'error'
          ? 'Sync problem — open account settings'
          : state.sync.lastSyncAt
            ? `Synced ${new Date(state.sync.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Signed in'
      : 'Not signed in · saved on this device';

  return (
    <div className="popover profileMenu" role="menu" aria-label="Profile menu">
      <div className="profileMenuHeader">
        <Avatar name={state.profile.displayName} image={state.profile.avatarImage} size={44} />
        <div>
          <strong>{state.profile.displayName || 'Student'}</strong>
          <span>{state.sync.userEmail || subtitle}</span>
          {state.sync.userEmail && <span>{subtitle}</span>}
        </div>
      </div>
      <div className={`syncLine sync-${signedIn ? state.sync.status : 'local'}`}>
        <Icon name={signedIn ? 'cloud' : 'cloudOff'} size={14} />
        <span>{syncLine}</span>
      </div>
      <div className="menuSection">
        <button type="button" role="menuitem" className="menuItem" onClick={() => go('profile')}>
          <Icon name="user" /> Profile
        </button>
        <button type="button" role="menuitem" className="menuItem" onClick={() => go('account')}>
          <Icon name="cloud" /> Account &amp; sync
        </button>
        <button type="button" role="menuitem" className="menuItem" onClick={() => go('general')}>
          <Icon name="settings" /> Settings
        </button>
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={state.profile.colorMode === 'dark'}
          className="menuItem"
          onClick={() => actions.setColorMode(state.profile.colorMode === 'dark' ? 'light' : 'dark')}
        >
          <Icon name={state.profile.colorMode === 'dark' ? 'sun' : 'moon'} />
          {state.profile.colorMode === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
      <div className="menuSection">
        {signedIn ? (
          <>
            <button type="button" role="menuitem" className="menuItem" onClick={() => void actions.syncNow()} disabled={state.sync.status === 'syncing'}>
              <Icon name="sync" /> Sync now
            </button>
            <button type="button" role="menuitem" className="menuItem" onClick={() => { void actions.signOut(); onClose(); }}>
              <Icon name="logout" /> Sign out
            </button>
          </>
        ) : (
          <>
            <button type="button" role="menuitem" className="menuItem" onClick={() => { onAuth('signin'); onClose(); }}>
              <Icon name="login" /> Sign in
            </button>
            <button type="button" role="menuitem" className="menuItem" onClick={() => { onAuth('signup'); onClose(); }}>
              <Icon name="user" /> Create account
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function TopBar({
  state,
  actions,
  navigate,
  syncConfigured,
  onOpenMenu,
  onOpenSearch,
  onAuth,
}: {
  state: AppState;
  actions: AppActions;
  navigate: Navigate;
  syncConfigured: boolean;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onAuth: (mode: AuthMode) => void;
}) {
  const [menu, setMenu] = useState<'profile' | 'ai' | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const profileRef = useDismiss(menu === 'profile', close);
  const aiRef = useDismiss(menu === 'ai', close);
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <header className="topBar">
      <button type="button" className="iconButton mobileMenuButton" onClick={onOpenMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <button type="button" className="searchTrigger" onClick={onOpenSearch}>
        <Icon name="search" size={16} />
        <span>Search or jump to…</span>
        <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="topActions">
        <TimerChip state={state} navigate={navigate} />
        {!state.profile.hideAiTutor && (
          <div className="popoverAnchor" ref={aiRef}>
            <button
              type="button"
              className={menu === 'ai' ? 'iconButton iconButtonActive' : 'iconButton'}
              onClick={() => setMenu(menu === 'ai' ? null : 'ai')}
              aria-expanded={menu === 'ai'}
              aria-label="Quick AI tutor"
              title="Quick AI tutor"
            >
              <Icon name="sparkles" />
            </button>
            {menu === 'ai' && <AiQuickPanel state={state} navigate={navigate} onClose={close} />}
          </div>
        )}
        <div className="popoverAnchor" ref={profileRef}>
          <button
            type="button"
            className="profileButton"
            onClick={() => setMenu(menu === 'profile' ? null : 'profile')}
            aria-expanded={menu === 'profile'}
            aria-haspopup="menu"
            aria-label="Open profile menu"
          >
            <Avatar name={state.profile.displayName} image={state.profile.avatarImage} size={32} />
            {state.sync.enabled && state.sync.userEmail && <span className={`presenceDot sync-${state.sync.status}`} />}
          </button>
          {menu === 'profile' && (
            <ProfileMenu state={state} actions={actions} navigate={navigate} syncConfigured={syncConfigured} onAuth={onAuth} onClose={close} />
          )}
        </div>
      </div>
    </header>
  );
}
