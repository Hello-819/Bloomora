import type { Navigate, Page } from '../navigation';
import { Icon, type IconName } from './Icon';

const TABS: Array<{ id: Page; label: string; icon: IconName }> = [
  { id: 'dashboard', label: 'Home', icon: 'home' },
  { id: 'timer', label: 'Focus', icon: 'timer' },
  { id: 'plan', label: 'Tasks', icon: 'tasks' },
  { id: 'flashcards', label: 'Cards', icon: 'cards' },
];

/** Bottom tab bar shown on phone-sized screens; "More" opens the full sidebar. */
export function MobileTabs({ page, navigate, onMore }: { page: Page; navigate: Navigate; onMore: () => void }) {
  const inTabs = TABS.some((tab) => tab.id === page);
  return (
    <nav className="mobileTabs" aria-label="Quick navigation">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={page === tab.id ? 'mobileTab mobileTabActive' : 'mobileTab'}
          onClick={() => navigate(tab.id)}
          aria-current={page === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={20} />
          <span>{tab.label}</span>
        </button>
      ))}
      <button type="button" className={inTabs ? 'mobileTab' : 'mobileTab mobileTabActive'} onClick={onMore}>
        <Icon name="menu" size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
