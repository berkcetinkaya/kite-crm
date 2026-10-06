// Deterministic offline follow up generator (Phase 7). Follows the same rules as the follow up prompt
// so the pipeline, the safety checks and the UI work without an API key or any cost:
//   1. gentle reminder (no repeated pitch) · 2. one new angle (an unused sector use case, or a
//   service specific example) · 3. close the loop politely.
// Company statements only come from previously used, evidence backed observations; sector use cases
// are always phrased as what similar businesses do.
import { CURRENT_USER } from '../../src/domain/company';
import type { FollowUpContext } from '../../src/domain/mail/followUpContext';
import type { FollowUpModelOutput } from '../../src/domain/mail/followUpSafety';
import type { MailLanguage } from '../../src/domain/mail/draft';
import type { ServiceKey } from '../../src/domain/services';

/** Step 2 angle for services without sector intelligence (or when every use case was used). */
const SERVICE_ANGLES: Record<ServiceKey, Record<MailLanguage, { id: string; text: string }>> = {
  crm: {
    tr: { id: 'simple_structure', text: 'Çoğu zaman ilk adım büyük bir sistem değil, talepleri ve takipleri tek bir ekranda toplayan sade bir yapı oluyor.' },
    en: { id: 'simple_structure', text: 'Often the first step is not a big system but one simple screen where enquiries and follow ups live together.' },
  },
  website: {
    tr: { id: 'enquiry_path', text: 'Benzer işletmelerde en çok fark yaratan şey genellikle ziyaretçinin tek adımda talep bırakabildiği sade bir iletişim akışı oluyor.' },
    en: { id: 'enquiry_path', text: 'For similar businesses the biggest difference usually comes from a simple path that lets a visitor leave an enquiry in one step.' },
  },
  google_ads: {
    tr: { id: 'search_intent', text: 'Benzer işletmelerde bütçenin büyük kısmı genellikle az sayıda, gerçekten talep getiren aramadan geri dönüyor.' },
    en: { id: 'search_intent', text: 'For similar businesses most of the return usually comes from a small set of searches that genuinely bring enquiries.' },
  },
  meta_ads: {
    tr: { id: 'creative_testing', text: 'Benzer işletmelerde birkaç farklı görseli küçük bütçelerle denemek, hangi mesajın talep getirdiğini hızlıca gösteriyor.' },
    en: { id: 'creative_testing', text: 'For similar businesses, testing a few different visuals on small budgets quickly shows which message brings enquiries.' },
  },
  social_media: {
    tr: { id: 'content_rhythm', text: 'Benzer markalarda düzenli ve önceden planlanmış küçük bir içerik takvimi, tek seferlik büyük paylaşımlardan daha iyi sonuç veriyor.' },
    en: { id: 'content_rhythm', text: 'For similar brands a small, planned content rhythm tends to work better than occasional big posts.' },
  },
  creative: {
    tr: { id: 'visual_consistency', text: 'Benzer markalarda tutarlı birkaç görsel şablon, her paylaşımı sıfırdan hazırlamaktan çok daha fazla zaman kazandırıyor.' },
    en: { id: 'visual_consistency', text: 'For similar brands a few consistent visual templates save far more time than designing every piece from scratch.' },
  },
  seo: {
    tr: { id: 'service_pages', text: 'Benzer işletmelerde her hizmet için ayrı ve net bir sayfa, aramalarda görünürlüğü genellikle en hızlı artıran adım oluyor.' },
    en: { id: 'service_pages', text: 'For similar businesses a clear page per service is usually the quickest way to show up in more searches.' },
  },
};

