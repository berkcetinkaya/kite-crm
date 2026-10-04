import type { ActionItem } from '../../lib/types';
import { relativeIso } from '../../lib/date';

// Due dates are relative to the current day so overdue/today states stay realistic whenever the app is opened.
export function getMockActions(now = new Date()): ActionItem[] {
  const at = (dayOffset: number, h: number, m = 0) => relativeIso(dayOffset, h, m, now);

  return [
    {
      id: 'a1',
      title: 'Arya Butik Otel ödemesi 3 gün gecikti, hatırlatma yap',
      priority: 'yuksek',
      category: 'Tahsilat',
      due: at(-3, 17),
      relatedTo: 'Arya Butik Otel',
      done: false,
    },
    {
      id: 'a2',
      title: 'Colorido Tours gelen yanıta dönüş yap',
      priority: 'yuksek',
      category: 'Takip',
      due: at(-1, 16),
      relatedTo: 'Colorido Tours',
      done: false,
    },
    {
      id: 'a3',
      title: 'Ecru Atelier aylık raporu hazırlanacak',
      priority: 'yuksek',
      category: 'Müşteri İşi',
      due: at(0, 12),
      relatedTo: 'Ecru Atelier',
      done: false,
    },
    {
      id: 'a4',
      title: 'DentGlow Clinic ilk maili onayla',
      priority: 'yuksek',
      category: 'Satış',
      due: at(0, 11),
      relatedTo: 'DentGlow Clinic',
      done: false,
    },
    {
      id: 'a5',
      title: 'Nova Villas website teklifini hazırla',
      priority: 'orta',
      category: 'Teklif',
      due: at(0, 17),
      relatedTo: 'Nova Villas',
      done: false,
    },
    {
      id: 'a6',
      title: 'TRVIP Transfer takip maili gönder',
      priority: 'orta',
      category: 'Takip',
      due: at(0, 15, 30),
      relatedTo: 'TRVIP Transfer',
      done: false,
    },
    {
      id: 'a7',
      title: 'Marmaris Yacht Club ile tanışma görüşmesi',
      priority: 'orta',
      category: 'Görüşme',
      due: at(0, 14),
      relatedTo: 'Marmaris Yacht Club',
      done: false,
    },
    {
      id: 'a8',
      title: 'Bu hafta için 20 yeni dental klinik araştırması başlat',
      priority: 'dusuk',
      category: 'Araştırma',
      due: at(2, 18),
      relatedTo: null,
      done: false,
    },
    {
      id: 'a9',
      title: 'Ecru Atelier Meta Ads kreatiflerini kontrol et',
      priority: 'dusuk',
      category: 'Müşteri İşi',
      due: at(0, 9, 30),
      relatedTo: 'Ecru Atelier',
      done: true,
    },
  ];
}
