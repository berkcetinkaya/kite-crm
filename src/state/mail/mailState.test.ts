import { describe, expect, it } from 'vitest';
import type { MailGenerateResponse } from '../../domain/mail/api';
import { defaultMailLanguage, findActiveDraft, MAIL_DRAFT_STATUS_LABELS, MAIL_DRAFT_STATUSES } from '../../domain/mail/draft';
import { getMockCompanies } from '../../data/mock/companies';
import type { ResearchResult } from '../../domain/research';
import { migrateCompanySector } from '../companies/CompaniesProvider';
import { distinctValues, queryCompanies, EMPTY_FILTERS } from '../../features/prospects/query';
import { buildMailRequest, findResearchForCompany, suggestedServices } from './mailRequest';
import { INITIAL_MAIL_STATE, mailReducer, type MailAction } from './mailReducer';

const response = (body = 'Hello team,\n\nBody.', subjects = ['A', 'B', 'C']): MailGenerateResponse => ({
  subjectOptions: subjects,
  body,
  evidenceRefs: [],
  sectorContext: { kind: 'sector_guidance', sectorLabel: 'Diş Kliniği', sectorId: 'dental_clinic', familyLabel: 'Sağlık', familyId: 'health', source: 'sector', profileId: 'dental_clinic', summaryTr: 's', useCasesUsed: [], useCasesAvailable: [] },
  generationNotes: { provider: 'fixture', model: null, personalization: 'general', personalizationReasons: [], companyObservation: null, serviceReasoning: '', warnings: [], promptVersion: 'mail-v1' },
  generatedAt: '2026-10-05T10:00:00.000Z',
});

const generated = (over: Partial<Extract<MailAction, { type: 'generated' }>> = {}): MailAction => ({
  type: 'generated',
  draftId: 'mail_1',
  companyId: 'cmp_1',
  options: { service: 'crm', language: 'en', contactId: null, researchJobId: null },
  response: response(),
  at: '2026-10-05T10:00:00.000Z',
  preserve: null,
  ...over,
});

describe('draft model', () => {
  it('has the three Phase 5 statuses and no "sent" status', () => {
    expect([...MAIL_DRAFT_STATUSES]).toEqual(['review', 'draft', 'approved']);
    expect(Object.values(MAIL_DRAFT_STATUS_LABELS)).toEqual(['İncelenecek', 'Taslak', 'Onaylandı']);
    expect(Object.values(MAIL_DRAFT_STATUS_LABELS).join(' ')).not.toMatch(/Gönderildi/);
  });

  it('defaults Türkiye prospects to Turkish and everyone else to English', () => {
    expect(defaultMailLanguage('Türkiye')).toBe('tr');
    expect(defaultMailLanguage('Turkey')).toBe('tr');
    expect(defaultMailLanguage('United Arab Emirates')).toBe('en');
    expect(defaultMailLanguage('Germany')).toBe('en');
  });
});

describe('draft lifecycle', () => {
  it('a generated draft starts as İncelenecek with all fields', () => {
    const s = mailReducer(INITIAL_MAIL_STATE, generated());
    expect(s.drafts).toHaveLength(1);
    expect(s.drafts[0]).toMatchObject({
      id: 'mail_1',
      companyId: 'cmp_1',
      contactId: null,
      service: 'crm',
      language: 'en',
      subjectOptions: ['A', 'B', 'C'],
      selectedSubject: 'A',
      status: 'review',
      approvedAt: null,
      researchJobId: null,
      evidenceRefs: [],
      editedSinceGeneration: false,
      previousVersions: [],
    });
    expect(s.drafts[0].sectorContext.kind).toBe('sector_guidance');
  });

  it('saving edits makes it a Taslak; approving sets Onaylandı and approvedAt', () => {
    let s = mailReducer(INITIAL_MAIL_STATE, generated());
    s = mailReducer(s, { type: 'save', id: 'mail_1', edits: { selectedSubject: 'B', body: 'Edited' }, at: '2026-10-05T11:00:00.000Z' });
    expect(s.drafts[0]).toMatchObject({ status: 'draft', selectedSubject: 'B', body: 'Edited', editedSinceGeneration: true });
    s = mailReducer(s, { type: 'approve', id: 'mail_1', edits: { selectedSubject: 'B', body: 'Edited' }, at: '2026-10-05T12:00:00.000Z' });
    expect(s.drafts[0]).toMatchObject({ status: 'approved', approvedAt: '2026-10-05T12:00:00.000Z' });
  });

  it('saving without changes does not change status', () => {
    let s = mailReducer(INITIAL_MAIL_STATE, generated());
    s = mailReducer(s, { type: 'save', id: 'mail_1', edits: { selectedSubject: 'A', body: response().body }, at: 'x' });
    expect(s.drafts[0].status).toBe('review');
  });

  it('editing an approved draft removes the approval', () => {
    let s = mailReducer(INITIAL_MAIL_STATE, generated());
    s = mailReducer(s, { type: 'approve', id: 'mail_1', edits: { selectedSubject: 'A', body: response().body }, at: 't1' });
    s = mailReducer(s, { type: 'save', id: 'mail_1', edits: { selectedSubject: 'A', body: 'Changed after approval' }, at: 't2' });
    expect(s.drafts[0]).toMatchObject({ status: 'draft', approvedAt: null });
  });

  it('regeneration keeps one draft per company and preserves Berk’s version when asked', () => {
    let s = mailReducer(INITIAL_MAIL_STATE, generated());
    s = mailReducer(s, { type: 'save', id: 'mail_1', edits: { selectedSubject: 'Mine', body: 'My careful edit' }, at: 't1' });
    s = mailReducer(s, generated({ draftId: 'mail_other', response: response('New body'), at: 't2', preserve: { selectedSubject: 'Mine', body: 'My careful edit' }, options: { service: 'website', language: 'tr', contactId: null, researchJobId: null } }));
    expect(s.drafts).toHaveLength(1);
    const d = s.drafts[0];
    expect(d).toMatchObject({ id: 'mail_1', body: 'New body', service: 'website', language: 'tr', status: 'review', editedSinceGeneration: false });
    expect(d.previousVersions).toEqual([{ subject: 'Mine', body: 'My careful edit', savedAt: 't2', reason: 'before_regeneration' }]);
    expect(findActiveDraft(s.drafts, 'cmp_1')?.id).toBe('mail_1');
    expect(findActiveDraft(s.drafts, 'cmp_2')).toBeUndefined();
  });
});