export function composeFixtureFollowUp(ctx: FollowUpContext): FollowUpModelOutput {
  const base = ctx.base;
  const lang = base.language;
  const tr = lang === 'tr';
  const name = base.company.name;
  const svc = base.serviceGuidance.name[lang];
  const greeting = base.company.greetingName
    ? tr ? `Merhaba ${base.company.greetingName},` : `Hi ${base.company.greetingName},`
    : tr ? `Merhaba ${name} ekibi,` : `Hello ${name} team,`;
  const signOff = `${tr ? 'İyi çalışmalar,' : 'Best,'}\n${CURRENT_USER}\nKITE Growth`;
  const considered = ctx.previousMessages.map((m) => m.ref);

  let middle: string[];
  let angle: string;
  let benefits: string[] = [];
  let evidence: string[] = [];
  let observation: string | null = null;
  let reasoning: string;

  if (ctx.purpose === 'gentle_reminder') {
    angle = 'gentle_reminder';
    middle = tr
      ? [`Birkaç gün önce ${svc} konusunda kısa bir not göndermiştim, ona nazikçe hatırlatma olsun diye yazıyorum.`, `Uygun olursa ${name} için nasıl bir yapı düşündüğümüzü basit bir örnekle paylaşabilirim.`]
      : [`A few days ago I sent a short note about ${svc}, so this is just a gentle reminder.`, `If it helps, I can share a simple example of the setup we would suggest for ${name}.`];
    reasoning = 'Kısa ve baskısız bir hatırlatma; ilk maildeki tanıtım tekrar edilmedi.';
  } else if (ctx.purpose === 'new_angle') {
    const g = base.sectorGuidance;
    const unused = g?.useCases.find((u) => ctx.unusedBenefitIds.includes(u.id));
    // A previously used, evidence backed observation may be reused once (specific research only).
    const prevObs = base.personalization === 'specific' ? base.companyEvidence.observations.find((o) => o.evidenceIds.every((id) => ctx.usedEvidenceIds.includes(id))) : undefined;
    if (unused) {
      angle = unused.id;
      benefits = [unused.id];
      middle = tr
        ? [`Önceki notuma küçük bir ekleme yapmak istedim. Benzer işletmelerde ${svc} çoğu zaman ${unused.tr.toLocaleLowerCase('tr-TR')} için de kullanılıyor.`]
        : [`One small addition to my earlier note. In similar businesses, ${svc} is often used for ${unused.en.toLowerCase()} as well.`];
      reasoning = 'İlk mailde kullanılmayan bir sektörel kullanım alanı yeni açı olarak eklendi (genel bilgi, şirket hakkında iddia değil).';
    } else {
      const a = SERVICE_ANGLES[base.service][lang];
      angle = a.id;
      middle = [tr ? `Önceki notuma küçük bir ekleme yapmak istedim. ${a.text}` : `One small addition to my earlier note. ${a.text}`];
      reasoning = `${base.serviceLabel} hizmeti için tek bir yeni ve genel açı eklendi.`;
    }
    if (prevObs) {
      observation = prevObs.sentence;
      evidence = prevObs.evidenceIds;
      middle.push(tr ? `Daha önce yazdığım gibi, bu ${name} tarafında da işe yarayabilir.` : `As I wrote before, this could be useful on the ${name} side too.`);
      reasoning += ' Daha önce kullanılan, kanıta dayalı gözlem yeniden kullanıldı; yeni bir şirket bilgisi eklenmedi.';
    }
    middle.push(tr ? `İsterseniz bunun ${name} için nasıl görünebileceğini basit bir taslakla gösterebilirim.` : `If you like, I can show what this could look like for ${name} in a simple mockup.`);
  } else {
    angle = 'close_loop';
    middle = tr
      ? [`${svc} konusundaki notlarımı burada toparlamak istedim.`, 'Şu an önceliğiniz değilse hiç sorun değil, konuyu burada bırakabilirim. İleride bakmak isterseniz bu maile yanıt vermeniz yeterli.']
      : [`I wanted to close the loop on my notes about ${svc}.`, 'If this is not a priority right now, no problem at all, I can leave it here. If it becomes relevant later, a reply to this email is all it takes.'];
    reasoning = 'Konuyu nazikçe kapatan, devam etmemeyi kolaylaştıran son takip.';
  }

  return {
    body: [greeting, middle.join(' '), signOff].join('\n\n'),
    followUpAngle: angle,
    companyObservation: observation,
    serviceReasoning: reasoning,
    sectorBenefitsUsed: benefits,
    evidenceRefsUsed: evidence,
    previousMessagesConsidered: considered,
    stepNumber: ctx.stepNumber,
  };
}
