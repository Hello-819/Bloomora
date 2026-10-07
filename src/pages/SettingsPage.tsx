import { useState, type ChangeEvent } from 'react';
import type { AmbientType, EducationLevel, ThemeName } from '../types';
import type { PageProps } from '../components/study';
import { Avatar, Field, PageHeader, Panel, Segmented, Toggle } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { HIDEABLE_PAGES } from '../navigation';
import { EDUCATION_LEVELS, educationLabel } from '../lib/selectors';
import { avatarFromFile } from '../lib/files';
import { createExportPayload, downloadJson, validateImportText, type ImportPreview } from '../lib/exportImport';
import { formatDateTime, formatDuration } from '../lib/format';
import { dateKey } from '../lib/dates';

type Tab = 'profile' | 'account' | 'general' | 'study' | 'navigation' | 'data';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'account', label: 'Account & sync', icon: 'cloud' },
  { id: 'general', label: 'Appearance', icon: 'sun' },
  { id: 'study', label: 'Study & timer', icon: 'timer' },
  { id: 'navigation', label: 'Navigation', icon: 'panel' },
  { id: 'data', label: 'Data & backup', icon: 'download' },
];

const THEMES: Array<{ id: ThemeName; label: string; color: string }> = [
  { id: 'daybreak', label: 'Indigo', color: '#4f46e5' },
  { id: 'aqua', label: 'Teal', color: '#0e7490' },
  { id: 'grove', label: 'Green', color: '#15803d' },
  { id: 'ink', label: 'Graphite', color: '#334155' },
];

