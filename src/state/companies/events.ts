// Builders for company history entries, so mock data and local mutations describe events the same way.
import type { Company, CompanyHistoryEntry, CompanyHistoryType } from '../../domain/company';
import { SALES_STATUS, type SalesStatus } from '../../domain/salesStatus';
import { createId } from '../../lib/id';

export function historyEntry(
  type: CompanyHistoryType,
  description: string,
  createdAt: string,
  author: string,
): CompanyHistoryEntry {
  return { id: createId('evt'), type, description, createdAt, author };
}

export const describe = {
  created: (origin?: string, message = 'Şirket sisteme eklendi') => (origin ? `${message} · ${origin}` : message),
  statusChanged: (from: SalesStatus, to: SalesStatus) =>
    `Durum ${SALES_STATUS[from].label} → ${SALES_STATUS[to].label} olarak değiştirildi`,
  scoreUpdated: (from: number | null, to: number | null) =>
    `Fırsat skoru ${from ?? '—'} → ${to ?? '—'} olarak güncellendi`,
  detailsUpdated: (fields: string[]) => `Şirket bilgileri güncellendi: ${fields.join(', ')}`,
  opportunitiesUpdated: () => 'Hizmet fırsatları güncellendi',
  noteAdded: () => 'Not eklendi',
  contactAdded: (name: string) => `İletişim kişisi eklendi: ${name}`,
  contactUpdated: (name: string) => `İletişim kişisi güncellendi: ${name}`,
};

/** Turkish names for editable company fields, used in "Şirket bilgileri güncellendi: …". */
export const COMPANY_FIELD_LABELS: Partial<Record<keyof Company, string>> = {
  name: 'Şirket',
  website: 'Website',
  sector: 'Sektör',
  city: 'Şehir',
  country: 'Ülke',
  companySize: 'Çalışan Sayısı',
  source: 'Kaynak',
  owner: 'Sorumlu',
  lastContactAt: 'Son Temas',
  nextAction: 'Sonraki Adım',
};
