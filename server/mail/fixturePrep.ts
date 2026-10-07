// Deterministic offline writer for prepared drafts (prompt v2). Follows the same rules as the
// model: sections only, company statements copied from the claim sources, a claim map for every
// company-specific sentence, wording that varies with the tone. Test hooks (company name prefix):
//   "Provider Down …"  provider outage
//   "Unsafe Once …"    first attempt makes an unsupported claim (exercises the repair retry)
//   "Always Unsafe …"  every attempt makes an unsupported claim
import type { PrepContext, PrepAngle } from '../../src/domain/mail/prepContext';
import type { OutreachTone } from '../../src/domain/outreachAngles';
import type { ClaimMapEntry } from '../../src/domain/outreachPrep';
import { ProviderError } from '../research/provider';

type Lang = 'tr' | 'en';
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

const OPENINGS: Record<OutreachTone, (name: string, svc: string, lang: Lang) => string[]> = {
  premium: (n, s, l) => (l === 'tr' ? [`${n} için ${s} tarafında kısa bir fikir paylaşmak istedim.`, `${n} ile ilgili aklıma gelen sade bir ${s} fikrini iletmek istedim.`] : [`I wanted to share a short ${s} idea for ${n}.`, `A simple ${s} thought for ${n} came to mind, so I wanted to pass it on.`]),
  direct: (n, s, l) => (l === 'tr' ? [`Kısaca yazıyorum: ${n} için bir ${s} önerim var.`, `Doğrudan konuya gireyim, ${n} için bir ${s} fikri.`] : [`Briefly: I have a ${s} suggestion for ${n}.`, `Straight to the point, a ${s} idea for ${n}.`]),
  consultative: (n, s, l) => (l === 'tr' ? [`${n} için ${s} tarafında birlikte değerlendirilebilecek bir konu düşündüm.`, `${n} için ${s} tarafında konuşmaya değer bir başlık olabilir diye düşündüm.`] : [`I thought there might be a ${s} topic worth exploring together with ${n}.`, `There may be a ${s} question worth talking through for ${n}.`]),
  performance: (n, s, l) => (l === 'tr' ? [`${n} için ${s} tarafında daha fazla talep almaya yönelik bir fikrim var.`, `${n} için ${s} tarafında talepleri netleştirmeye dönük bir önerim var.`] : [`I have a ${s} idea aimed at bringing ${n} more enquiries.`, `I have a ${s} suggestion focused on clearer enquiries for ${n}.`]),
};

const VALUE_LEAD: Record<OutreachTone, Record<Lang, string>> = {
  premium: { tr: 'Bu tür işletmelerde bunu sade ve düzenli kurmak fark yaratabiliyor.', en: 'For businesses like this, setting it up simply and calmly can make a difference.' },
  direct: { tr: 'Kurulumu kısa sürer ve günlük işi zorlaştırmaz.', en: 'It is quick to set up and does not get in the way of daily work.' },
  consultative: { tr: 'Önce mevcut işleyişi anlayıp ona göre bir yapı önermeyi tercih ediyoruz.', en: 'We prefer to understand how things work today and suggest a structure around it.' },
  performance: { tr: 'Odak noktamız gelen talebi netleştirmek ve takip edilebilir adımlar kurmak.', en: 'Our focus is on clearer enquiries and steps that can be followed up.' },
};

const SUBJECTS = (n: string, svc: string, angle: PrepAngle | null, tone: OutreachTone, lang: Lang): string[] => {
  const t = tone === 'premium' ? '' : tone === 'direct' ? (lang === 'tr' ? ' (kısa)' : ' (short)') : tone === 'consultative' ? (lang === 'tr' ? ' üzerine' : ', a thought') : lang === 'tr' ? ' ve talepler' : ' and enquiries';
  return lang === 'tr'
    ? [`${n} için ${svc} önerisi${t}`, `${n} hakkında kısa bir not`, `${angle ? angle.label : svc} için bir fikir`]
    : [`A ${svc} suggestion for ${n}${t}`, `A short note about ${n}`, `An idea on ${angle ? angle.label : svc}`];
};

interface Composed {
  subjectOptions: string[];
  recommendedSubject: string;
  sections: { opening: string; observation: string; value: string; cta: string };
  claims: ClaimMapEntry[];
}