function ProfileTab({ state, actions }: PageProps) {
  const profile = state.profile;
  const [busy, setBusy] = useState(false);

  const onAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      actions.notify('Choose an image', 'Use a JPG, PNG, WebP or GIF file.', 'warning');
      return;
    }
    if (file.size > 10_000_000) {
      actions.notify('Image is too large', 'Choose an image under 10 MB.', 'warning');
      return;
    }
    setBusy(true);
    try {
      actions.updateProfile({ avatarImage: await avatarFromFile(file) });
      actions.notify('Profile photo updated', undefined, 'success');
    } catch (error) {
      actions.notify('Could not use that image', error instanceof Error ? error.message : undefined, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const university = profile.educationLevel === 'university' || profile.educationLevel === 'postgraduate';

  return (
    <>
      <Panel title="Profile photo" description="Shown in the top-right corner. Images are cropped to a square and resized.">
        <div className="avatarEditor">
          <Avatar name={profile.displayName} image={profile.avatarImage} size={88} />
          <div className="buttonRow">
            <label className="secondaryButton fileButton">
              <Icon name="upload" size={16} /> {busy ? 'Processing…' : profile.avatarImage ? 'Change photo' : 'Upload photo'}
              <input type="file" accept="image/*" onChange={onAvatar} disabled={busy} />
            </label>
            {profile.avatarImage && (
              <button className="ghostButton" onClick={() => actions.updateProfile({ avatarImage: undefined })}>Remove</button>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="About you" description="Used to personalise the dashboard, wording, grade classifications and AI tutor answers.">
        <div className="formGrid">
          <Field label="Display name">
            <input className="input" value={profile.displayName} onChange={(event) => actions.updateProfile({ displayName: event.target.value.slice(0, 60) })} />
          </Field>
          <Field label="Stage of study">
            <select className="input" value={profile.educationLevel} onChange={(event) => actions.updateProfile({ educationLevel: event.target.value as EducationLevel })}>
              {EDUCATION_LEVELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label={university ? 'University' : 'School or college'}>
            <input className="input" value={profile.institution} onChange={(event) => actions.updateProfile({ institution: event.target.value.slice(0, 120) })} placeholder={university ? 'University of Leeds' : 'Hills Road Sixth Form College'} />
          </Field>
          <Field label={university ? 'Degree programme' : 'Course'}>
            <input className="input" value={profile.course} onChange={(event) => actions.updateProfile({ course: event.target.value.slice(0, 120) })} placeholder={university ? 'BSc Computer Science' : 'A levels: Maths, Physics, Chemistry'} />
          </Field>
          <Field label="Year">
            <input className="input" value={profile.yearOfStudy} onChange={(event) => actions.updateProfile({ yearOfStudy: event.target.value.slice(0, 40) })} placeholder={university ? 'Year 2' : 'Year 13'} />
          </Field>
        </div>
      </Panel>
    </>
  );
}

function AccountTab({ state, actions, syncConfigured, openAuth }: PageProps) {
  const signedIn = Boolean(state.sync.enabled && state.sync.userEmail);
  if (!syncConfigured) {
    return (
      <Panel title="Account & sync">
        <div className="callout">
          <Icon name="cloudOff" />
          <div>
            <strong>Saved on this device only</strong>
            <p>This deployment has no sync service configured, so Bloomora keeps everything in this browser. Use <em>Data &amp; backup</em> to move data between devices.</p>
          </div>
        </div>
      </Panel>
    );
  }
  if (!signedIn) {
    return (
      <Panel title="Account & sync">
        <div className="accountCard">
          <span className="emptyIcon"><Icon name="cloud" size={22} /></span>
          <div>
            <strong>You are not signed in</strong>
            <p>Your data is saved in this browser. Sign in to back it up and keep your phone, laptop and college computers in sync.</p>
          </div>
          <div className="buttonRow">
            <button className="primaryButton" onClick={() => openAuth('signin')}>Sign in</button>
            <button className="secondaryButton" onClick={() => openAuth('signup')}>Create account</button>
          </div>
        </div>
        {state.sync.lastError && <p className="formError">{state.sync.lastError}</p>}
      </Panel>
    );
  }
  return (
    <Panel title="Account & sync">
      <div className="accountCard">
        <Avatar name={state.profile.displayName} image={state.profile.avatarImage} size={48} />
        <div>
          <strong>{state.sync.userEmail}</strong>
          <p className={`syncLine sync-${state.sync.status}`}>
            <Icon name={state.sync.status === 'error' ? 'alert' : 'cloud'} size={14} />
            {state.sync.status === 'syncing'
              ? 'Syncing…'
              : state.sync.status === 'error'
                ? state.sync.lastError || 'Sync failed'
                : state.sync.lastSyncAt ? `Last synced ${formatDateTime(state.sync.lastSyncAt)}` : 'Not synced yet'}
          </p>
        </div>
        <div className="buttonRow">
          <button className="primaryButton" onClick={() => void actions.syncNow()} disabled={state.sync.status === 'syncing'}><Icon name="sync" size={16} /> Sync now</button>
          <button className="ghostButton" onClick={() => void actions.signOut()}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      </div>
      <div className="settingsRow">
        <div>
          <strong>Import from Bloomora V1</strong>
          <p>Bring sessions and labels from the original Bloomora cloud tables into this account.</p>
        </div>
        <button className="secondaryButton" onClick={() => void actions.importLegacyCloudProgress()}>Import</button>
      </div>
    </Panel>
  );
}

function AppearanceTab({ state, actions }: PageProps) {
  const onBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      actions.notify('Choose an image', 'Use a JPG, PNG, WebP or GIF background.', 'warning');
      return;
    }
    if (file.size > 2_500_000) {
      actions.notify('Image is too large', 'Choose an image under 2.5 MB so Bloomora stays fast to sync.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => actions.updateProfile({ backgroundImage: typeof reader.result === 'string' ? reader.result : undefined });
    reader.readAsDataURL(file);
  };

  return (
    <Panel title="Appearance">
      <div className="settingsRow">
        <div><strong>Mode</strong><p>Light or dark interface.</p></div>
        <Segmented value={state.profile.colorMode} onChange={(mode) => actions.setColorMode(mode)} label="Colour mode" items={[['light', 'Light'], ['dark', 'Dark']]} />
      </div>
      <div className="settingsRow">
        <div><strong>Accent colour</strong><p>Used for buttons, charts and highlights.</p></div>
        <div className="themeRow" role="radiogroup" aria-label="Accent colour">
          {THEMES.map((theme) => (
            <button
              type="button"
              key={theme.id}
              role="radio"
              aria-checked={state.profile.theme === theme.id}
              className={state.profile.theme === theme.id ? 'themeSwatch themeSwatchActive' : 'themeSwatch'}
              onClick={() => actions.setTheme(theme.id)}
            >
              <span style={{ background: theme.color }} />
              {theme.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settingsRow">
        <div><strong>Background image</strong><p>Shown softly behind the app. Keep it subtle so text stays readable.</p></div>
        <div className="buttonRow">
          <label className="secondaryButton fileButton">
            <Icon name="upload" size={16} /> Choose image
            <input type="file" accept="image/*" onChange={onBackground} />
          </label>
          {state.profile.backgroundImage && <button className="ghostButton" onClick={() => actions.updateProfile({ backgroundImage: undefined })}>Remove</button>}
        </div>
      </div>
      <Toggle
        checked={Boolean(state.profile.sidebarCollapsed)}
        onChange={(checked) => actions.updateProfile({ sidebarCollapsed: checked })}
        label="Compact sidebar"
        description="Show only icons in the sidebar on larger screens."
      />
    </Panel>
  );
}

function StudyTab({ state, actions }: PageProps) {
  const profile = state.profile;
  const pomodoro = profile.pomodoro;
  const num = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Number(value) || min));
  return (
    <>
      <Panel title="Goals" description="Used for progress bars on the overview and the goal line on charts.">
        <div className="formGrid">
          <Field label="Daily goal (minutes)">
            <input className="input" type="number" min={1} max={1440} value={profile.dailyGoalMinutes} onChange={(event) => actions.updateProfile({ dailyGoalMinutes: num(event.target.value, 1, 1440) })} />
          </Field>
          <Field label="Weekly goal (hours)">
            <input className="input" type="number" min={1} max={100} value={profile.weeklyGoalHours} onChange={(event) => actions.updateProfile({ weeklyGoalHours: num(event.target.value, 1, 100) })} />
          </Field>
        </div>
      </Panel>
      <Panel title="Pomodoro">
        <div className="formGrid four">
          <Field label="Focus (min)">
            <input className="input" type="number" min={1} max={180} value={pomodoro.focusMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...pomodoro, focusMin: num(event.target.value, 1, 180) } })} />
          </Field>
          <Field label="Short break">
            <input className="input" type="number" min={1} max={60} value={pomodoro.shortBreakMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...pomodoro, shortBreakMin: num(event.target.value, 1, 60) } })} />
          </Field>
          <Field label="Long break">
            <input className="input" type="number" min={1} max={120} value={pomodoro.longBreakMin} onChange={(event) => actions.updateProfile({ pomodoro: { ...pomodoro, longBreakMin: num(event.target.value, 1, 120) } })} />
          </Field>
          <Field label="Long break every">
            <input className="input" type="number" min={2} max={12} value={pomodoro.longEvery} onChange={(event) => actions.updateProfile({ pomodoro: { ...pomodoro, longEvery: num(event.target.value, 2, 12) } })} />
          </Field>
        </div>
        <Toggle checked={profile.timerRequireLabel} onChange={(checked) => actions.updateProfile({ timerRequireLabel: checked })} label="Require a label" description="Ask for a label before a timer can start, so every session is categorised." />
      </Panel>
      <Panel title="Sound">
        <div className="formGrid">
          <Field label="Ambient sound during sessions">
            <select className="input" value={profile.sessionAmbient.type} onChange={(event) => actions.updateProfile({ sessionAmbient: { ...profile.sessionAmbient, type: event.target.value as AmbientType } })}>
              <option value="off">Off</option>
              <option value="nature">Nature</option>
              <option value="sea">Sea</option>
              <option value="wind">Wind</option>
              <option value="fire">Fireplace</option>
            </select>
          </Field>
          <Field label={`Volume (${Math.round(profile.sessionAmbient.volume * 100)}%)`}>
            <input type="range" min={0} max={1} step={0.05} value={profile.sessionAmbient.volume} onChange={(event) => actions.updateProfile({ sessionAmbient: { ...profile.sessionAmbient, volume: Number(event.target.value) } })} />
          </Field>
          <Field label="Music player (YouTube video ID)" hint="Leave empty to hide the music player.">
            <input className="input" value={profile.music.lofiVideoId} onChange={(event) => actions.updateProfile({ music: { ...profile.music, lofiVideoId: event.target.value.trim() } })} placeholder="e.g. jfKfPfyJRdk" />
          </Field>
        </div>
      </Panel>
    </>
  );
}

