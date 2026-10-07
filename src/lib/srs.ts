import type { Flashcard, FlashcardReview, ReviewGrade } from '../types';

const DAY_MS = 86400000;
const MIN_EASE = 1.3;
const RELEARN_MS = 10 * 60 * 1000;

export function isDue(card: Flashcard, nowMs = Date.now()): boolean {
  if (!card.review) return true;
  return Date.parse(card.review.dueAt) <= nowMs;
}

export function isNew(card: Flashcard): boolean {
  return !card.review || card.review.reps === 0 && !card.review.lastReviewedAt;
}

/**
 * A small SM-2 style scheduler. "Again" resets the card and brings it back in
 * ten minutes; the other grades grow the interval by the card's ease factor.
 */
export function scheduleReview(previous: FlashcardReview | undefined, grade: ReviewGrade, nowMs = Date.now()): FlashcardReview {
  const prev = previous ?? { dueAt: new Date(nowMs).toISOString(), intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
  const lastReviewedAt = new Date(nowMs).toISOString();

  if (grade === 'again') {
    return {
      dueAt: new Date(nowMs + RELEARN_MS).toISOString(),
      intervalDays: 0,
      ease: Math.max(MIN_EASE, prev.ease - 0.2),
      reps: 0,
      lapses: prev.lapses + (prev.reps > 0 ? 1 : 0),
      lastReviewedAt,
    };
  }

  let intervalDays: number;
  let ease = prev.ease;
  if (grade === 'hard') {
    intervalDays = Math.max(1, Math.round(prev.intervalDays * 1.2));
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (grade === 'good') {
    intervalDays = prev.reps === 0 ? 1 : prev.reps === 1 ? 3 : Math.max(prev.intervalDays + 1, Math.round(prev.intervalDays * ease));
  } else {
    intervalDays = prev.reps === 0 ? 4 : Math.max(prev.intervalDays + 2, Math.round(prev.intervalDays * ease * 1.3));
    ease += 0.15;
  }

  return {
    dueAt: new Date(nowMs + intervalDays * DAY_MS).toISOString(),
    intervalDays,
    ease: Number(ease.toFixed(2)),
    reps: prev.reps + 1,
    lapses: prev.lapses,
    lastReviewedAt,
  };
}

export function describeInterval(review: FlashcardReview | undefined, grade: ReviewGrade, nowMs = Date.now()): string {
  const next = scheduleReview(review, grade, nowMs);
  const diffMs = Date.parse(next.dueAt) - nowMs;
  if (diffMs < DAY_MS) return `${Math.max(1, Math.round(diffMs / 60000))}m`;
  const daysOut = Math.round(diffMs / DAY_MS);
  if (daysOut < 30) return `${daysOut}d`;
  if (daysOut < 365) return `${Math.round(daysOut / 30)}mo`;
  return `${(daysOut / 365).toFixed(1)}y`;
}

export function deckSummary(cards: Flashcard[], nowMs = Date.now()) {
  let due = 0;
  let fresh = 0;
  let mature = 0;
  for (const card of cards) {
    if (isNew(card)) fresh += 1;
    else if (isDue(card, nowMs)) due += 1;
    if (card.review && card.review.intervalDays >= 21) mature += 1;
  }
  return { due, fresh, mature, total: cards.length };
}