describe('mail request from a prospect', () => {
  const companies = getMockCompanies().map(migrateCompanySector);

  it('a company without research sends no research block', () => {
    const c = companies[0];
    const r = buildMailRequest(c, findResearchForCompany(c, {}), { service: 'crm', language: 'tr', contactId: null });
    expect(r.research).toBeNull();
    expect(r.company).toMatchObject({ id: c.id, name: c.name, sector: c.sector });
  });

  it('uses the transferred Phase 4 result: inspected evidence first, the selected service signals', () => {
    const company = { ...companies[0], id: 'cmp_x', researchRef: { requestId: 'req1', requestName: 'n', mode: 'real' as const, researchedAt: '', sourceUrls: [] } };
    const evidence = [
      { id: 'd1', url: 'https://x.example/a', title: 'a', sourceType: 'search_result' as const, claim: 'c', retrievedAt: '' },
      { id: 'w1', url: 'https://x.example/', title: 'h', sourceType: 'official_website' as const, claim: 'c', retrievedAt: '' },
    ];
    const result = {
      id: 'r1',
      researchRequestId: 'req1',
      source: 'web',
      transferredCompanyId: 'cmp_x',
      opportunityScore: 88,
      evidence,
      verification: { status: 'verified', confidence: 'high' },
      analysis: { websiteInspected: true },
      technical: { pagesInspected: [{ url: 'https://x.example/', title: 'h', kind: 'home' }] },
      serviceOpportunities: [{ service: 'crm', score: 90, confidence: 'medium', signals: [{ key: 'booking_flow', label: 'l', state: 'positive', reason: 'r', evidenceIds: ['w1'], origin: 'analysis', weight: 3 }] }],
    } as unknown as ResearchResult;
    expect(findResearchForCompany(company, { req1: [result] })).toBe(result);
    const r = buildMailRequest(company, result, { service: 'crm', language: 'en', contactId: null });
    expect(r.research).toMatchObject({ jobId: 'req1', overallScore: 88, serviceScore: 90, analysisConfidence: 'medium', verificationStatus: 'verified', websiteInspected: true });
    expect(r.research!.evidence.map((e) => e.id)).toEqual(['w1', 'd1']);
    expect(r.research!.signals.map((s) => s.key)).toEqual(['booking_flow']);
  });

  it('suggests the company’s best recorded opportunity first', () => {
    expect(suggestedServices({ opportunities: [{ service: 'seo', score: 40, potential: null, reason: '' }, { service: 'crm', score: 90, potential: null, reason: '' }] })).toEqual(['crm', 'seo']);
  });
});

describe('Phase 2 sector migration', () => {
  const companies = getMockCompanies().map(migrateCompanySector);

  it('stored companies get Turkish catalogue labels and ids; legacy values resolve', () => {
    const transfer = companies.find((c) => c.name === 'Bosphorus Transfer');
    expect(transfer).toMatchObject({ sector: 'VIP Transfer', sectorId: 'vip_transfer' });
    expect(companies.every((c) => c.sectorId !== undefined)).toBe(true);
    expect(migrateCompanySector({ ...companies[0], sector: 'Dental Clinic', sectorId: undefined })).toMatchObject({ sector: 'Diş Kliniği', sectorId: 'dental_clinic' });
    expect(migrateCompanySector({ ...companies[0], sector: 'Kedi Oteli', sectorId: undefined })).toMatchObject({ sector: 'Kedi Oteli', sectorId: null });
  });

  it('sector filters and search use Turkish labels, including legacy English values', () => {
    const legacy = { ...companies[0], id: 'legacy', sector: 'Dental Clinic', sectorId: undefined };
    const all = [...companies, legacy];
    expect(distinctValues(all, 'sector')).toContain('Diş Kliniği');
    expect(distinctValues(all, 'sector')).not.toContain('Dental Clinic');
    const filtered = queryCompanies(all, { search: '', filters: { ...EMPTY_FILTERS, sector: 'Diş Kliniği' }, sort: 'score' });
    expect(filtered.map((c) => c.id)).toContain('legacy');
  });
});
