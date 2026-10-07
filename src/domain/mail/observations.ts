// Company observations a first email may mention. Each one comes from a Phase 4 signal that the
// research classified as positive WITH evidence (or measured on a page KITE inspected). The
// wording states only what the evidence shows, never a problem the company did not show.
//
// `tr` is an accusative clause ("…aldığınızı") and `en` a "that" clause, so the same fact can be
// framed as seen on the website ("Sitenize baktığımda … gördüm") or, when the website could not be
// inspected, as reported by public sources ("… gösteren kaynaklar var").
import type { MailLanguage } from './draft';

export interface ObservationTemplate {
  tr: string;
  en: string;
}

export const OBSERVATION_TEMPLATES: Record<string, ObservationTemplate> = {
  // CRM
  booking_flow: { tr: 'rezervasyon veya randevu taleplerini online aldığınızı', en: 'you take bookings or appointment requests online' },
  lead_or_quote_forms: { tr: 'teklif ve talep formlarıyla başvuru topladığınızı', en: 'you collect enquiries through quote and request forms' },
  multiple_locations: { tr: 'birden fazla lokasyonda hizmet verdiğinizi', en: 'you operate from more than one location' },
  multi_location: { tr: 'birden fazla lokasyonda hizmet verdiğinizi', en: 'you operate from more than one location' },
  service_breadth: { tr: 'geniş bir hizmet yelpazesi sunduğunuzu', en: 'you offer a wide range of services' },
  whatsapp_contact: { tr: 'müşterilerle WhatsApp üzerinden de iletişim kurduğunuzu', en: 'you also talk to customers on WhatsApp' },
  multiple_contact_channels: { tr: 'müşterilerin size birkaç farklı kanaldan ulaşabildiğini', en: 'customers can reach you through several channels' },
  high_touch_sales: { tr: 'satış sürecinizin görüşme ve teklif adımları içerdiğini', en: 'your sales process includes consultations and quotes' },
  journey_complexity: { tr: 'müşteri sürecinizin birkaç adımdan oluştuğunu', en: 'your customer journey has several steps' },
  // Website
  missing_viewport: { tr: 'ana sayfada mobil görüntüleme ayarının (viewport) bulunmadığını', en: 'the homepage does not set a mobile viewport' },
  weak_cta: { tr: 'ana sayfada randevu, teklif ya da iletişim için belirgin bir çağrı olmadığını', en: 'the homepage has no clear call to book, request a quote or get in touch' },
  no_enquiry_path: { tr: 'incelenen sayfalarda form, rezervasyon ya da WhatsApp yolu bulunmadığını', en: 'the pages we looked at have no form, booking or WhatsApp path' },
  not_https: { tr: 'sitenin HTTPS kullanmadığını', en: 'the site is not served over HTTPS' },
  // Google Ads / Meta / social
  conversion_points: { tr: 'sitenizde talep toplamaya uygun dönüşüm noktaları olduğunu', en: 'the site already has clear points where visitors can enquire' },
  social_presence_linked: { tr: 'sitenizden sosyal medya hesaplarınıza bağlantı verdiğinizi', en: 'you link to your social media profiles from the site' },
  social_profiles_found: { tr: 'sitenizden sosyal medya hesaplarınıza bağlantı verdiğinizi', en: 'you link to your social media profiles from the site' },
  ecommerce: { tr: 'sitenizde online satış yaptığınızı', en: 'you sell online through your website' },
  ecommerce_catalogue: { tr: 'sitenizde online satış yaptığınızı', en: 'you sell online through your website' },
  // SEO
  missing_meta_basics: { tr: 'ana sayfada başlık ya da meta açıklamanın eksik olduğunu', en: 'the homepage is missing a title or meta description' },
  structured_data_missing: { tr: 'sitede yapılandırılmış veri (schema) bulunmadığını', en: 'the site has no structured data markup' },
};

/** Seen on a page KITE inspected. */
export function inspectedSentence(t: ObservationTemplate, lang: MailLanguage): string {
  return lang === 'tr' ? `Sitenize baktığımda ${t.tr} gördüm.` : `Looking at your website, I saw that ${t.en}.`;
}

/** Reported by search sources only; KITE could not confirm it on the website. */
export function searchSentence(t: ObservationTemplate, lang: MailLanguage): string {
  return lang === 'tr'
    ? `Hakkınızdaki kaynaklar ${t.tr} gösteriyor, ancak bunu sitenizden doğrulayamadım.`
    : `Public sources suggest that ${t.en}, although I could not confirm it on your website.`;
}

/** Inferred from inspected pages (Çıkarım): always hedged. */
export function inferredSentence(t: ObservationTemplate, lang: MailLanguage): string {
  return lang === 'tr' ? `Sitenizdeki bilgilere göre ${t.tr} düşünüyorum; bu bir tahmin olabilir.` : `From your website, it seems that ${t.en}.`;
}
