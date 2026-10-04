// Shared domain types. Mock data uses them now; live data must match them later.

export type Priority = 'yuksek' | 'orta' | 'dusuk';

export type TaskCategory =
  | 'Müşteri İşi'
  | 'Satış'
  | 'Takip'
  | 'Teklif'
  | 'Görüşme'
  | 'Araştırma'
  | 'Tahsilat';

export interface ActionItem {
  id: string;
  title: string;
  priority: Priority;
  category: TaskCategory;
  /** ISO date-time string */
  due: string;
  /** Company or client the item belongs to; null for general work. */
  relatedTo: string | null;
  done: boolean;
}

export interface DailyMetric {
  id: string;
  label: string;
  value: number;
  /** Value for the previous day, used for the small comparison hint. */
  previous: number;
}

export type FunnelStage =
  | 'Yeni Bulundu'
  | 'Araştırıldı'
  | 'İlk Temas'
  | 'Yanıt Geldi'
  | 'Görüşme'
  | 'Teklif'
  | 'Karar Bekleniyor'
  | 'Müşteri Oldu';

export interface FunnelStageCount {
  stage: FunnelStage;
  count: number;
}

export type Service =
  | 'CRM'
  | 'Website Yenileme'
  | 'Google Ads'
  | 'Meta Ads'
  | 'Sosyal Medya Yönetimi'
  | 'CRM + Reklam'
  | 'Website + Reklam';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'accent';

export interface CompanyRow {
  id: string;
  company: string;
  sector: string;
  city: string;
  service: Service;
  /** 0–100 */
  opportunityScore: number;
  status: string;
  statusTone: StatusTone;
  nextStep: string;
}

export type ActivityTabId = 'research' | 'readyMails' | 'replies' | 'meetings';

export interface Meeting {
  id: string;
  title: string;
  company: string;
  /** ISO date-time string */
  start: string;
  durationMin: number;
  location: string;
}

export interface KiteFinanceSummary {
  totalIncome: number;
  collected: number;
  toCollect: number;
  expenses: number;
}

export interface PersonalFinanceSummary {
  totalIncome: number;
  totalExpense: number;
  savingsGoal: number;
}
