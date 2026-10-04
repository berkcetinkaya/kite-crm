// Canonical sales status model. Business logic uses the keys; UI reads labels from here.
// Visual treatment lives in components/sales/SalesStatusBadge.

export const SALES_STAGES = [
  'found',
  'researched',
  'first_contact',
  'replied',
  'meeting',
  'proposal',
  'awaiting_decision',
  'client',
] as const;

export const SALES_SIDE_STATES = ['disqualified', 'not_interested', 'later', 'lost'] as const;

export type SalesStage = (typeof SALES_STAGES)[number];
export type SalesSideState = (typeof SALES_SIDE_STATES)[number];
export type SalesStatus = SalesStage | SalesSideState;

/** Main stages in pipeline order, followed by side/terminal states. */
export const SALES_STATUS_ORDER: readonly SalesStatus[] = [...SALES_STAGES, ...SALES_SIDE_STATES];

interface SalesStatusDefinition {
  /** Short label for badges and selects. */
  label: string;
  /** Label for funnel/stage summaries where a more natural phrasing reads better. */
  stageLabel: string;
  kind: 'stage' | 'side';
}

export const SALES_STATUS: Record<SalesStatus, SalesStatusDefinition> = {
  found: { label: 'Bulundu', stageLabel: 'Yeni Bulundu', kind: 'stage' },
  researched: { label: 'Araştırıldı', stageLabel: 'Araştırıldı', kind: 'stage' },
  first_contact: { label: 'İlk Temas', stageLabel: 'İlk Temas', kind: 'stage' },
  replied: { label: 'Yanıt Geldi', stageLabel: 'Yanıt Geldi', kind: 'stage' },
  meeting: { label: 'Görüşme', stageLabel: 'Görüşme', kind: 'stage' },
  proposal: { label: 'Teklif', stageLabel: 'Teklif', kind: 'stage' },
  awaiting_decision: { label: 'Karar Bekleniyor', stageLabel: 'Karar Bekleniyor', kind: 'stage' },
  client: { label: 'Müşteri', stageLabel: 'Müşteri Oldu', kind: 'stage' },
  disqualified: { label: 'Uygun Değil', stageLabel: 'Uygun Değil', kind: 'side' },
  not_interested: { label: 'İlgilenmiyor', stageLabel: 'İlgilenmiyor', kind: 'side' },
  later: { label: 'Şimdilik Bekle', stageLabel: 'Şimdilik Bekle', kind: 'side' },
  lost: { label: 'Kaybedildi', stageLabel: 'Kaybedildi', kind: 'side' },
};

export function isSalesStatus(value: string): value is SalesStatus {
  return value in SALES_STATUS;
}
