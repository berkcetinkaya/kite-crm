// KITE service catalogue. Keys are stable; labels are for display only.

export const SERVICE_KEYS = [
  'crm',
  'website',
  'google_ads',
  'meta_ads',
  'social_media',
  'creative',
  'seo',
] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICES: Record<ServiceKey, { label: string; shortLabel: string }> = {
  crm: { label: 'CRM', shortLabel: 'CRM' },
  website: { label: 'Website Yenileme', shortLabel: 'Website' },
  google_ads: { label: 'Google Ads', shortLabel: 'Google Ads' },
  meta_ads: { label: 'Meta Ads', shortLabel: 'Meta Ads' },
  social_media: { label: 'Sosyal Medya Yönetimi', shortLabel: 'Sosyal Medya' },
  creative: { label: 'Creative', shortLabel: 'Creative' },
  seo: { label: 'SEO', shortLabel: 'SEO' },
};

/** "Website Yenileme" for one service, "CRM + Google Ads" for a bundle. */
export function formatServiceBundle(keys: readonly ServiceKey[]): string {
  if (keys.length === 1) return SERVICES[keys[0]].label;
  return keys.map((k) => SERVICES[k].shortLabel).join(' + ');
}
