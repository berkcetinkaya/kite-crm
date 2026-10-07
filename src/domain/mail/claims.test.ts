// Phase 13: claim map validation for prepared drafts (prompt v2 output).
import { describe, expect, it } from 'vitest';
import type { Company } from '../company';
import { buildPrepContext, type PrepContext } from './prepContext';
import { validatePrepOutput } from './claims';
import type { AvailableAngle } from '../outreachAngles';

const AT = '2026-10-07T09:00:00.000Z';
const company: Company = {
  id: 'cmp_a', name: 'Aurora Dental', website: 'aurora.example', sector: 'Diş Kliniği', sectorId: 'dental_clinic', city: 'İstanbul', country: 'Türkiye',
  companySize: null, source: 'manual', owner: null, status: 'found', opportunityScore: null, opportunities: [], contacts: [], notes: [], history: [],
  lastContactAt: null, nextAction: null, createdAt: AT, updatedAt: AT,
};

const angle: AvailableAngle = {
  key: 'enquiry_handling', label: 'Talep ve rezervasyon akışı', service: 'crm', theme: 't', strength: 3,
  evidence: [
    { signalKey: 'booking_flow', label: 'Rezervasyon', kind: 'observed', reason: '', evidenceIds: ['w1'], url: 'https://aurora.example/' },
    { signalKey: 'whatsapp_contact', label: 'WhatsApp', kind: 'inferred', reason: '', evidenceIds: ['w1'], url: null },
    { signalKey: 'multiple_contact_channels', label: 'Kanallar', kind: 'search', reason: '', evidenceIds: ['d1'], url: null },
  ],
};

function ctx(over: Partial<Parameters<typeof buildPrepContext>[0]> = {}): PrepContext {
  return buildPrepContext({ company, contact: null, service: 'crm', language: 'tr', tone: 'premium', angle, general: false, angles: [angle], cta: 'ideas_if_relevant', manualFacts: [], mode: 'full', current: null, withVariants: false, ...over });
}
const O1 = (c: PrepContext) => c.sources.find((s) => s.id === 'O1')?.text ?? '';

function output(c: PrepContext, over: Record<string, unknown> = {}) {
  const obs = O1(c);
  return {
    subjectOptions: ['Aurora Dental için CRM önerisi', 'Aurora Dental hakkında kısa bir not', 'Talep akışı için bir fikir'],
    recommendedSubject: 'Aurora Dental hakkında kısa bir not',
    sections: { opening: 'Aurora Dental için CRM tarafında kısa bir fikir paylaşmak istedim.', observation: obs, value: 'KITE olarak sade CRM sistemleri kuruyoruz.', cta: 'Uygun görürseniz birkaç fikri kısaca paylaşabilirim.' },
    claims: [{ sentence: obs, sourceIds: ['O1'] }],
    serviceReasoning: 'not',
    variants: [],
    ...over,
  };
}
const problems = (c: PrepContext, raw: unknown) => {
  const r = validatePrepOutput(raw, c);
  return r.ok ? [] : r.problems;
};

