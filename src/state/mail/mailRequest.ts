// Builds a mail generation request from a prospect and, when it came from real research, the
// Phase 4 result it was transferred from. Pure, so it can be tested without React.
import type { Company } from '../../domain/company';
import type { MailGenerateRequest } from '../../domain/mail/context';
import type { MailLanguage } from '../../domain/mail/draft';
import { isInspectedEvidence, type ResearchResult } from '../../domain/research';
import type { ServiceKey } from '../../domain/services';

type ResultsByRequest = Record<string, ResearchResult[]>;

/** The analyzed real research result this company was transferred from, if it is still in memory. */
export function findResearchForCompany(company: Pick<Company, 'id' | 'researchRef'>, resultsByRequest: ResultsByRequest): ResearchResult | null {
  if (company.researchRef?.mode !== 'real') return null;
  const preferred = resultsByRequest[company.researchRef.requestId] ?? [];
  const all = [preferred, ...Object.values(resultsByRequest)].flat();
  return all.find((r) => r.source === 'web' && r.transferredCompanyId === company.id && r.verification) ?? null;
}

/** Services worth offering first for a company: its recorded opportunities, best first. */
export function suggestedServices(company: Pick<Company, 'opportunities'>): ServiceKey[] {
  return [...company.opportunities].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((o) => o.service);
}

export function buildMailRequest(
  company: Company,
  research: ResearchResult | null,
  options: { service: ServiceKey; language: MailLanguage; contactId: string | null },
): MailGenerateRequest {
  const contact = options.contactId ? company.contacts.find((c) => c.id === options.contactId) : undefined;
  const opp = research?.serviceOpportunities?.find((o) => o.service === options.service);
  return {
    company: {
      id: company.id,
      name: company.name,
      website: company.website,
      sector: company.sector,
      sectorId: company.sectorId ?? null,
      city: company.city,
      country: company.country,
      opportunityScore: company.opportunityScore,
    },
    contactName: contact && !/genel iletişim/i.test(contact.fullName) ? contact.fullName : null,
    service: options.service,
    language: options.language,
    research: research
      ? {
          jobId: research.researchRequestId,
          overallScore: research.opportunityScore,
          serviceScore: opp?.score ?? null,
          analysisConfidence: opp?.confidence ?? null,
          verificationStatus: research.verification?.status ?? null,
          verificationConfidence: research.verification?.confidence ?? null,
          websiteInspected: research.analysis?.websiteInspected ?? false,
          // Inspected official pages first so the request cap never drops first party evidence.
          evidence: [...(research.evidence ?? []).filter(isInspectedEvidence), ...(research.evidence ?? []).filter((e) => !isInspectedEvidence(e))]
            .slice(0, 12)
            .map(({ id, url, title, sourceType, claim }) => ({ id, url, title, sourceType, claim })),
          signals: (opp?.signals ?? []).map(({ key, label, state, reason, evidenceIds, origin }) => ({ key, label, state, reason, evidenceIds, origin })),
          inspectedPages: (research.technical?.pagesInspected ?? []).slice(0, 6),
        }
      : null,
  };
}
