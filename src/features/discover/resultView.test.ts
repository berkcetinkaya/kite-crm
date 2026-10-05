import { describe, expect, it } from 'vitest';
import type { ResearchRequest, ResearchResult, VerificationStatus } from '../../domain/research';
import { realSummary, verificationBreakdown } from './resultView';

const row = (status: ResearchResult['researchStatus'], verification?: VerificationStatus) =>
  ({ researchStatus: status, ...(verification ? { verification: { status: verification } } : {}) }) as ResearchResult;

describe('real results summary wording', () => {
  it('counts verification statuses separately instead of calling every result verified', () => {
    const results = [row('analyzed', 'verified'), row('analyzed', 'partial'), row('analyzed', 'unverified'), row('failed')];
    const s = realSummary({ companyCount: 5 } as ResearchRequest, results);
    expect(s).toMatchObject({ target: 5, found: 4, verified: 1, partial: 1, unverified: 1, analyzed: 3, failed: 1 });
    expect(verificationBreakdown(s)).toBe('1 doğrulandı, 1 kısmen doğrulandı, 1 doğrulanamadı');
  });

  it('leaves out zero counts', () => {
    expect(verificationBreakdown({ verified: 2, partial: 1, unverified: 0 })).toBe('2 doğrulandı, 1 kısmen doğrulandı');
    expect(verificationBreakdown({ verified: 0, partial: 0, unverified: 0 })).toBe('');
  });
});
