import { useCallback, useEffect, useState } from 'react';
import type { AppState } from './types';
import { useAppStore, type AppActions, type ToastMessage } from './state/AppStore';
import { ALL_NAV, useRoute, type Page } from './navigation';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { AuthDialog, type AuthMode } from './components/AuthDialog';
import { CommandPalette } from './components/CommandPalette';
import { Icon } from './components/Icon';
import type { PageProps } from './components/study';
import { elapsedForTimer, remainingForTimer } from './lib/timers';
import { formatClock } from './lib/format';
import { useNow } from './lib/hooks';
import { DashboardPage } from './pages/DashboardPage';
import { TimerPage } from './pages/TimerPage';
import { PlanPage } from './pages/PlanPage';
import { DeadlinesPage } from './pages/DeadlinesPage';
import { TimetablePage } from './pages/TimetablePage';
import { SubjectsPage } from './pages/SubjectsPage';
import { NotesPage } from './pages/NotesPage';
import { FlashcardsPage } from './pages/FlashcardsPage';
import { AssistantPage } from './pages/AssistantPage';
import { StatsPage } from './pages/StatsPage';
import { GradesPage } from './pages/GradesPage';
import { ArchivePage } from './pages/ArchivePage';
import { SettingsPage } from './pages/SettingsPage';

const PAGES: Record<Page, (props: PageProps) => React.ReactElement> = {
  dashboard: DashboardPage,
  timer: TimerPage,
  plan: PlanPage,
  deadlines: DeadlinesPage,
  timetable: TimetablePage,
  subjects: SubjectsPage,
  notes: NotesPage,
  flashcards: FlashcardsPage,
  assistant: AssistantPage,
  stats: StatsPage,
  grades: GradesPage,
  archive: ArchivePage,
  settings: SettingsPage,
};

function useDocumentChrome(state: AppState | null, page: Page) {
  const timer = state?.activeTimer;
  const now = useNow(Boolean(timer?.running));

  useEffect(() => {
    if (!state) return;
    const root = document.body;
    root.dataset.theme = state.profile.theme;
    root.dataset.mode = state.profile.colorMode;
    if (state.profile.backgroundImage) {
      root.dataset.customBg = 'on';
      root.style.setProperty('--custom-bg-image', `url("${state.profile.backgroundImage}")`);
    } else {
      delete root.dataset.customBg;
      root.style.removeProperty('--custom-bg-image');
    }
  }, [state?.profile.backgroundImage, state?.profile.colorMode, state?.profile.theme]);

  useEffect(() => {
    const pageTitle = ALL_NAV.find((item) => item.id === page)?.label || 'Bloomora';
    if (timer?.running) {
      const shown = timer.totalSec ? remainingForTimer(timer, now) ?? 0 : elapsedForTimer(timer, now);
      document.title = `${formatClock(shown)} · ${timer.pomodoro?.phase === 'break' ? 'Break' : 'Focus'} — Bloomora`;
    } else {
      document.title = `${pageTitle} — Bloomora`;
    }
  }, [now, page, timer]);
}

function useAmbientAudio(state: AppState | null) {
  useEffect(() => {
    if (!state?.activeTimer?.running || state.activeTimer.pomodoro?.phase === 'break') return undefined;
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
  }, [state?.activeTimer?.running, state?.activeTimer?.pomodoro?.phase, state?.profile.sessionAmbient.type, state?.profile.sessionAmbient.volume]);
}

function ToastStack({ toasts, actions }: { toasts: ToastMessage[]; actions: AppActions }) {
  return (
    <div className="toastStack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.kind}`} key={toast.id} role={toast.kind === 'danger' ? 'alert' : 'status'}>
          <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'info' ? 'clock' : 'alert'} size={16} />
          <div>
            <strong>{toast.title}</strong>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          <button type="button" className="iconButton small" onClick={() => actions.dismissToast(toast.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MusicDock({ state, open, onClose }: { state: AppState; open: boolean; onClose: () => void }) {
  const videoId = state.profile.music.lofiVideoId.trim();
  if (!videoId) return null;
  // The iframe stays mounted while hidden so music keeps playing between pages.
  return (
    <aside className={open ? 'musicDock musicDockOpen' : 'musicDock'} aria-label="Music player" aria-hidden={!open}>
      <div className="musicDockHeader">
        <strong><Icon name="music" size={14} /> Music</strong>
        <button type="button" className="iconButton small" onClick={onClose} aria-label="Hide music player"><Icon name="x" size={14} /></button>
      </div>
      <div className="musicFrame">
        <iframe title="Study music" src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&playsinline=1`} allow="autoplay; encrypted-media; picture-in-picture" />
      </div>
    </aside>
  );
}

function App() {
  const { state, loading, toasts, actions, syncConfigured } = useAppStore();
  const [route, navigate] = useRoute();
  const [mobileNav, setMobileNav] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  useDocumentChrome(state, route.page);
  useAmbientAudio(state);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.page]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeAuth = useCallback(() => setAuthMode(null), []);

  if (loading || !state) {
    return (
      <main className="loadingShell">
        <span className="brandMark">B</span>
        <p>Loading your workspace…</p>
      </main>
    );
  }

  const PageView = PAGES[route.page];

  return (
    <div className={state.profile.sidebarCollapsed ? 'appShell appShellCollapsed' : 'appShell'}>
      <Sidebar
        page={route.page}
        navigate={navigate}
        state={state}
        actions={actions}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
        musicOpen={musicOpen}
        onToggleMusic={() => setMusicOpen((open) => !open)}
      />
      <div className="workspace">
        <TopBar
          state={state}
          actions={actions}
          navigate={navigate}
          syncConfigured={syncConfigured}
          onOpenMenu={() => setMobileNav(true)}
          onOpenSearch={() => setPaletteOpen(true)}
          onAuth={setAuthMode}
        />
        <main className="content" key={route.page}>
          <PageView state={state} actions={actions} navigate={navigate} sub={route.sub} syncConfigured={syncConfigured} openAuth={setAuthMode} />
        </main>
      </div>
      <MusicDock state={state} open={musicOpen} onClose={() => setMusicOpen(false)} />
      {paletteOpen && <CommandPalette state={state} actions={actions} navigate={navigate} onClose={closePalette} />}
      {authMode && <AuthDialog initialMode={authMode} syncConfigured={syncConfigured} actions={actions} onClose={closeAuth} />}
      <ToastStack toasts={toasts} actions={actions} />
    </div>
  );
}

export default App;