function NavigationTab({ state, actions }: PageProps) {
  const hidden = state.profile.hiddenSidebarItems || [];
  return (
    <Panel title="Navigation" description="Hide pages you do not use. Hidden pages stay reachable from “more” in the sidebar and from search.">
      <div className="toggleList">
        {HIDEABLE_PAGES.map((item) => (
          <Toggle
            key={item.id}
            checked={!hidden.includes(item.id)}
            onChange={(visible) => actions.updateProfile({ hiddenSidebarItems: visible ? hidden.filter((id) => id !== item.id) : [...hidden, item.id] })}
            label={item.label}
            description={item.description}
          />
        ))}
      </div>
      <Toggle
        checked={!state.profile.hideAiTutor}
        onChange={(visible) => actions.updateProfile({ hideAiTutor: !visible })}
        label="Quick AI button"
        description="Show the AI shortcut in the top bar."
      />
    </Panel>
  );
}

function DataTab({ state, actions }: PageProps) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = validateImportText(await file.text());
    if ('error' in result) {
      actions.notify('Import failed', result.error, 'danger');
      setPreview(null);
      return;
    }
    setPreview(result);
  };

  return (
    <>
      <Panel title="Backup" description="A backup is a single JSON file with everything in Bloomora.">
        <div className="settingsRow">
          <div><strong>Export</strong><p>Download a copy of all your data.</p></div>
          <button className="secondaryButton" onClick={() => downloadJson(`bloomora_backup_${dateKey()}.json`, createExportPayload(state))}><Icon name="download" size={16} /> Export backup</button>
        </div>
        <div className="settingsRow">
          <div><strong>Restore</strong><p>Replace the data on this device with a backup file.</p></div>
          <label className="secondaryButton fileButton">
            <Icon name="upload" size={16} /> Choose file
            <input type="file" accept="application/json,.json" onChange={onImport} />
          </label>
        </div>
        {preview && (
          <div className="callout callout-warning">
            <Icon name="alert" />
            <div>
              <strong>Ready to restore</strong>
              <p>
                {preview.sessions} sessions ({formatDuration(preview.totalStudySec)}), {preview.tasks} tasks, {preview.notes} notes, {preview.flashcards} flashcards,
                {' '}{preview.subjects} subjects, {preview.deadlines} deadlines and {preview.assessments} results. This replaces what is on this device.
              </p>
              <div className="buttonRow">
                <button className="primaryButton" onClick={() => { actions.replaceState(preview.state); setPreview(null); }}>Replace my data</button>
                <button className="ghostButton" onClick={() => setPreview(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Danger zone" className="panelDanger">
        <div className="settingsRow">
          <div><strong>Reset this device</strong><p>Permanently delete all Bloomora data in this browser. Synced data in your account is not affected.</p></div>
          <button className="dangerButton" onClick={() => window.confirm('Delete all Bloomora data on this device? This cannot be undone.') && void actions.resetAll()}>Reset data</button>
        </div>
      </Panel>
    </>
  );
}

export function SettingsPage(props: PageProps) {
  const { sub, navigate, state } = props;
  const tab: Tab = TABS.some((item) => item.id === sub) ? (sub as Tab) : 'profile';
  return (
    <div className="page">
      <PageHeader title="Settings" description={`${state.profile.displayName} · ${educationLabel(state.profile.educationLevel)}`} />
      <div className="settingsLayout">
        <nav className="settingsNav" aria-label="Settings sections">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? 'settingsNavItem settingsNavItemActive' : 'settingsNavItem'}
              onClick={() => navigate('settings', item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settingsContent">
          {tab === 'profile' && <ProfileTab {...props} />}
          {tab === 'account' && <AccountTab {...props} />}
          {tab === 'general' && <AppearanceTab {...props} />}
          {tab === 'study' && <StudyTab {...props} />}
          {tab === 'navigation' && <NavigationTab {...props} />}
          {tab === 'data' && <DataTab {...props} />}
        </div>
      </div>
    </div>
  );
}
