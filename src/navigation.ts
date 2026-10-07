import { useEffect, useState } from 'react';
import type { IconName } from './components/Icon';

export type Page =
  | 'dashboard'
  | 'timer'
  | 'plan'
  | 'deadlines'
  | 'timetable'
  | 'subjects'
  | 'notes'
  | 'flashcards'
  | 'assistant'
  | 'stats'
  | 'grades'
  | 'archive'
  | 'settings';

export interface NavItem {
  id: Page;
  label: string;
  icon: IconName;
  description: string;
}

export const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: '',
    items: [{ id: 'dashboard', label: 'Overview', icon: 'home', description: 'Your day at a glance' }],
  },
  {
    title: 'Plan',
    items: [
      { id: 'timer', label: 'Focus', icon: 'timer', description: 'Run a timed study session' },
      { id: 'plan', label: 'Tasks', icon: 'tasks', description: 'To-dos with due dates and priorities' },
      { id: 'deadlines', label: 'Deadlines', icon: 'deadline', description: 'Assignments, coursework and exams' },
      { id: 'timetable', label: 'Timetable', icon: 'calendar', description: 'Your weekly classes and lectures' },
    ],
  },
  {
    title: 'Learn',
    items: [
      { id: 'subjects', label: 'Subjects', icon: 'book', description: 'Subjects, modules and exam dates' },
      { id: 'notes', label: 'Notes', icon: 'notes', description: 'Markdown study notes' },
      { id: 'flashcards', label: 'Flashcards', icon: 'cards', description: 'Spaced-repetition review' },
      { id: 'assistant', label: 'AI Tutor', icon: 'sparkles', description: 'Ask questions about your work' },
    ],
  },
  {
    title: 'Progress',
    items: [
      { id: 'stats', label: 'Insights', icon: 'chart', description: 'Study time analytics' },
      { id: 'grades', label: 'Grades', icon: 'grades', description: 'Marks and weighted averages' },
    ],
  },
];

export const FOOTER_NAV: NavItem[] = [
  { id: 'archive', label: 'Archive', icon: 'archive', description: 'Restore or delete archived items' },
  { id: 'settings', label: 'Settings', icon: 'settings', description: 'Profile, account and preferences' },
];

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((group) => group.items), ...FOOTER_NAV];

/** Pages that can be hidden from the sidebar in settings. */
export const HIDEABLE_PAGES = ALL_NAV.filter((item) => !['dashboard', 'timer', 'settings'].includes(item.id));

export interface Route {
  page: Page;
  sub: string;
}

function parseHash(): Route {
  const [raw = '', ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  const page = ALL_NAV.some((item) => item.id === raw) ? (raw as Page) : 'dashboard';
  return { page, sub: decodeURIComponent(rest.join('/')) };
}

export type Navigate = (page: Page, sub?: string) => void;

export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate: Navigate = (page, sub = '') => {
    const next = sub ? `/${page}/${encodeURIComponent(sub)}` : `/${page}`;
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setRoute({ page, sub });
  };
  return [route, navigate];
}