function compose(ctx: PrepContext, tone: OutreachTone, angle: PrepAngle | null, sourceIds: readonly string[], openingIndex: number, unsafe: boolean): Composed {
  const lang = ctx.language;
  const evidence = ctx.sources.filter((s) => sourceIds.includes(s.id) && (s.kind === 'observed' || s.kind === 'search' || s.kind === 'inferred')).slice(0, 2);
  const claims: ClaimMapEntry[] = evidence.map((s) => ({ sentence: s.text, sourceIds: [s.id] }));
  const observation = ctx.general ? '' : evidence.map((s) => s.text).join(' ');
  const opening = OPENINGS[tone](ctx.company.name, ctx.serviceName, lang)[openingIndex % 2];
  const valueParts = [ctx.servicePitch, VALUE_LEAD[tone][lang]];
  if (ctx.general && ctx.sectorUseCases.length) {
    valueParts.push(lang === 'tr' ? `Benzer işletmelerde bu genellikle ${ctx.sectorUseCases[0]} gibi işler için kullanılıyor.` : `Similar businesses often use it for things like ${ctx.sectorUseCases[0]}.`);
  }
  let value = valueParts.join(' ');
  if (unsafe) {
    // Unsupported claim: inferred-style statement without a source and a made-up number.
    const bad = lang === 'tr' ? 'Sitenizin trafiği son yılda %20 düştü.' : 'Your website traffic dropped 20% last year.';
    value = `${value} ${bad}`;
  }
  // The CTA text may already carry its own condition ("uygunsa …", "isterseniz …"); never add a second one.
  const conditional = /^(uygun|isterseniz|if)/i.test(ctx.cta.text);
  const cta = `${cap(tone === 'direct' || conditional || lang !== 'tr' ? ctx.cta.text : `uygun görürseniz ${ctx.cta.text}`)}.`;
  const subjects = SUBJECTS(ctx.company.name, ctx.serviceName, angle, tone, lang);
  return { subjectOptions: subjects, recommendedSubject: subjects[0], sections: { opening, observation, value, cta }, claims };
}

export function composeFixturePrepared(ctx: PrepContext): unknown {
  const name = ctx.company.name;
  if (name.startsWith('Provider Down')) throw new ProviderError('unavailable', 'fixture: provider down');
  const unsafe = name.startsWith('Always Unsafe') || (name.startsWith('Unsafe Once') && ctx.repairProblems.length === 0);
  // Partial regeneration produces a different wording than the current one.
  const currentOpening = ctx.current?.sections.find((s) => s.key === 'opening')?.text ?? '';
  const openings = OPENINGS[ctx.tone](name, ctx.serviceName, ctx.language);
  const openingIndex = ctx.mode === 'opening' && currentOpening === openings[0] ? 1 : 0;
  const main = compose(ctx, ctx.tone, ctx.angle, ctx.sourceIds, openingIndex, unsafe);
  if (ctx.mode === 'cta') main.sections.cta = ctx.language === 'tr' ? `${cap(ctx.cta.text)}; nasıl isterseniz.` : `${cap(ctx.cta.text)}, whatever suits you.`;
  if (ctx.mode === 'subject') {
    const alt = ctx.language === 'tr' ? [`${name}: kısa bir ${ctx.serviceName} fikri`, `${name} için bir soru`, `${ctx.serviceName} hakkında kısa bir not`] : [`${name}: a short ${ctx.serviceName} idea`, `A question for ${name}`, `A short note on ${ctx.serviceName}`];
    main.subjectOptions = alt;
    main.recommendedSubject = alt[0];
  }
  const variants = ctx.mode === 'full' ? ctx.variants.map((v) => ({ id: v.id, ...compose(ctx, v.tone, v.angle, v.sourceIds, 1, false) })) : [];
  return {
    ...main,
    serviceReasoning: ctx.general
      ? 'Şirkete özel kanıta dayanan bir açı yok; açıkça seçilen genel tanıtım kullanıldı.'
      : `${ctx.angle?.label ?? ''} açısı, araştırmadaki ${main.claims.length} kanıta dayanıyor.`,
    variants,
  };
}
