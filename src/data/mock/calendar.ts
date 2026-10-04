import type { Meeting } from '../../lib/types';
import { relativeIso } from '../../lib/date';

export function getMockMeetings(now = new Date()): Meeting[] {
  const at = (dayOffset: number, h: number, m = 0) => relativeIso(dayOffset, h, m, now);

  return [
    {
      id: 'mt1',
      title: 'Tanışma görüşmesi',
      company: 'Marmaris Yacht Club',
      start: at(0, 14),
      durationMin: 30,
      location: 'Google Meet',
    },
    {
      id: 'mt2',
      title: 'Aylık rapor sunumu',
      company: 'Ecru Atelier',
      start: at(0, 16, 30),
      durationMin: 45,
      location: 'Zoom',
    },
    {
      id: 'mt3',
      title: 'İhtiyaç analizi',
      company: 'Colorido Tours',
      start: at(1, 11),
      durationMin: 30,
      location: 'Google Meet',
    },
    {
      id: 'mt4',
      title: 'Teklif sunumu',
      company: 'Nova Villas',
      start: at(3, 15),
      durationMin: 45,
      location: 'Telefon',
    },
    {
      id: 'mt5',
      title: 'Kampanya değerlendirmesi',
      company: 'Ecru Atelier',
      start: at(8, 10),
      durationMin: 30,
      location: 'Ofis',
    },
  ];
}
