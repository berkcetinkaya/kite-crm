// Shared sample records for database and API tests (no test registrations here).
import type { Company } from '../../src/domain/company';
import type { ResearchRequest, ResearchResult } from '../../src/domain/research';
import { getMockCompanies } from '../../src/data/mock/companies';
import type { Store } from './store';
import type { MailDraft, MailLanguage } from '../../src/domain/mail/draft';
import type { ServiceKey } from '../../src/domain/services';
import { createId } from '../../src/lib/id';
import { mailReducer } from '../../src/state/mail/mailReducer';
import { migrateCompanySector } from '../../src/state/companies/companyCommands';

export const sampleCompany = (over: Partial<Company> = {}): Company => ({
  ...migrateCompanySector(getMockCompanies(new Date('2026-10-05T10:00:00Z'))[0]),
  researchRef: {
    requestId: 'rsch_1',
    requestName: 'Dubai Diş Kliniği • CRM',
    mode: 'real',
    researchedAt: '2026-10-05T09:00:00.000Z',
    sourceUrls: ['https://aurora-dental.example/'],
    sources: [{ url: 'https://aurora-dental.example/', title: 'Aurora', sourceType: 'official_website' }],
  },
  ...over,
});

export const sampleJob = (over: Partial<ResearchRequest> = {}): ResearchRequest => ({
  id: 'rsch_1',
  name: 'Dubai Diş Kliniği • CRM',
  service: 'crm',
  sector: 'Diş Kliniği',
  sectorId: 'dental_clinic',
  country: 'United Arab Emirates',
  countryCode: 'AE',
  city: 'Dubai',
  companyCount: 5,
  criteria: 'Premium',
  exclusions: 'franchise',
  status: 'completed',
  mode: 'real',
  isDemo: false,
  provider: 'fixture',
  createdAt: '2026-10-05T09:00:00.000Z',
  updatedAt: '2026-10-05T09:05:00.000Z',
  startedAt: '2026-10-05T09:00:00.000Z',
  completedAt: '2026-10-05T09:05:00.000Z',
  resultCount: 1,
  progress: { stage: 'finalizing', candidates: 1, toAnalyze: 1, inspected: 1, analyzed: 1, failed: 0 },
  errorMessage: null,
  cancelled: false,
  ...over,
});

export const sampleResult = (over: Partial<ResearchResult> = {}): ResearchResult => ({
  id: 'res_1',
  researchRequestId: 'rsch_1',
  companyName: 'Aurora Dental Studio',
  website: 'https://aurora-dental.example/',
  sector: 'Diş Kliniği',
  city: 'Dubai',
  country: 'United Arab Emirates',
  source: 'web',
  service: 'crm',
  opportunityScore: 90,
  reason: 'r',
  companySize: null,
  confidence: 'high',
  selected: false,
  alreadyInProspects: false,
  transferredCompanyId: null,
  researchStatus: 'analyzed',
  createdAt: '2026-10-05T09:01:00.000Z',
  discovery: { sectorFit: 'dental', profileFit: 'strong', confidence: 'high' },
  verification: { status: 'verified', confidence: 'high', officialWebsiteVerified: true, locationVerified: true, sectorVerified: true, locationBasis: 'inspected_site', sectorBasis: 'inspected_site', verified: ['v'], unverified: [], evidenceIds: ['w1'] },
  evidence: [
    { id: 'w1', url: 'https://aurora-dental.example/', title: 'Home', sourceType: 'official_website', claim: 'Ana sayfa incelendi', retrievedAt: '2026-10-05T09:01:00.000Z' },
    { id: 'd1', url: 'https://directory.example/aurora', title: 'Dir', sourceType: 'directory', claim: 'Listed', retrievedAt: '2026-10-05T09:01:00.000Z' },
  ],
  analysis: { summary: 's', criteriaMatch: 'strong', criteriaNotes: '', exclusionChecks: [], websiteInspected: true, warnings: ['w'] },
  serviceOpportunities: [],
  contactHints: [],
  analysisError: null,
  rankScore: 105,
  ...over,
});


/**
 * Upgrade tests build an older-schema database with today's services. The Phase 13 readiness rules
 * (send guard, draft gate) also read tables added later (customers v5, prospecting v7, outreach
 * preparations v8); at the older version those simply do not exist yet, so they read as empty.
 */
export function asSchemaVersion(store: Store, version: number): Store {
  return {
    ...store,
    customers: version < 5 ? { ...store.customers, getByCompany: () => null } : store.customers,
    discovery: version < 7 ? { ...store.discovery, getReview: () => null, getDetails: () => null } : store.discovery,
    outreachPrep: version < 8 ? { ...store.outreachPrep, get: () => null } : store.outreachPrep,
  };
}

/**
 * Stores a first contact draft directly, for tests that need a draft as setup (sending, follow ups,
 * reporting, upgrades) and do not test generation. Uses the app's mail reducer; generation itself
 * (readiness, prompt v2, claim validation) is covered by the Phase 13 tests.
 */
export function seedFirstContactDraft(
  store: Store,
  companyId: string,
  opts: { service?: ServiceKey; language?: MailLanguage; contactId?: string | null; at?: string } = {},
): MailDraft {
  const at = opts.at ?? new Date().toISOString();
  const company = store.companies.get(companyId);
  if (!company) throw new Error(`seedFirstContactDraft: unknown company ${companyId}`);
  const language = opts.language ?? 'tr';
  const service = opts.service ?? 'crm';
  const tr = language === 'tr';
  const [draft] = mailReducer(
    { drafts: [] },
    {
      type: 'generated',
      draftId: createId('mail'),
      companyId,
      options: { service, language, contactId: opts.contactId ?? null, researchJobId: null },
      response: {
        subjectOptions: tr ? [`${company.name} için kısa bir fikir`, `${company.name} hakkında bir not`, 'Kısa bir öneri'] : [`An idea for ${company.name}`, `A note for ${company.name}`, 'A short suggestion'],
        body: tr
          ? `Merhaba ${company.name} ekibi,

${company.name} için kısa bir fikir paylaşmak istedim.

İyi çalışmalar,
Berk Çetinkaya
KITE Growth`
          : `Hello ${company.name} team,

I wanted to share a short idea for ${company.name}.

Best regards,
Berk Çetinkaya
KITE Growth`,
        evidenceRefs: [],
        sectorContext: { kind: 'sector_guidance', sectorLabel: company.sector, sectorId: company.sectorId ?? null, familyLabel: null, familyId: null, source: 'none', profileId: null, summaryTr: null, useCasesUsed: [], useCasesAvailable: [] },
        generationNotes: { provider: 'fixture', model: null, personalization: 'general', personalizationReasons: ['Test taslağı (üretim değil).'], companyObservation: null, serviceReasoning: '', warnings: [], promptVersion: 'test-seed' },
        generatedAt: at,
      },
      at,
      preserve: null,
    },
  ).drafts;
  store.mail.save(draft);
  return draft;
}
