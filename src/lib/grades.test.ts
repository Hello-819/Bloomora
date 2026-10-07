import { describe, expect, it } from 'vitest';
import { assessmentPercent, classificationFor, weightCompleted, weightedAverage } from './grades';
import type { Assessment } from '../types';

function assessment(score: number, maxScore: number, weight?: number): Assessment {
  return { id: `${score}-${maxScore}-${weight}`, title: 'Test', score, maxScore, weight, date: '2026-01-01', createdAt: '', updatedAt: '' };
}

describe('grades', () => {
  it('converts scores to percentages', () => {
    expect(assessmentPercent({ score: 45, maxScore: 60 })).toBe(75);
    expect(assessmentPercent({ score: 5, maxScore: 0 })).toBe(0);
  });

  it('averages unweighted assessments equally', () => {
    expect(weightedAverage([assessment(50, 100), assessment(70, 100)])).toBe(60);
  });

  it('uses weights when given', () => {
    expect(weightedAverage([assessment(80, 100, 40), assessment(60, 100, 60)])).toBeCloseTo(68);
    expect(weightCompleted([assessment(80, 100, 40), assessment(60, 100, 20)])).toBe(60);
  });

  it('returns null with no assessments', () => {
    expect(weightedAverage([])).toBeNull();
  });

  it('classifies UK degree marks only for university levels', () => {
    expect(classificationFor('university', 72)).toBe('First');
    expect(classificationFor('university', 64)).toBe('Upper second (2:1)');
    expect(classificationFor('postgraduate', 61)).toBe('Merit');
    expect(classificationFor('sixth-form', 90)).toBeNull();
  });
});
