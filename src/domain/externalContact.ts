// Harici temas (Phase 14): a real sales interaction that happened outside KITE (WhatsApp, phone, in
// person). Stored as one company history entry of type "external_contact" (no new table): the entry's
// date is when the contact happened, its text carries the channel and an optional short note. It
// counts as meaningful sales activity; it never changes the stage, the next action or any record.
import type { Company, CompanyHistoryEntry } from './company';

export const EXTERNAL_CONTACT_CHANNELS = ['whatsapp', 'phone', 'in_person', 'other'] as const;
export type ExternalContactChannel = (typeof EXTERNAL_CONTACT_CHANNELS)[number];
export const EXTERNAL_CONTACT_LABELS: Record<ExternalContactChannel, string> = { whatsapp: 'WhatsApp', phone: 'Telefon', in_person: 'Yüz yüze', other: 'Diğer' };

export const MAX_EXTERNAL_NOTE = 300;
/** How far back a contact may be dated (a forgotten call from last week is fine; history is not rewritten). */
export const MAX_EXTERNAL_CONTACT_AGE_DAYS = 30;

const PREFIX = 'Harici temas kaydedildi: ';
const NOTE = ' · Not: ';

export interface ExternalContactInput {
  channel: ExternalContactChannel;
  note: string;
  /** When it happened (ISO); null = now. */
  occurredAt: string | null;
}

export function describeExternalContact(channel: ExternalContactChannel, note: string): string {
  const n = note.trim().replace(/\s+/g, ' ');
  return `${PREFIX}${EXTERNAL_CONTACT_LABELS[channel]}${n ? `${NOTE}${n}` : ''}`;
}

const BY_LABEL = new Map(Object.entries(EXTERNAL_CONTACT_LABELS).map(([k, v]) => [v, k as ExternalContactChannel]));

export function parseExternalContact(entry: Pick<CompanyHistoryEntry, 'type' | 'description' | 'createdAt'>): { at: string; channel: ExternalContactChannel; note: string | null } | null {
  if (entry.type !== 'external_contact' || !entry.description.startsWith(PREFIX)) return null;
  const rest = entry.description.slice(PREFIX.length);
  const i = rest.indexOf(NOTE);
  const label = i === -1 ? rest : rest.slice(0, i);
  const channel = BY_LABEL.get(label);
  if (!channel) return null;
  return { at: entry.createdAt, channel, note: i === -1 ? null : rest.slice(i + NOTE.length) };
}

/** The most recent recorded external contact of a company. */
export function latestExternalContact(company: Pick<Company, 'history'>): ReturnType<typeof parseExternalContact> {
  let best: ReturnType<typeof parseExternalContact> = null;
  for (const h of company.history) {
    const p = parseExternalContact(h);
    if (p && (!best || p.at > best.at)) best = p;
  }
  return best;
}