describe('claim map validation', () => {
  it('accepts a draft whose company statements are all mapped to known sources', () => {
    const c = ctx();
    const r = validatePrepOutput(output(c), c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.body.startsWith('Merhaba Aurora Dental ekibi,')).toBe(true);
    expect(r.draft.body.endsWith('KITE Growth')).toBe(true);
    expect(r.draft.recommendedSubject).toBe('Aurora Dental hakkında kısa bir not');
    expect(r.draft.sections.map((s) => s.key)).toEqual(['opening', 'observation', 'value', 'cta']);
  });

  it('rejects unknown source ids and claims that are not in the body', () => {
    const c = ctx();
    expect(problems(c, output(c, { claims: [{ sentence: O1(c), sourceIds: ['O9'] }] })).join()).toMatch(/Bilinmeyen kaynak/);
    expect(problems(c, output(c, { claims: [{ sentence: O1(c), sourceIds: ['O1'] }, { sentence: 'Bu cümle yok.', sourceIds: ['C1'] }] })).join()).toMatch(/metinde yok/);
  });

  it('rejects a company-specific sentence missing from the claim map', () => {
    const c = ctx();
    expect(problems(c, output(c, { claims: [] })).join()).toMatch(/iddia haritasında yok/);
  });

  it('inferred claims must be hedged; search claims must be source-qualified; "gördüm" only on observed', () => {
    const c = ctx();
    const base = output(c);
    const flat = 'Sitenizde WhatsApp kullanıyorsunuz.';
    const inferred = { ...base, sections: { ...base.sections, observation: flat }, claims: [{ sentence: flat, sourceIds: ['I1'] }] };
    expect(problems(c, inferred).join()).toMatch(/temkinli/);
    const hedged = 'Sitenizdeki bilgilere göre WhatsApp üzerinden de iletişim kurduğunuzu düşünüyorum; bu bir tahmin olabilir.';
    expect(problems(c, { ...base, sections: { ...base.sections, observation: hedged }, claims: [{ sentence: hedged, sourceIds: ['I1'] }] })).toEqual([]);
    const unqualified = 'Müşterilerin size birkaç kanaldan ulaşabildiğini düşünüyorum.';
    expect(problems(c, { ...base, sections: { ...base.sections, observation: unqualified }, claims: [{ sentence: unqualified, sourceIds: ['S1'] }] }).join()).toMatch(/kaynağı belirtmeli/);
    const seen = 'Sitenize baktığımda WhatsApp kullandığınızı gördüm.';
    expect(problems(c, { ...base, sections: { ...base.sections, observation: seen }, claims: [{ sentence: seen, sourceIds: ['I1'] }] }).join()).toMatch(/yalnızca gözlenen/);
  });

  it('a draft with an angle must use its evidence', () => {
    const c = ctx();
    const base = output(c);
    expect(problems(c, { ...base, sections: { ...base.sections, observation: '' }, claims: [] }).join()).toMatch(/kanıtı metinde kullanılmadı/);
  });

  it('Genel tanıtım: no observation section, no company-specific observation, no evidence claims', () => {
    const c = ctx({ angle: null, general: true });
    expect(c.sources.map((s) => s.kind)).toEqual(['company', 'sector']);
    const ok = output(c, { sections: { opening: 'Aurora Dental için kısa bir CRM fikri paylaşmak istedim.', observation: '', value: 'Bu tür işletmelerde CRM randevu takibi için kullanılabiliyor.', cta: 'Uygun görürseniz birkaç fikri kısaca paylaşabilirim.' }, claims: [] });
    expect(problems(c, ok)).toEqual([]);
    const personal = output(c, { sections: { ...ok.sections, observation: 'x' }, claims: [] });
    expect(problems(c, personal).join()).toMatch(/gözlem bölümü boş/);
    const fake = output(c, { sections: { ...ok.sections, opening: 'Sitenize baktığımda güzel bir tasarım gördüm.' }, claims: [] });
    expect(problems(c, fake).join()).toMatch(/Genel tanıtımda şirkete özel gözlem olamaz/);
  });

  it('forbidden topics and numbers need a manual fact', () => {
    const c = ctx();
    const base = output(c);
    const traffic = { ...base, sections: { ...base.sections, value: 'Trafiğinizi artırabiliriz. KITE olarak sade CRM sistemleri kuruyoruz.' } };
    expect(problems(c, traffic).join()).toMatch(/manuel bir kayda dayanmadan/);
    const percent = { ...base, sections: { ...base.sections, value: 'Benzer işletmelerde talepler %30 artıyor.' } };
    expect(problems(c, percent).join()).toMatch(/manuel bir kayda dayanmadan/);
    const money = { ...base, subjectOptions: ['Aurora Dental için 5000 TL', 'Aurora Dental hakkında kısa bir not', 'Bir fikir'] };
    expect(problems(c, money).join()).toMatch(/manuel bir kayda dayanmadan/);
    const withFact = ctx({ manualFacts: [{ id: 'f1', text: 'Ekip 12 kişi.' }] });
    const team = 'Paylaştığınız üzere 12 kişilik ekibiniz için sade bir yapı uygun olabilir.';
    const b2 = output(withFact);
    expect(problems(withFact, { ...b2, sections: { ...b2.sections, value: team }, claims: [...b2.claims, { sentence: team, sourceIds: ['M1'] }] })).toEqual([]);
  });

  it('fake familiarity, audits, urgency and fake Re: subjects are rejected; KITE Growth is not "growth"', () => {
    const c = ctx();
    const base = output(c);
    expect(problems(c, { ...base, sections: { ...base.sections, opening: 'Geçen hafta konuştuğumuz gibi yazıyorum.' } }).join()).toMatch(/Sahte tanışıklık/);
    expect(problems(c, { ...base, sections: { ...base.sections, opening: 'We audited your funnel.' } }).join()).toMatch(/Sahte tanışıklık/);
    expect(problems(c, { ...base, sections: { ...base.sections, cta: 'Hemen dönüş yapın.' } }).join()).toMatch(/Aciliyet/);
    expect(problems(c, { ...base, subjectOptions: ['Re: Aurora Dental', 'b', 'c'] }).join()).toMatch(/sahte yanıt/);
    expect(problems(c, base)).toEqual([]);
  });

  it('Phase 5 output rules still apply: hype, spammy or shouting subjects, missing subjects, length, problem claims', () => {
    const c = ctx();
    const base = output(c);
    expect(problems(c, { ...base, sections: { ...base.sections, value: 'Bu, işinizi bir üst seviyeye taşır.' } }).join()).toMatch(/Abartılı/);
    expect(problems(c, { ...base, sections: { ...base.sections, value: 'A real game changer for you.' } }).join()).toMatch(/Abartılı/);
    expect(problems(c, { ...base, subjectOptions: ['FREE CRM audit', 'b', 'c'] }).join()).toMatch(/spam/);
    expect(problems(c, { ...base, subjectOptions: ['Urgent: your CRM', 'b', 'c'] }).join()).toMatch(/spam/);
    expect(problems(c, { ...base, subjectOptions: ['Quick idea!!', 'b', 'c'] }).join()).toMatch(/spam/);
    expect(problems(c, { ...base, subjectOptions: ['Only one'] }).join()).toMatch(/Üç konu/);
    expect(problems(c, { ...base, sections: { ...base.sections, value: 'kelime '.repeat(200) } }).join()).toMatch(/çok uzun/);
    expect(problems(c, { ...base, sections: { ...base.sections, value: 'Randevu süreçleriniz dağınık ve verimsiz.' } }).join()).toMatch(/sorun iddiası/);
  });

  it('dash punctuation is converted (noted), not rejected', () => {
    const c = ctx();
    const base = output(c);
    const r = validatePrepOutput({ ...base, sections: { ...base.sections, value: 'KITE olarak — sade CRM sistemleri kuruyoruz.' } }, c);
    expect(r.ok && r.warnings).toEqual(['Tire noktalaması virgüle çevrildi.']);
  });

  it('partial regeneration takes only the requested part and keeps still-present claims', () => {
    const c = ctx();
    const first = validatePrepOutput(output(c), c);
    if (!first.ok) throw new Error('setup');
    const current = { sections: first.draft.sections, subjectOptions: first.draft.subjectOptions, claims: first.draft.claims };
    const pc = ctx({ mode: 'opening', current });
    const r = validatePrepOutput(output(pc, { sections: { opening: 'Yeni bir giriş cümlesi.', observation: 'DEĞİŞMEMELİ', value: 'DEĞİŞMEMELİ', cta: 'DEĞİŞMEMELİ' }, claims: [] }), pc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.sections.find((s) => s.key === 'opening')!.text).toBe('Yeni bir giriş cümlesi.');
    expect(r.draft.sections.find((s) => s.key === 'value')!.text).toBe(first.draft.sections.find((s) => s.key === 'value')!.text);
    expect(r.draft.claims).toEqual(first.draft.claims);
    const sc = ctx({ mode: 'subject', current });
    const s = validatePrepOutput(output(sc, { subjectOptions: ['Yeni konu 1', 'Yeni konu 2', 'Yeni konu 3'], recommendedSubject: 'Yeni konu 2' }), sc);
    expect(s.ok && s.draft.body).toBe(first.draft.body);
    expect(s.ok && s.draft.recommendedSubject).toBe('Yeni konu 2');
  });

  it('variants are validated with their own sources and must differ from the main draft', () => {
    const c = ctx({ withVariants: true, angles: [angle] });
    expect(c.variants.map((v) => v.tone)).toEqual(['direct']);
    const main = output(c);
    const same = { ...main, variants: [{ id: 'v1', subjectOptions: main.subjectOptions, recommendedSubject: main.recommendedSubject, sections: main.sections, claims: main.claims }] };
    expect(problems(c, same).join()).toMatch(/çok benziyor/);
    const missing = { ...main, variants: [] };
    expect(problems(c, missing).join()).toMatch(/alternatif üretilmedi/);
  });
});
