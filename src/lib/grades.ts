import type { Assessment, EducationLevel } from '../types';

export function assessmentPercent(assessment: Pick<Assessment, 'score' | 'maxScore'>): number {
  if (!assessment.maxScore || assessment.maxScore <= 0) return 0;
  return Math.max(0, Math.min(100, (assessment.score / assessment.maxScore) * 100));
}

/**
 * Weighted mean of assessment percentages. Assessments without a weight count
 * equally with each other; if any weights are given, unweighted items are
 * treated as weight 0 so a module breakdown like 40% / 60% stays accurate.
 */
export function weightedAverage(assessments: Assessment[]): number | null {
  const active = assessments.filter((item) => !item.deletedAt && item.maxScore > 0);
  if (!active.length) return null;
  const weighted = active.filter((item) => typeof item.weight === 'number' && item.weight > 0);
  if (weighted.length) {
    const totalWeight = weighted.reduce((sum, item) => sum + (item.weight || 0), 0);
    return weighted.reduce((sum, item) => sum + assessmentPercent(item) * (item.weight || 0), 0) / totalWeight;
  }
  return active.reduce((sum, item) => sum + assessmentPercent(item), 0) / active.length;
}

/** Share of a module's weight that has already been assessed (0-100), when weights are used. */
export function weightCompleted(assessments: Assessment[]): number | null {
  const weighted = assessments.filter((item) => !item.deletedAt && typeof item.weight === 'number' && item.weight > 0);
  if (!weighted.length) return null;
  return Math.min(100, weighted.reduce((sum, item) => sum + (item.weight || 0), 0));
}

export function ukDegreeClassification(percent: number): string {
  if (percent >= 70) return 'First';
  if (percent >= 60) return 'Upper second (2:1)';
  if (percent >= 50) return 'Lower second (2:2)';
  if (percent >= 40) return 'Third';
  return 'Below pass';
}

export function postgraduateClassification(percent: number): string {
  if (percent >= 70) return 'Distinction';
  if (percent >= 60) return 'Merit';
  if (percent >= 50) return 'Pass';
  return 'Below pass';
}

export function classificationFor(level: EducationLevel, percent: number): string | null {
  if (level === 'university') return ukDegreeClassification(percent);
  if (level === 'postgraduate') return postgraduateClassification(percent);
  return null;
}
