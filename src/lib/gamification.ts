import type { AppState, GamificationState, StudySession, StudyTask } from '../types';
import { dateKey, startOfDayMs, startOfWeekMs } from './dates';

export const ISLAND_LEVEL_SEC = 5 * 3600;
export const TREE_STAGES = [
  { id: 'seed', name: 'Seed', minSec: 0, asset: '/assets/images/v2/plant_seed.svg' },
  { id: 'sprout', name: 'Sprout', minSec: 20 * 60, asset: '/assets/images/v2/plant_sprout.svg' },
  { id: 'plant', name: 'Plant', minSec: 50 * 60, asset: '/assets/images/v2/plant_plant.svg' },
  { id: 'sapling', name: 'Sapling', minSec: 90 * 60, asset: '/assets/images/v2/plant_sapling.svg' },
  { id: 'tree', name: 'Tree', minSec: 2 * 3600, asset: '/assets/images/v2/plant_tree.svg' },
] as const;
export const FRUIT_RATE_SEC = 45 * 60;

export const ACHIEVEMENTS = [
  { id: 'first-session', title: 'First bloom', detail: 'Save your first study session.' },
  { id: 'one-hour', title: 'One-hour roots', detail: 'Study for one total hour.' },
  { id: 'five-hour-island', title: 'Island rises', detail: 'Reach Island level 1.' },
  { id: 'three-day-streak', title: 'Three-day spark', detail: 'Study on three days in a row.' },
  { id: 'ten-sessions', title: 'Ten-session rhythm', detail: 'Save ten study sessions.' },
  { id: 'fruit-harvest', title: 'First harvest', detail: 'Harvest fruit from your garden.' },
] as const;

export function computeIslandLevel(totalSec: number) {
  const level = Math.floor(Math.max(0, totalSec) / ISLAND_LEVEL_SEC);
  const inLevel = Math.max(0, totalSec) - level * ISLAND_LEVEL_SEC;
  const pct = Math.min(100, Math.floor((inLevel / ISLAND_LEVEL_SEC) * 100));
  return {
    level,
    pct,
    remainingSec: Math.max(0, ISLAND_LEVEL_SEC - inLevel),
    nextLevel: level + 1,
  };
}

export function computeTreeStage(growthSec: number) {
  let current: (typeof TREE_STAGES)[number] = TREE_STAGES[0];
  for (const stage of TREE_STAGES) {
    if (growthSec >= stage.minSec) current = stage;
  }
  const currentIndex = TREE_STAGES.findIndex((stage) => stage.id === current.id);
  const next = TREE_STAGES[currentIndex + 1];
  if (!next) return { current, next: null, pct: 100, remainingSec: 0 };
  const span = next.minSec - current.minSec;
  const into = growthSec - current.minSec;
  return {
    current,
    next,
    pct: Math.min(100, Math.floor((into / span) * 100)),
    remainingSec: Math.max(0, next.minSec - growthSec),
  };
}

export function computeFruitsReady(gamification: GamificationState): number {
  const treeMin = TREE_STAGES.find((stage) => stage.id === 'tree')!.minSec;
  if (gamification.gardenGrowthSec < treeMin) return 0;
  const total = Math.floor((gamification.gardenGrowthSec - treeMin) / FRUIT_RATE_SEC);
  return Math.max(0, total - gamification.gardenHarvestedOnTree);
}

export function totalFruit(collection: Record<string, number>): number {
  return Object.values(collection).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function studyTotals(sessions: StudySession[], nowMs = Date.now()) {
  const active = sessions.filter((session) => !session.deletedAt);
  const todayStart = startOfDayMs(nowMs);
  const weekStart = startOfWeekMs(nowMs);
  const monthStart = new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), 1).getTime();
  const totalSec = active.reduce((sum, session) => sum + session.durationSec, 0);
  const todaySec = active
    .filter((session) => Date.parse(session.endAt) >= todayStart)
    .reduce((sum, session) => sum + session.durationSec, 0);
  const weekSec = active
    .filter((session) => Date.parse(session.endAt) >= weekStart)
    .reduce((sum, session) => sum + session.durationSec, 0);
  const monthSec = active
    .filter((session) => Date.parse(session.endAt) >= monthStart)
    .reduce((sum, session) => sum + session.durationSec, 0);
  return { totalSec, todaySec, weekSec, monthSec, count: active.length };
}

