// Phase 13: readiness rules and their order, legacy/manual companies, CRM duplicates, contact
// ranking, angle availability and the evidence model.
import { describe, expect, it } from 'vitest';
import type { Company, Contact } from './company';
import type { OutboundMessage } from './outreach';
import type { CandidateReview } from './prospecting';
import type { ResearchResult, ServiceSignal } from './research';
import { emptyPreparation, type OutreachPreparation } from './outreachPrep';
import { computeReadiness, crmDuplicates, firstContactSendBlockers, rankContacts, type ReadinessInput } from './outreachReadiness';
import { availableAngles, buildClaimSources, ctaOptions, GENERAL_INTRO, serviceEvidence } from './outreachAngles';

const AT = '2026-10-07T09:00:00.000Z';

const contact = (over: Partial<Contact> = {}): Contact => ({ id: 'ct_1', fullName: 'Ece Kaya', role: 'Kurucu', email: 'ece@aurora.example', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'medium', ...over });

const company = (over: Partial<Company> = {}): Company => ({
  id: 'cmp_a',
  name: 'Aurora Dental',
  website: 'aurora.example',
  sector: 'Diş Kliniği',
  sectorId: 'dental_clinic',
  city: 'İstanbul',
  country: 'Türkiye',
  companySize: null,
  source: 'manual',
  owner: null,
  status: 'found',
  opportunityScore: null,
  opportunities: [{ service: 'crm', score: 70, reason: '', potential: 'high' }],
  contacts: [contact()],
  notes: [],
  history: [],
  lastContactAt: null,
  nextAction: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const signal = (key: string, origin: ServiceSignal['origin'], evidenceIds: string[] = [], state: ServiceSignal['state'] = 'positive'): ServiceSignal => ({ key, label: key, state, reason: 'not', evidenceIds, origin, weight: 1 });

const result = (over: Partial<ResearchResult> = {}, signals: ServiceSignal[] = [signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w1'])]): ResearchResult => ({
  id: 'res_1',
  researchRequestId: 'rsch_1',
  companyName: 'Aurora Dental',
  website: 'https://aurora.example/',
  sector: 'Diş Kliniği',
  city: 'İstanbul',
  country: 'Türkiye',
  source: 'web',
  service: 'crm',
  opportunityScore: 80,
  reason: '',
  companySize: null,
  confidence: 'high',
  selected: false,
  alreadyInProspects: true,
  transferredCompanyId: 'cmp_a',
  researchStatus: 'analyzed',
  createdAt: AT,
  verification: { status: 'verified', confidence: 'high', officialWebsiteVerified: true, locationVerified: true, sectorVerified: true, verified: [], unverified: [], evidenceIds: [] },
  evidence: [
    { id: 'w1', url: 'https://aurora.example/', title: 'Home', sourceType: 'official_website', claim: '', retrievedAt: AT },
    { id: 'w2', url: 'https://aurora.example/iletisim', title: 'İletişim', sourceType: 'official_page', claim: '', retrievedAt: AT },
    { id: 'd1', url: 'https://dir.example/aurora', title: 'Dir', sourceType: 'directory', claim: '', retrievedAt: AT },
  ],
  analysis: { summary: '', criteriaMatch: 'strong', criteriaNotes: '', exclusionChecks: [], websiteInspected: true, warnings: [] },
  serviceOpportunities: [{ service: 'crm', score: 80, confidence: 'high', recommendation: 'primary', reason: '', signals, evidenceIds: [] }],
  contactHints: [],
  ...over,
});

const review = (status: CandidateReview['status']): CandidateReview => ({ resultId: 'res_1', status, rejectReason: status === 'not_fit' ? 'x' : null, notes: '', sector: null, sectorId: null, services: null, contacts: null, duplicateAcks: [], reviewedAt: AT, updatedAt: AT });

const send = (status: OutboundMessage['status']): OutboundMessage => ({
  id: 'snd_1', companyId: 'cmp_a', draftId: 'mail_1', contactId: 'ct_1', recipientEmail: 'ece@aurora.example', recipientName: null, fromEmail: null, subject: 's', body: 'b',
  service: 'crm', language: 'tr', revisionKey: 'k', provider: 'fixture', status, gmailMessageId: null, gmailThreadId: null, rfcMessageId: null, errorCode: null, errorMessage: null,
  resolution: null, attemptedAt: AT, sentAt: status === 'sent' ? AT : null, createdAt: AT, updatedAt: AT,
});

const prep = (over: Partial<OutreachPreparation> = {}): OutreachPreparation => ({ ...emptyPreparation('cmp_a', AT), ...over });

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  const c = over.company ?? company();
  return { company: c, companies: [c], customer: null, sends: [], followUps: [], research: { result: result(), review: null, phase12: false }, preparation: null, draft: null, ...over };
}
const codes = (i: Partial<ReadinessInput>) => computeReadiness(input(i)).reasons.map((r) => r.code);

describe('readiness rules', () => {
  it('a researched company with a contact, a service and evidence is Hazır', () => {
    const r = computeReadiness(input());
    expect(r.state).toBe('ready');
    expect(r.reasons).toEqual([]);
    expect(r.angle?.key).toBe('enquiry_handling');
    expect(r.tone).toBe('premium');
  });

  it.each([
    ['client', 'stage_blocked'],
    ['lost', 'stage_blocked'],
    ['not_interested', 'stage_blocked'],
    ['disqualified', 'stage_blocked'],
  ] as const)('stage %s is Gönderime Uygun Değil', (status, code) => {
    const r = computeReadiness(input({ company: company({ status }) }));
    expect(r.state).toBe('blocked');
    expect(r.reasons[0].code).toBe(code);
  });

  it('active customer, sent first contact, active or paused follow-up, exclusion: blocked', () => {
    expect(codes({ customer: { status: 'active' } })).toContain('active_customer');
    expect(codes({ customer: { status: 'completed' } })).not.toContain('active_customer');
    expect(codes({ sends: [send('sent')] })).toContain('first_contact_sent');
    expect(codes({ sends: [send('failed')] })).not.toContain('first_contact_sent');
    expect(codes({ followUps: [{ status: 'active' }] })).toContain('follow_up_active');
    expect(codes({ followUps: [{ status: 'paused' }] })).toContain('follow_up_active');
    expect(codes({ followUps: [{ status: 'completed_no_reply' }] })).not.toContain('follow_up_active');
    expect(codes({ research: { result: result({ researchStatus: 'excluded' }), review: null, phase12: false } })).toContain('research_excluded');
    const violated = result({ analysis: { summary: '', criteriaMatch: 'strong', criteriaNotes: '', exclusionChecks: [{ exclusion: 'zincir', status: 'violated', evidenceIds: [] }], websiteInspected: true, warnings: [] } });
    expect(codes({ research: { result: violated, review: null, phase12: false } })).toContain('research_excluded');
  });

  it('a company with a sent first contact never becomes Hazır, whatever else is true', () => {
    const r = computeReadiness(input({ sends: [send('sent')], preparation: prep({ angleKey: GENERAL_INTRO }) }));
    expect(r.state).toBe('blocked');
    expect(firstContactSendBlockers(r).map((x) => x.code)).toEqual(['first_contact_sent']);
  });

  it('review group: unclear send, later, low confidence', () => {
    expect(computeReadiness(input({ sends: [send('ambiguous')] })).state).toBe('review');
    expect(computeReadiness(input({ company: company({ status: 'later' }) })).reasons[0].code).toBe('status_later');
    const low = result({ verification: { status: 'unverified', confidence: 'low', officialWebsiteVerified: false, locationVerified: false, sectorVerified: false, verified: [], unverified: [], evidenceIds: [] } });
    expect(codes({ research: { result: low, review: null, phase12: false } })).toContain('low_confidence');
  });

  it('missing group: no contact, invalid chosen contact, no service, no angle', () => {
    expect(codes({ company: company({ contacts: [contact({ email: null })] }) })).toEqual(['no_contact']);
    expect(codes({ preparation: prep({ contactId: 'ct_gone' }) })).toEqual(['contact_invalid']);
    expect(codes({ company: company({ opportunities: [] }) })).toEqual(['no_service']);
    expect(codes({ research: null })).toEqual(['no_angle']);
  });

  it('order: blocked before review before missing; every reason is listed', () => {
    const r = computeReadiness(input({ company: company({ status: 'lost', contacts: [] }), sends: [send('ambiguous')] }));
    expect(r.state).toBe('blocked');
    expect(r.reasons.map((x) => x.group)).toEqual(['blocked', 'review', 'missing']);
  });

  it('progress views: Taslak Hazır, İlk Temas Gönderildi, Yanıt Geldi', () => {
    const draft = { status: 'approved' } as ReadinessInput['draft'];
    expect(computeReadiness(input({ draft })).progress).toBe('draft_approved');
    expect(computeReadiness(input({ sends: [send('sent')] })).progress).toBe('sent');
    expect(computeReadiness(input({ company: company({ status: 'replied' }) })).progress).toBe('replied');
  });
});

describe('legacy and manual companies (no Phase 12 candidate review)', () => {
  it('a manually created company without research is never İnceleme Gerekli for lack of a review', () => {
    const r = computeReadiness(input({ research: null }));
    expect(r.reasons.map((x) => x.code)).toEqual(['no_angle']);
    expect(r.state).toBe('missing');
  });

  it('a manual company without research becomes Hazır with an explicit Genel tanıtım', () => {
    const r = computeReadiness(input({ research: null, preparation: prep({ angleKey: GENERAL_INTRO }) }));
    expect(r.state).toBe('ready');
    expect(r.general).toBe(true);
    expect(r.angle).toBeNull();
  });

  it('a legacy (pre-Phase 12) research transfer without a review is judged on its evidence', () => {
    const r = computeReadiness(input({ research: { result: result(), review: null, phase12: false } }));
    expect(r.state).toBe('ready');
    expect(r.reasons.some((x) => x.code === 'candidate_unreviewed')).toBe(false);
  });

  it('a Phase 12 candidate needs an Uygun review; Uygun Değil is flagged', () => {
    expect(codes({ research: { result: result(), review: null, phase12: true } })).toEqual(['candidate_unreviewed']);
    expect(codes({ research: { result: result(), review: review('unreviewed'), phase12: true } })).toEqual(['candidate_unreviewed']);
    expect(codes({ research: { result: result(), review: review('not_fit'), phase12: true } })).toEqual(['candidate_not_fit']);
    expect(computeReadiness(input({ research: { result: result(), review: review('fit'), phase12: true } })).state).toBe('ready');
  });

  it('Genel tanıtım is never chosen silently', () => {
    const r = computeReadiness(input({ research: null }));
    expect(r.general).toBe(false);
    expect(r.state).toBe('missing');
  });
});

describe('CRM duplicates', () => {
  const other = (over: Partial<Company>) => company({ id: 'cmp_b', name: 'Başka Şirket', website: 'baska.example', contacts: [contact({ id: 'ct_b', email: 'info@baska.example', phone: null })], ...over });

  it('the company is never compared with itself', () => {
    const c = company({ contacts: [contact({ phone: '+90 532 111 22 33' })] });
    expect(crmDuplicates(c, [c])).toEqual([]);
    expect(computeReadiness(input({ company: c, companies: [c] })).state).toBe('ready');
  });

  it('same website host or exact email on another company is hard and blocks', () => {
    const c = company();
    expect(crmDuplicates(c, [c, other({ website: 'https://www.aurora.example/' })])[0]).toMatchObject({ level: 'hard', kind: 'host' });
    expect(crmDuplicates(c, [c, other({ contacts: [contact({ id: 'x', email: 'ECE@aurora.example ' })] })])[0]).toMatchObject({ level: 'hard', kind: 'email' });
    const r = computeReadiness(input({ companies: [c, other({ website: 'aurora.example' })] }));
    expect(r.state).toBe('blocked');
    expect(firstContactSendBlockers(r)[0].code).toBe('hard_duplicate');
  });

  it('same name + country or phone is probable and needs Farklı şirket', () => {
    const c = company({ contacts: [contact({ phone: '0532 111 22 33' })] });
    const twin = other({ name: 'aurora  dental', country: 'TR' });
    expect(crmDuplicates(c, [c, twin])[0]).toMatchObject({ level: 'probable', kind: 'name_country' });
    const phone = other({ contacts: [contact({ id: 'p', email: null, phone: '+90 (532) 111 22 33' })] });
    expect(crmDuplicates(c, [c, phone])[0]).toMatchObject({ level: 'probable', kind: 'phone' });
    expect(computeReadiness(input({ company: c, companies: [c, twin] })).reasons.map((x) => x.code)).toEqual(['probable_duplicate']);
    expect(computeReadiness(input({ company: c, companies: [c, twin], preparation: prep({ duplicateAcks: ['company:cmp_b'] }) })).state).toBe('ready');
  });

  it('names are never fuzzy-matched; other countries do not match', () => {
    const c = company();
    expect(crmDuplicates(c, [c, other({ name: 'Aurora Dental Studio' })])).toEqual([]);
    expect(crmDuplicates(c, [c, other({ name: 'Aurora Dental', country: 'Germany' })])).toEqual([]);
  });
});

describe('contact ranking', () => {
  it('decision maker, then named contacts by confidence, then the general address; never without email', () => {
    const c = company({
      contacts: [
        contact({ id: 'g', fullName: 'Genel iletişim', email: 'info@aurora.example' }),
        contact({ id: 'low', fullName: 'Ali', confidence: 'low', email: 'ali@aurora.example' }),
        contact({ id: 'none', fullName: 'Veli', email: null }),
        contact({ id: 'high', fullName: 'Ayşe', confidence: 'high', email: 'ayse@aurora.example' }),
        contact({ id: 'dm', fullName: 'Deniz', isDecisionMaker: true, confidence: 'low', email: 'deniz@aurora.example' }),
      ],
    });
    expect(rankContacts(c).map((r) => r.contact.id)).toEqual(['dm', 'high', 'low', 'g']);
    expect(rankContacts(c).at(-1)!.general).toBe(true);
  });

  it('the chosen contact wins over the ranking', () => {
    const c = company({ contacts: [contact({ id: 'a', isDecisionMaker: true }), contact({ id: 'b', email: 'b@aurora.example' })] });
    expect(computeReadiness(input({ company: c, companies: [c], preparation: prep({ contactId: 'b' }) })).contact?.contact.id).toBe('b');
  });
});

describe('angles and evidence', () => {
  it('check signals are observed only on an inspected site; analysis is inferred or search-only; unknown never', () => {
    const r = result({}, [signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w2']), signal('multiple_contact_channels', 'analysis', ['d1']), signal('lead_or_quote_forms', 'not_inspected'), signal('high_touch_sales', 'analysis', ['w1'], 'unknown')]);
    expect(serviceEvidence(r, 'crm').map((e) => [e.signalKey, e.kind])).toEqual([
      ['booking_flow', 'observed'],
      ['whatsapp_contact', 'inferred'],
      ['multiple_contact_channels', 'search'],
    ]);
    const notInspected = result({ analysis: { summary: '', criteriaMatch: 'strong', criteriaNotes: '', exclusionChecks: [], websiteInspected: false, warnings: [] } }, [signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w2'])]);
    expect(serviceEvidence(notInspected, 'crm').map((e) => [e.signalKey, e.kind])).toEqual([['whatsapp_contact', 'search']]);
  });

  it('unverified companies get no observed evidence', () => {
    const r = result({ verification: { status: 'unverified', confidence: 'low', officialWebsiteVerified: false, locationVerified: false, sectorVerified: false, verified: [], unverified: [], evidenceIds: [] } }, [signal('booking_flow', 'check')]);
    expect(serviceEvidence(r, 'crm')[0].kind).toBe('search');
  });

  it('angle strength: 2 per observed, 1 per inferred / search; strongest first', () => {
    const r = result({}, [signal('high_touch_sales', 'analysis', ['w1']), signal('journey_complexity', 'analysis', ['w1']), signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w1'])]);
    const angles = availableAngles(r, 'crm');
    expect(angles.map((a) => [a.key, a.strength])).toEqual([
      ['enquiry_handling', 3],
      ['consultative_sales', 2],
    ]);
    expect(availableAngles(r, 'seo')).toEqual([]);
    expect(availableAngles(null, 'crm')).toEqual([]);
  });

  it('CTA options are low friction and follow research confidence', () => {
    expect(ctaOptions('crm', null)[0]).toBe('ideas_if_relevant');
    expect(ctaOptions('crm', 'medium')[0]).toBe('share_ideas');
    expect(ctaOptions('website', 'high')).toContain('site_review');
    expect(ctaOptions('crm', 'high')[0]).toBe('short_call');
  });

  it('claim sources: observed / search / inferred sentences, company, manual (angle only), sector', () => {
    const r = result({}, [signal('booking_flow', 'check'), signal('whatsapp_contact', 'analysis', ['w1']), signal('multiple_contact_channels', 'analysis', ['d1'])]);
    const angle = availableAngles(r, 'crm')[0];
    const sources = buildClaimSources({ company: company(), language: 'tr', angle, manualFacts: [{ id: 'f1', text: 'İki şubeleri var.' }], sectorSummary: 'Diş klinikleri…' });
    expect(sources.map((s) => s.id)).toEqual(['O1', 'I1', 'S1', 'C1', 'M1', 'G1']);
    expect(sources[0].text).toMatch(/^Sitenize baktığımda .* gördüm\.$/);
    expect(sources[1].text).toMatch(/düşünüyorum; bu bir tahmin olabilir\.$/);
    expect(sources[2].text).toMatch(/kaynaklar .* doğrulayamadım\.$/);
    const general = buildClaimSources({ company: company(), language: 'en', angle: null, manualFacts: [{ id: 'f1', text: 'x' }], sectorSummary: null });
    expect(general.map((s) => s.kind)).toEqual(['company']);
  });
});
