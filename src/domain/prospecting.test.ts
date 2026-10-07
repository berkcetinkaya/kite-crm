// Phase 12: pure prospecting rules (duplicates, confidence, priority, sector gate, re-research diff).
import { describe, expect, it } from 'vitest';
import type { Company } from './company';
import {
  candidateDuplicates,
  contactChannels,
  defaultServices,
  DEFAULT_DISCOVERY_FILTERS,
  prospectPriority,
  researchConfidence,
  researchDiff,
  signalKnowledge,
} from './prospecting';
import type { ResearchResult, ServiceOpportunityAnalysis, ServiceSignal } from './research';

const sig = (key: string, state: ServiceSignal['state'], origin: ServiceSignal['origin'] = 'check', weight = 2): ServiceSignal => ({ key, label: key, state, reason: '', evidenceIds: ['w1'], origin, weight });
const opp = (service: ServiceOpportunityAnalysis['service'], score: number, recommendation: ServiceOpportunityAnalysis['recommendation'], signals: ServiceSignal[]): ServiceOpportunityAnalysis => ({ service, score, confidence: 'medium', recommendation, reason: '', signals, evidenceIds: [] });

const result = (over: Partial<ResearchResult> = {}): ResearchResult => ({
  id: 'res_1',
  researchRequestId: 'rsch_1',
  companyName: 'Aurora Dental Studio',
  website: 'https://aurora-dental.example/',
  sector: 'Diş Kliniği',
  city: 'Dubai',
  country: 'United Arab Emirates',
  source: 'web',
  service: 'website',
  opportunityScore: 84,
  reason: '',
  companySize: null,
  confidence: 'high',
  selected: false,
  alreadyInProspects: false,
  transferredCompanyId: null,
  researchStatus: 'analyzed',
  createdAt: '2026-10-07T09:00:00.000Z',
  verification: { status: 'verified', confidence: 'high', officialWebsiteVerified: true, locationVerified: true, sectorVerified: true, verified: [], unverified: [], evidenceIds: [] },
  evidence: [
    { id: 'w1', url: 'https://aurora-dental.example/', title: 'Home', sourceType: 'official_website', claim: '', retrievedAt: '' },
    { id: 'w2', url: 'https://aurora-dental.example/contact', title: 'Contact', sourceType: 'official_page', claim: '', retrievedAt: '' },
    { id: 'd1', url: 'https://directory.example/a', title: 'Dir', sourceType: 'directory', claim: '', retrievedAt: '' },
  ],
  analysis: { summary: '', criteriaMatch: 'strong', criteriaNotes: '', exclusionChecks: [], websiteInspected: true, warnings: [] },
  serviceOpportunities: [
    opp('website', 86, 'primary', [sig('weak_cta', 'positive', 'analysis', 3), sig('no_https', 'positive', 'check', 1), sig('meta', 'neutral')]),
    opp('social_media', 70, 'secondary', [sig('active_social', 'positive', 'analysis')]),
    opp('seo', 65, 'secondary', [sig('no_meta', 'unknown', 'not_inspected')]),
    opp('crm', 40, 'none', [sig('booking', 'positive')]),
  ],
  contactHints: [{ kind: 'email', value: 'hello@aurora-dental.example', role: null, evidenceIds: ['w2'], confidence: 'high' }],
  technical: undefined,
  ...over,
});

const company = (over: Partial<Company> = {}) =>
  ({ id: 'cmp_a', name: 'Other Co', website: null, country: 'Türkiye', contacts: [], ...over }) as Pick<Company, 'id' | 'name' | 'website' | 'country' | 'contacts'>;
const contact = (email: string | null, phone: string | null = null) => ({ id: 'ct_1', fullName: 'X', role: '', email, phone, linkedin: null, isDecisionMaker: false, confidence: 'high' as const });

