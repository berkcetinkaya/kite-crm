// Opportunity score bands (0–100). Scores are entered manually; nothing here calculates them.

export type ScoreBand = 'strong' | 'medium' | 'weak';

export const SCORE_BANDS: Record<ScoreBand, { label: string; min: number; max: number }> = {
  strong: { label: '80–100', min: 80, max: 100 },
  medium: { label: '60–79', min: 60, max: 79 },
  weak: { label: '0–59', min: 0, max: 59 },
};

export const SCORE_BAND_ORDER: readonly ScoreBand[] = ['strong', 'medium', 'weak'];

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BANDS.strong.min) return 'strong';
  if (score >= SCORE_BANDS.medium.min) return 'medium';
  return 'weak';
}

export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}
