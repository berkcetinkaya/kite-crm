// How each KITE service is explained in a first email. Kept short on purpose: no long KITE
// introductions. CRM additionally uses sector intelligence (sectorIntelligence/); the other
// services are pitched from Phase 4 opportunity evidence. Adding sector intelligence for another
// service later only needs a resolver in sectorIntelligence/index.ts.
import { hasSectorIntelligence } from '../sectorIntelligence';
import { SERVICES, type ServiceKey } from '../services';
import type { MailLanguage } from './draft';

export interface ServiceGuidance {
  service: ServiceKey;
  label: string;
  /** Service name inside an email. The UI label stays Turkish; English mails need English names. */
  name: Record<MailLanguage, string>;
  /** One sentence on what KITE does for this service. */
  pitch: Record<MailLanguage, string>;
  /** Low pressure closing line. */
  cta: Record<MailLanguage, string>;
  /** What the message is built on beyond company evidence. */
  basis: 'sector_intelligence' | 'opportunity_evidence';
}

const PITCH: Record<ServiceKey, Record<MailLanguage, string>> = {
  crm: {
    tr: 'KITE olarak işletmelerin mevcut çalışma şekline göre kurulan, sade bir CRM ve operasyon sistemi hazırlıyoruz.',
    en: 'At KITE we set up simple CRM and operations systems built around how a business already works.',
  },
  website: {
    tr: 'KITE olarak hızlı, mobil uyumlu ve ziyaretçiyi talebe dönüştürmeye odaklı websiteler hazırlıyoruz.',
    en: 'At KITE we build fast, mobile friendly websites focused on turning visits into enquiries.',
  },
  google_ads: {
    tr: 'KITE olarak Google Ads kampanyalarını gerçekten talep getiren aramalara odaklanarak kurup yönetiyoruz.',
    en: 'At KITE we set up and run Google Ads campaigns focused on the searches that actually bring enquiries.',
  },
  meta_ads: {
    tr: 'KITE olarak Instagram ve Facebook reklamlarını ölçülebilir talep getirecek şekilde kurup yönetiyoruz.',
    en: 'At KITE we run Instagram and Facebook ads set up to bring measurable enquiries.',
  },
  social_media: {
    tr: 'KITE olarak markaların sosyal medya hesaplarını düzenli ve tutarlı içeriklerle yönetiyoruz.',
    en: 'At KITE we manage brand social media accounts with a steady, consistent content plan.',
  },
  creative: {
    tr: 'KITE olarak reklam ve sosyal medya için görsel ve video içerikler üretiyoruz.',
    en: 'At KITE we produce image and video creative for ads and social media.',
  },
  seo: {
    tr: 'KITE olarak sitelerin doğru aramalarda görünmesi için teknik ve içerik tarafında SEO çalışması yapıyoruz.',
    en: 'At KITE we do technical and content SEO so a site shows up for the right searches.',
  },
};

const NAME: Record<ServiceKey, Record<MailLanguage, string>> = {
  crm: { tr: 'CRM', en: 'CRM' },
  website: { tr: 'website', en: 'website' },
  google_ads: { tr: 'Google Ads', en: 'Google Ads' },
  meta_ads: { tr: 'Meta reklamları', en: 'Meta ads' },
  social_media: { tr: 'sosyal medya yönetimi', en: 'social media management' },
  creative: { tr: 'reklam kreatifleri', en: 'ad creative' },
  seo: { tr: 'SEO', en: 'SEO' },
};

const CTA_CRM: Record<MailLanguage, string> = {
  tr: 'Uygunsa, sizin operasyonunuz için bunu nasıl kurgulayacağımızı gösteren basit bir örnek paylaşabilirim.',
  en: 'If this is relevant for you, I can show you a simple example of how we would structure it for your operation.',
};

const CTA_OTHER: Record<MailLanguage, string> = {
  tr: 'Uygunsa, sizin için önereceğimiz yaklaşımı kısa bir örnekle paylaşabilirim.',
  en: 'If it is relevant, I can share a short example of the approach we would suggest for you.',
};

export function serviceGuidance(service: ServiceKey): ServiceGuidance {
  return {
    service,
    label: SERVICES[service].label,
    name: NAME[service],
    pitch: PITCH[service],
    cta: service === 'crm' ? CTA_CRM : CTA_OTHER,
    basis: hasSectorIntelligence(service) ? 'sector_intelligence' : 'opportunity_evidence',
  };
}
