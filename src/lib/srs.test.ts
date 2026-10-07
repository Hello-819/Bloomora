import { describe, expect, it } from 'vitest';
import { deckSummary, isDue, scheduleReview } from './srs';
import type { Flashcard } from '../types';

const NOW = Date.parse('2026-05-01T09:00:00.000Z');
const DAY = 86400000;

function card(id: string, review?: Flashcard['review']): Flashcard {
  return { id, front: 'Q', back: 'A', review, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' };
}

describe('spaced repetition', () => {
  it('treats unreviewed cards as due', () => {
    expect(isDue(card('a'), NOW)).toBe(true);
  });

  it('schedules a new card a day out on good and grows the interval', () => {
    const first = scheduleReview(undefined, 'good', NOW);
    expect(first.intervalDays).toBe(1);
    expect(Date.parse(first.dueAt)).toBe(NOW + DAY);
    const second = scheduleReview(first, 'good', NOW);
    expect(second.intervalDays).toBe(3);
    const third = scheduleReview(second, 'good', NOW);
    expect(third.intervalDays).toBeGreaterThan(3);
  });

  it('resets on again and records a lapse for learned cards', () => {
    const learned = scheduleReview(scheduleReview(undefined, 'good', NOW), 'good', NOW);
    const failed = scheduleReview(learned, 'again', NOW);
    expect(failed.reps).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.ease).toBeLessThan(learned.ease);
    expect(Date.parse(failed.dueAt) - NOW).toBe(10 * 60 * 1000);
  });

  it('never drops ease below the floor', () => {
    let review = scheduleReview(undefined, 'hard', NOW);
    for (let i = 0; i < 20; i += 1) review = scheduleReview(review, 'again', NOW);
    expect(review.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('summarises a deck', () => {
    const cards = [
      card('new'),
      card('due', { dueAt: new Date(NOW - 1000).toISOString(), intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, lastReviewedAt: '2026-04-28T00:00:00.000Z' }),
      card('later', { dueAt: new Date(NOW + 30 * DAY).toISOString(), intervalDays: 30, ease: 2.5, reps: 5, lapses: 0, lastReviewedAt: '2026-04-01T00:00:00.000Z' }),
    ];
    expect(deckSummary(cards, NOW)).toEqual({ due: 1, fresh: 1, mature: 1, total: 3 });
  });
});
