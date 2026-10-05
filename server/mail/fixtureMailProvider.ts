// Deterministic offline mail generator. It follows the same rules as the model prompt so the
// pipeline, the safety checks and the UI can be exercised without an API key or any cost:
//   greeting → (one evidence-backed observation) → reason for the opportunity → service →
//   (sector use cases, worded as general guidance) → low pressure CTA → sign off.
// Company statements only come from ctx.companyEvidence; sector use cases are always phrased as
// "businesses like this often…", never as a fact about the company.
import { CURRENT_USER } from '../../src/domain/company';
import type { MailContext } from '../../src/domain/mail/context';
import type { MailModelOutput } from '../../src/domain/mail/safety';
import { ProviderError } from '../research/provider';
import type { MailProviderAdapter } from './provider';

function list(items: string[], lang: 'tr' | 'en'): string {
  if (items.length <= 1) return items.join('');
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(', ')} ${lang === 'tr' ? 've' : 'and'} ${last}`;
}

export function composeFixtureMail(ctx: MailContext): MailModelOutput {
  const lang = ctx.language;
  const tr = lang === 'tr';
  const name = ctx.company.name;
  const svc = ctx.serviceGuidance.name[lang];
  const obs = ctx.personalization === 'general' ? undefined : ctx.companyEvidence.observations[0];

  const greeting = ctx.company.greetingName
    ? tr ? `Merhaba ${ctx.company.greetingName},` : `Hi ${ctx.company.greetingName},`
    : tr ? `Merhaba ${name} ekibi,` : `Hello ${name} team,`;

  const paragraphs: string[] = [greeting];

  if (obs) {
    const why =
      ctx.personalization === 'specific'
        ? tr ? `Bu yapıda ${name} için ${svc} tarafında somut bir fayda görüyoruz.` : `With that kind of setup, we see a clear opportunity for ${name} on the ${svc} side.`
        : tr ? `Bu yüzden ${name} için ${svc} tarafında bir fırsat olabileceğini düşündüm.` : `That is why I thought ${svc} might be worth a look for ${name}.`;
    paragraphs.push(`${obs.sentence} ${why}`);
  } else {
    paragraphs.push(
      tr
        ? `${name} için ${svc} tarafında faydalı olabilecek bir fikri kısaca paylaşmak istedim.`
        : `I wanted to briefly share an idea on the ${svc} side that could be useful for ${name}.`,
    );
  }

  paragraphs.push(ctx.serviceGuidance.pitch[lang]);

  const g = ctx.sectorGuidance;
  const benefits = g ? g.useCases.slice(0, 3) : [];
  if (g && benefits.length) {
    // General sector guidance, framed as what similar businesses do; never as a fact about them.
    const items = list(benefits.map((u) => (tr ? u.tr : u.en)), lang);
    paragraphs.push(
      tr
        ? `Benzer işletmelerde CRM, ${items} gibi süreçleri tek yerde toplamak için kullanılıyor.`
        : `In similar businesses, a CRM is typically used to keep ${items} in one place.`,
    );
  }

  paragraphs.push(ctx.serviceGuidance.cta[lang]);
  paragraphs.push(`${tr ? 'İyi çalışmalar,' : 'Best regards,'}\n${CURRENT_USER}\nKITE Growth`);

  const subjectOptions = tr
    ? [`${name} için ${svc} fikri`, `${name} ve ${svc}`, `Kısa bir ${svc} önerisi`]
    : [`An idea for ${name}`, `${ctx.serviceGuidance.name.en} for ${name}`, `A quick ${svc} thought`];

  return {
    subjectOptions,
    body: paragraphs.join('\n\n'),
    companyObservation: obs?.sentence ?? null,
    serviceReasoning: obs
      ? `Araştırmadaki ${obs.strength === 'inspected' ? 'incelenen website' : 'arama sonucu'} kanıtına dayanan bir gözlem, ${ctx.serviceLabel} hizmetiyle birleştirildi.`
      : `Şirkete özel kullanılabilir kanıt yok; ${ctx.serviceLabel} hizmeti ${g ? 've sektörel kullanım alanları' : ''} genel bir dille anlatıldı.`.replace(/\s+;/, ';').replace(/\s{2,}/g, ' '),
    sectorBenefitsUsed: benefits.map((u) => u.id),
    evidenceRefsUsed: obs?.evidenceIds ?? [],
    sectorProfileUsed: g && benefits.length ? g.profileId : null,
  };
}

export function createFixtureMailProvider(): MailProviderAdapter {
  return {
    id: 'fixture',
    model: null,
    async generate(ctx) {
      // Test hook: a company named "Provider Down …" simulates a provider outage.
      if (ctx.company.name.startsWith('Provider Down')) throw new ProviderError('unavailable', 'fixture: provider down');
      return composeFixtureMail(ctx);
    },
  };
}