export function computeStreak(sessions: StudySession[], nowMs = Date.now()) {
  const studiedDays = new Set(
    sessions
      .filter((session) => !session.deletedAt && session.durationSec >= 60)
      .map((session) => dateKey(session.endAt)),
  );

  let current = 0;
  let cursor = new Date(startOfDayMs(nowMs));
  while (studiedDays.has(dateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  let longest = 0;
  let run = 0;
  const sorted = Array.from(studiedDays).sort();
  let previous = '';
  for (const key of sorted) {
    const prevDate = previous ? new Date(`${previous}T00:00:00`) : null;
    const currentDate = new Date(`${key}T00:00:00`);
    const contiguous = prevDate && currentDate.getTime() - prevDate.getTime() === 86400000;
    run = contiguous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  return { current, longest };
}

export function dailyQuests(state: AppState, nowMs = Date.now()) {
  const today = dateKey(nowMs);
  const todaySessions = state.sessions.filter((session) => !session.deletedAt && dateKey(session.endAt) === today);
  const todaySec = todaySessions.reduce((sum, session) => sum + session.durationSec, 0);
  const completedTasks = state.tasks.filter(
    (task) => !task.deletedAt && task.done && task.completedAt && dateKey(task.completedAt) === today,
  ).length;
  const hasLabelSession = todaySessions.some((session) => Boolean(session.labelId || session.labelNameSnapshot));

  return [
    {
      id: `focus-25-${today}`,
      title: 'Focus bloom',
      detail: 'Study for 25 minutes today.',
      progress: Math.min(1, todaySec / (25 * 60)),
      completed: todaySec >= 25 * 60,
    },
    {
      id: `label-session-${today}`,
      title: 'Named intention',
      detail: 'Save a session with a label.',
      progress: hasLabelSession ? 1 : 0,
      completed: hasLabelSession,
    },
    {
      id: `task-finish-${today}`,
      title: 'Clear one leaf',
      detail: 'Complete one study task.',
      progress: Math.min(1, completedTasks / 1),
      completed: completedTasks >= 1,
    },
  ];
}

export function nextAchievements(state: AppState) {
  const totals = studyTotals(state.sessions);
  const streak = computeStreak(state.sessions);
  return ACHIEVEMENTS.filter((achievement) => !state.gamification.achievementIds.includes(achievement.id)).map(
    (achievement) => {
      let progress = 0;
      if (achievement.id === 'first-session') progress = Math.min(1, totals.count / 1);
      if (achievement.id === 'one-hour') progress = Math.min(1, totals.totalSec / 3600);
      if (achievement.id === 'five-hour-island') progress = Math.min(1, state.gamification.islandXpSec / ISLAND_LEVEL_SEC);
      if (achievement.id === 'three-day-streak') progress = Math.min(1, streak.current / 3);
      if (achievement.id === 'ten-sessions') progress = Math.min(1, totals.count / 10);
      if (achievement.id === 'fruit-harvest') progress = Math.min(1, totalFruit(state.gamification.fruitCollection));
      return { ...achievement, progress };
    },
  );
}

export function earnedAchievementIds(state: AppState): string[] {
  const totals = studyTotals(state.sessions);
  const streak = computeStreak(state.sessions);
  const earned = new Set(state.gamification.achievementIds);
  if (totals.count >= 1) earned.add('first-session');
  if (totals.totalSec >= 3600) earned.add('one-hour');
  if (state.gamification.islandXpSec >= ISLAND_LEVEL_SEC) earned.add('five-hour-island');
  if (streak.current >= 3) earned.add('three-day-streak');
  if (totals.count >= 10) earned.add('ten-sessions');
  if (totalFruit(state.gamification.fruitCollection) >= 1) earned.add('fruit-harvest');
  return Array.from(earned);
}