describe('duplicates', () => {
  it('same website host is a hard match; another subdomain is not', () => {
    const r = result();
    expect(candidateDuplicates(r, { companies: [company({ website: 'http://www.aurora-dental.example/about' })], otherResults: [] })).toMatchObject({ level: 'hard', blocksConversion: true });
    expect(candidateDuplicates(r, { companies: [company({ website: 'https://dubai.aurora-dental.example/' })], otherResults: [] }).level).toBeNull();
  });

  it('exact public email (case-insensitive) is hard; same phone (last 9 digits) is probable', () => {
    const r = result({ contactHints: [{ kind: 'email', value: 'Hello@Aurora-Dental.example', role: null, evidenceIds: [], confidence: 'high' }, { kind: 'phone', value: '+971 4 000 0000', role: null, evidenceIds: [], confidence: 'high' }] });
    const byEmail = candidateDuplicates({ ...r, website: null }, { companies: [company({ contacts: [contact('hello@aurora-dental.example')] })], otherResults: [] });
    expect(byEmail.matches.map((m) => [m.kind, m.level])).toEqual([['email', 'hard']]);
    const byPhone = candidateDuplicates({ ...r, website: null, contactHints: [r.contactHints![1]] }, { companies: [company({ contacts: [contact(null, '04 000 0000')] })], otherResults: [] });
    expect(byPhone).toMatchObject({ level: null });
    const byPhoneFull = candidateDuplicates({ ...r, website: null, contactHints: [r.contactHints![1]] }, { companies: [company({ contacts: [contact(null, '009714 000 0000')] })], otherResults: [] });
    expect(byPhoneFull).toMatchObject({ level: 'probable', needsConfirmation: true });
  });

  it('same name + same country is probable; another country is not a match; confirmation clears it', () => {
    const r = result({ website: null, contactHints: [] });
    const c = company({ id: 'cmp_x', name: 'Aurora Dental Studio', country: 'AE' });
    expect(candidateDuplicates(r, { companies: [c], otherResults: [] })).toMatchObject({ level: 'probable', needsConfirmation: true, blocksConversion: false });
    expect(candidateDuplicates(r, { companies: [{ ...c, country: 'Türkiye' }], otherResults: [] }).level).toBeNull();
    const confirmed = candidateDuplicates(r, { companies: [c], otherResults: [], acks: ['company:cmp_x'] });
    expect(confirmed).toMatchObject({ level: 'info', needsConfirmation: false });
    expect(confirmed.matches[0].acknowledged).toBe(true);
  });

  it('a hard match for the same company outranks a probable one and cannot be confirmed away', () => {
    const r = result();
    const c = company({ id: 'cmp_y', name: 'Aurora Dental Studio', country: 'United Arab Emirates', website: 'https://aurora-dental.example' });
    const d = candidateDuplicates(r, { companies: [c], otherResults: [], acks: ['company:cmp_y'] });
    expect(d.matches).toHaveLength(1);
    expect(d).toMatchObject({ level: 'hard', blocksConversion: true });
  });

  it('other runs: converted same host is hard; unconverted same host in another run is informational', () => {
    const r = result();
    const other = { id: 'res_9', researchRequestId: 'rsch_old', companyName: 'Aurora', website: 'https://aurora-dental.example/', country: 'AE', transferredCompanyId: null };
    expect(candidateDuplicates(r, { companies: [], otherResults: [other] })).toMatchObject({ level: 'info', blocksConversion: false, needsConfirmation: false });
    const converted = candidateDuplicates(r, { companies: [company({ id: 'cmp_z', name: 'Aurora (CRM)' })], otherResults: [{ ...other, transferredCompanyId: 'cmp_z' }] });
    expect(converted.matches[0]).toMatchObject({ kind: 'converted_host', level: 'hard', companyName: 'Aurora (CRM)' });
  });
});

describe('research confidence and signal knowledge', () => {
  it('categorical levels from verification, inspection and first-party evidence', () => {
    expect(researchConfidence(result()).level).toBe('high');
    expect(researchConfidence(result({ evidence: result().evidence!.slice(0, 1) })).level).toBe('medium');
    expect(researchConfidence(result({ verification: { ...result().verification!, status: 'partial' } })).level).toBe('medium');
    expect(researchConfidence(result({ verification: { ...result().verification!, status: 'unverified' } })).level).toBe('low');
    expect(researchConfidence(result({ researchStatus: 'failed' }))).toEqual({ level: 'low', reasons: ['Analiz tamamlanmadı.'] });
  });

  it('observed = measured by code, inferred = model, unknown = not inspected or unknown state', () => {
    expect(signalKnowledge(sig('a', 'positive', 'check'))).toBe('observed');
    expect(signalKnowledge(sig('a', 'negative', 'analysis'))).toBe('inferred');
    expect(signalKnowledge(sig('a', 'positive', 'not_inspected'))).toBe('unknown');
    expect(signalKnowledge(sig('a', 'unknown', 'check'))).toBe('unknown');
  });
});

