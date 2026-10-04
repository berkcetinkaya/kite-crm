import type { DailyMetric, FunnelStageCount } from '../../lib/types';

export const mockDailyMetrics: DailyMetric[] = [
  { id: 'found', label: 'Yeni Bulunan Şirket', value: 24, previous: 18 },
  { id: 'review', label: 'İncelenmeyi Bekleyen', value: 9, previous: 11 },
  { id: 'readyMail', label: 'Gönderime Hazır Mail', value: 6, previous: 4 },
  { id: 'replies', label: 'Yeni Yanıt', value: 3, previous: 1 },
  { id: 'meetings', label: 'Görüşme', value: 2, previous: 2 },
  { id: 'proposals', label: 'Teklif', value: 1, previous: 0 },
  { id: 'clients', label: 'Yeni Müşteri', value: 1, previous: 0 },
];

export const mockFunnel: FunnelStageCount[] = [
  { stage: 'Yeni Bulundu', count: 48 },
  { stage: 'Araştırıldı', count: 31 },
  { stage: 'İlk Temas', count: 22 },
  { stage: 'Yanıt Geldi', count: 9 },
  { stage: 'Görüşme', count: 5 },
  { stage: 'Teklif', count: 4 },
  { stage: 'Karar Bekleniyor', count: 3 },
  { stage: 'Müşteri Oldu', count: 2 },
];
