import { useState } from 'react';
import type { AppActions } from '../state/AppStore';
import type { AppState } from '../types';
import { FOOTER_NAV, NAV_GROUPS, type Navigate, type NavItem, type Page } from '../navigation';
import { Icon } from './Icon';
import { ProgressBar } from './ui';
import { studyTotals } from '../lib/stats';
import { formatDuration } from '../lib/format';
import { visibleSessions } from '../lib/selectors';

export function Sidebar({
  page,
  navigate,
  state,
  actions,
  mobileOpen,
  onCloseMobile,
  musicOpen,
  onToggleMusic,
}: {
  page: Page;
  navigate: Navigate;
  state: AppState;
  actions: AppActions;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  musicOpen: boolean;
  onToggleMusic: () => void;
}) {
  const hidden = new Set(state.profile.hiddenSidebarItems || []);
  const collapsed = Boolean(state.profile.sidebarCollapsed) && !mobileOpen;
  const [showHidden, setShowHidden] = useState(false);
  const totals = studyTotals(visibleSessions(state));
  const dailyGoalSec = Math.max(60, state.profile.dailyGoalMinutes * 60);
  const hiddenItems = [...NAV_GROUPS.flatMap((group) => group.items), ...FOOTER_NAV].filter((item) => hidden.has(item.id) && item.id !== 'settings');

  const go = (id: Page) => {
    navigate(id);
    onCloseMobile();
  };

  const renderItem = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className={page === item.id ? 'navItem navItemActive' : 'navItem'}
      onClick={() => go(item.id)}
      title={collapsed ? item.label : undefined}
      aria-current={page === item.id ? 'page' : undefined}
    >
      <Icon name={item.icon} />
      <span className="navLabel">{item.label}</span>
    </button>
  );

  return (
    <>
      {mobileOpen && <div className="sidebarScrim" onClick={onCloseMobile} />}
      <aside className={['sidebar', collapsed ? 'sidebarCollapsed' : '', mobileOpen ? 'sidebarMobileOpen' : ''].join(' ')}>
        <div className="sidebarTop">
          <button type="button" className="brand" onClick={() => go('dashboard')} aria-label="Bloomora overview">
            <span className="brandMark">B</span>
            <span className="brandText">Bloomora</span>
          </button>
          <button
            type="button"
            className="iconButton sidebarCollapseButton"
            onClick={() => (mobileOpen ? onCloseMobile() : actions.updateProfile({ sidebarCollapsed: !state.profile.sidebarCollapsed }))}
            aria-label={mobileOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={mobileOpen ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name={mobileOpen ? 'x' : 'panel'} />
          </button>
        </div>

        <nav className="sidebarNav" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !hidden.has(item.id));
            if (!items.length) return null;
            return (
              <div className="navGroup" key={group.title || 'home'}>
                {group.title && <span className="navGroupTitle">{group.title}</span>}
                {items.map(renderItem)}
              </div>
            );
          })}
          {hiddenItems.length > 0 && (
            <div className="navGroup">
              <button type="button" className="navItem navItemMuted" onClick={() => setShowHidden((value) => !value)} aria-expanded={showHidden}>
                <Icon name="more" />
                <span className="navLabel">{showHidden ? 'Fewer pages' : `${hiddenItems.length} more`}</span>
              </button>
              {showHidden && hiddenItems.map(renderItem)}
            </div>
          )}
        </nav>

        <div className="sidebarFooter">
          {!collapsed && (
            <button type="button" className="goalCard" onClick={() => go('stats')}>
              <span className="goalCardRow">
                <span>Today</span>
                <strong>{formatDuration(totals.todaySec)} <small>/ {formatDuration(dailyGoalSec)}</small></strong>
              </span>
              <ProgressBar value={totals.todaySec} max={dailyGoalSec} tone={totals.todaySec >= dailyGoalSec ? 'success' : 'default'} />
            </button>
          )}
          {state.profile.music.lofiVideoId && (
            <button type="button" className={musicOpen ? 'navItem navItemActive' : 'navItem'} onClick={onToggleMusic} title={collapsed ? 'Music' : undefined}>
              <Icon name="music" />
              <span className="navLabel">{musicOpen ? 'Hide music' : 'Music'}</span>
            </button>
          )}
          {FOOTER_NAV.filter((item) => !hidden.has(item.id)).map(renderItem)}
        </div>
      </aside>
    </>
  );
}
