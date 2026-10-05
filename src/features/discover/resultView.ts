// View helpers for research results: live row status, ordering and summary counts. Derived on
// render from state; nothing here is stored.
import type { BadgeTone } from '../../components/ui/Badge';
import type { Company } from '../../domain/company';
import { findProspectMatch, type ResearchRequest, type ResearchResult } from '../../domain/research';

export type RowStatus = 'new' | 'selected' | 'listed' | 'added' | 'pending' | 'not_analyzed' | 'failed' | 'excluded';

export const ROW_STATUS: Record<RowStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'Yeni', tone: 'info' },
  selected: { label: 'Seçildi', tone: 'accent' },
  listed: { label: 'Zaten Listede', tone: 'neutral' },
  added: { label: 'Eklendi', tone: 'success' },
  pending: { label: 'İnceleniyor', tone: 'neutral' },
  not_analyzed: { label: 'Analiz edilmedi', tone: 'neutral' },
  failed: { label: 'Analiz başarısız', tone: 'danger' },
  excluded: { label: 'Hariç tutuldu', tone: 'neutral' },
};

/** Live status: a company added to prospects after the job ran still shows as "Zaten Listede". */
export function rowStatus(r: ResearchResult, companies: readonly Company[], jobRunning: boolean): RowStatus {
  if (r.transferredCompanyId) return 'added';
  if (r.researchStatus === 'existing') return 'listed';
  if (r.alreadyInProspects || findProspectMatch({ name: r.companyName, website: r.website, country: r.country }, companies)) {
    return 'listed';
  }
  if (r.researchStatus === 'discovered') return jobRunning ? 'pending' : 'not_analyzed';
  if (r.researchStatus === 'failed') return 'failed';
  if (r.researchStatus === 'excluded') return 'excluded';
  return r.selected ? 'selected' : 'new';
}

export const isSelectableStatus = (s: RowStatus) => s === 'new' || s === 'selected';

const GROUP: Record<RowStatus, number> = {
  new: 0,
  selected: 0,
  added: 0,
  pending: 1,
  not_analyzed: 2,
  failed: 2,
  excluded: 3,
  listed: 3,
};

/**
 * Real results: analyzed companies by rankScore (see rankScore in opportunityAnalysis), then
 * pending, failed/not analyzed, and finally excluded / already listed. Demo order is unchanged.
 */
export function orderRows<T extends { result: ResearchResult; status: RowStatus }>(rows: T[], mode: ResearchRequest['mode']): T[] {
  if (mode === 'demo') return rows;
  return [...rows].sort(
    (a, b) =>
      GROUP[a.status] - GROUP[b.status] ||
      (b.result.rankScore ?? -Infinity) - (a.result.rankScore ?? -Infinity) ||
      a.result.companyName.localeCompare(b.result.companyName, 'tr-TR'),
  );
}

export interface RealSummary {
  target: number;
  found: number;
  /** Analyzed results by verification status; "verified" means fully verified only. */
  verified: number;
  partial: number;
  unverified: number;
  analyzed: number;
  failed: number;
  existing: number;
}

/**
 * "1 doğrulandı, 1 kısmen doğrulandı, 1 doğrulanamadı": verification status counts of analyzed
 * results, zero counts left out. Empty when nothing was analyzed.
 */
export function verificationBreakdown(s: Pick<RealSummary, 'verified' | 'partial' | 'unverified'>): string {
  return [
    s.verified > 0 && `${s.verified} doğrulandı`,
    s.partial > 0 && `${s.partial} kısmen doğrulandı`,
    s.unverified > 0 && `${s.unverified} doğrulanamadı`,
  ]
    .filter(Boolean)
    .join(', ');
}

export function realSummary(request: ResearchRequest, results: ResearchResult[]): RealSummary {
  const analyzed = results.filter((r) => r.researchStatus === 'analyzed' || r.researchStatus === 'excluded');
  return {
    target: request.companyCount,
    found: results.length,
    verified: analyzed.filter((r) => r.verification?.status === 'verified').length,
    partial: analyzed.filter((r) => r.verification?.status === 'partial').length,
    unverified: analyzed.filter((r) => r.verification?.status === 'unverified').length,
    analyzed: analyzed.length,
    failed: results.filter((r) => r.researchStatus === 'failed').length,
    existing: results.filter((r) => r.researchStatus === 'existing').length,
  };
}
