// Mail & Takip links, kept separate from MailPage so other pages can link here without loading it.
export const MAIL_ROUTE = '#/outreach';

/** Opens Mail & Takip with a company selected (used by Potansiyel Müşteriler). */
export function mailHref(companyId: string): string {
  return `${MAIL_ROUTE}?company=${encodeURIComponent(companyId)}`;
}