describe('sector gate and recommendations', () => {
  it('pre-ticks only recommended services above the threshold with a positive signal; the gate removes blocked services', () => {
    expect(defaultServices(result(), 'health')).toEqual(['website', 'social_media']); // seo has no positive signal, crm is "none"
    expect(defaultServices(result(), 'manufacturing')).toEqual(['website']); // social_media gated for manufacturing
    expect(defaultServices(result(), null)).toEqual(['website', 'social_media']);
  });
});

describe('priority', () => {
  const opts = { filters: DEFAULT_DISCOVERY_FILTERS, familyId: 'health' as const };

  it('Yüksek: strong top service, confidence ≥ Orta, a contact channel; reasons list observed facts first', () => {
    const p = prospectPriority(result(), opts);
    expect(p.level).toBe('high');
    expect(p.supporting[0]).toBe('Website Yenileme: no_https (Gözlenen)');
    expect(p.supporting[1]).toBe('Website Yenileme: weak_cta (Çıkarım)');
  });

  it('Düşük: unverified identity, exclusion, required contact missing, or no recommendable service', () => {
    expect(prospectPriority(result({ verification: { ...result().verification!, status: 'unverified' } }), opts).level).toBe('low');
    expect(prospectPriority(result({ researchStatus: 'excluded' }), opts).weakening).toContain('Hariç tutma kriterlerinden biriyle eşleşiyor.');
    const noContact = result({ contactHints: [] });
    expect(prospectPriority(noContact, { ...opts, filters: { ...DEFAULT_DISCOVERY_FILTERS, contactRequired: true } }).level).toBe('low');
    expect(prospectPriority(noContact, opts).level).toBe('medium'); // not required → only weakens
    expect(prospectPriority(result({ serviceOpportunities: [opp('website', 50, 'none', [sig('x', 'positive')])] }), opts).level).toBe('low');
    expect(prospectPriority(result({ researchStatus: 'failed' }), opts)).toMatchObject({ level: 'low', weakening: ['Analiz tamamlanmadı; değerlendirme yapılamaz.'] });
  });

  it('Orta: medium-band top service, or a language / size mismatch with the filters', () => {
    expect(prospectPriority(result({ serviceOpportunities: [opp('website', 70, 'primary', [sig('x', 'positive')])] }), opts).level).toBe('medium');
    const tr = prospectPriority(result({ technical: { language: 'en-US' } as ResearchResult['technical'] }), { ...opts, filters: { ...DEFAULT_DISCOVERY_FILTERS, language: 'tr' } });
    expect(tr).toMatchObject({ level: 'medium' });
    expect(tr.weakening).toContain('Site dili (en-us) istenen dil değil.');
  });

  it('contact channels come from hints and observed website facts', () => {
    expect(contactChannels(result())).toEqual(['E-posta']);
    expect(contactChannels(result({ contactHints: [], technical: { hasPhone: true, hasWhatsApp: true } as ResearchResult['technical'] }))).toEqual(['Telefon', 'WhatsApp']);
  });
});

describe('re-research diff', () => {
  it('lists score, recommendation, verification, contact and signal changes in Turkish', () => {
    const before = result();
    const after = result({
      opportunityScore: 72,
      verification: { ...before.verification!, status: 'partial' },
      serviceOpportunities: [opp('website', 72, 'primary', [sig('weak_cta', 'neutral', 'analysis', 3), sig('no_https', 'positive', 'check', 1), sig('meta', 'neutral')]), opp('seo', 66, 'secondary', [sig('no_meta', 'positive')])],
      contactHints: [{ kind: 'phone', value: '+971 4 000 0000', role: null, evidenceIds: [], confidence: 'high' }],
    });
    expect(researchDiff(before, after)).toEqual([
      'Genel fırsat puanı: 84 → 72',
      'Artık önerilmeyen hizmet: Sosyal Medya Yönetimi',
      'Doğrulama: verified → partial',
      'Yeni iletişim bilgisi: +971 4 000 0000',
      'Artık bulunmayan iletişim bilgisi: hello@aurora-dental.example',
      '2 sinyalin durumu değişti.',
    ]);
    expect(researchDiff(before, before)).toEqual([]);
  });
});
