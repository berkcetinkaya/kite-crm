// Fictional prospects for Phase 2. Not real researched leads. Dates are relative to "now" so
// "Son Temas" and due dates stay realistic whenever the app is opened.
import {
  CURRENT_USER,
  DEFAULT_COUNTRY,
  type Company,
  type CompanyHistoryEntry,
  type Contact,
  type ServiceOpportunity,
} from '../../domain/company';
import type { SalesStatus } from '../../domain/salesStatus';
import { relativeIso } from '../../lib/date';
import { describe, historyEntry } from '../../state/companies/events';

const ME = CURRENT_USER;

type Seed = Omit<Company, 'country' | 'history' | 'notes' | 'createdAt' | 'updatedAt' | 'lastContactAt' | 'nextAction'> & {
  /** Days ago the company was added. */
  addedDaysAgo: number;
  lastContactDaysAgo?: number;
  nextAction?: { label: string; dueInDays?: number; dueHour?: number };
  notes?: { content: string; daysAgo: number }[];
  /** Status path walked before the current status, oldest first, with days ago for each change. */
  statusPath?: { status: SalesStatus; daysAgo: number }[];
  scoredDaysAgo?: number;
  contactsAddedDaysAgo?: number;
};

const opp = (
  service: ServiceOpportunity['service'],
  score: number | null,
  potential: ServiceOpportunity['potential'],
  reason: string,
): ServiceOpportunity => ({ service, score, potential, reason });

const contact = (c: Omit<Contact, 'email' | 'phone' | 'linkedin'> & Partial<Pick<Contact, 'email' | 'phone' | 'linkedin'>>): Contact => ({
  email: null,
  phone: null,
  linkedin: null,
  ...c,
});

function build(seed: Seed, now: Date): Company {
  const at = (daysAgo: number, hour = 10) => relativeIso(-daysAgo, hour, 0, now);
  const history: CompanyHistoryEntry[] = [historyEntry('created', describe.created(), at(seed.addedDaysAgo, 9), ME)];

  if (seed.scoredDaysAgo !== undefined && seed.opportunityScore !== null) {
    history.push(
      historyEntry('score_updated', describe.scoreUpdated(null, seed.opportunityScore), at(seed.scoredDaysAgo, 11), ME),
    );
  }

  let previous: SalesStatus = 'found';
  for (const step of seed.statusPath ?? []) {
    history.push(historyEntry('status_changed', describe.statusChanged(previous, step.status), at(step.daysAgo, 15), ME));
    previous = step.status;
  }

  if (seed.contactsAddedDaysAgo !== undefined) {
    for (const c of seed.contacts) {
      history.push(historyEntry('contact_added', describe.contactAdded(c.fullName), at(seed.contactsAddedDaysAgo, 12), ME));
    }
  }

  const notes = (seed.notes ?? []).map((n, i) => ({
    id: `${seed.id}_note_${i + 1}`,
    content: n.content,
    author: ME,
    createdAt: at(n.daysAgo, 16),
  }));
  for (const n of notes) history.push(historyEntry('note_added', describe.noteAdded(), n.createdAt, ME));

  history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const { addedDaysAgo, lastContactDaysAgo, nextAction, statusPath: _s, scoredDaysAgo: _d, contactsAddedDaysAgo: _c, notes: _n, ...rest } =
    seed;
  return {
    ...rest,
    country: DEFAULT_COUNTRY,
    notes: notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    history,
    lastContactAt: lastContactDaysAgo === undefined ? null : at(lastContactDaysAgo, 14),
    nextAction: nextAction
      ? {
          label: nextAction.label,
          dueAt: nextAction.dueInDays === undefined ? null : relativeIso(nextAction.dueInDays, nextAction.dueHour ?? 17, 0, now),
        }
      : null,
    createdAt: at(addedDaysAgo, 9),
    updatedAt: history[0].createdAt,
  };
}

const seeds: Seed[] = [
  {
    id: 'cmp_dentglow',
    name: 'DentGlow Clinic',
    website: 'dentglow.com.tr',
    sector: 'Diş Kliniği',
    city: 'İstanbul',
    companySize: '11-50',
    source: 'google_maps',
    owner: ME,
    status: 'researched',
    opportunityScore: 88,
    opportunities: [
      opp('crm', 86, 'high', 'Hasta randevuları telefon ve WhatsApp üzerinden dağınık ilerliyor.'),
      opp('google_ads', 82, 'high', 'İmplant ve gülüş tasarımı aramalarında reklam görünürlüğü yok.'),
      opp('website', 64, 'medium', 'Site hızlı ama tedavi sayfaları yüzeysel.'),
    ],
    contacts: [
      contact({
        id: 'ct_dentglow_1',
        fullName: 'Dr. Selin Kaya',
        role: 'Klinik Sahibi',
        email: 'selin@dentglow.com.tr',
        phone: '+90 532 410 22 18',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 12,
    scoredDaysAgo: 4,
    statusPath: [{ status: 'researched', daysAgo: 3 }],
    contactsAddedDaysAgo: 4,
    notes: [{ content: 'Website özellikle mobilde eski görünüyor.', daysAgo: 3 }],
    nextAction: { label: 'İlk maili onayla', dueInDays: 0, dueHour: 11 },
  },
  {
    id: 'cmp_trvip',
    name: 'TRVIP Transfer',
    website: 'trvip.com.tr',
    sector: 'Transfer',
    city: 'Antalya',
    companySize: '11-50',
    source: 'linkedin',
    owner: ME,
    status: 'first_contact',
    opportunityScore: 74,
    opportunities: [
      opp('google_ads', 78, 'high', 'Havalimanı transfer aramalarında rakipler reklamda üstte.'),
      opp('website', 66, 'medium', 'Rezervasyon formu mobilde uzun ve kafa karıştırıcı.'),
    ],
    contacts: [
      contact({
        id: 'ct_trvip_1',
        fullName: 'Murat Aksoy',
        role: 'Operasyon Müdürü',
        email: 'murat.aksoy@trvip.com.tr',
        isDecisionMaker: false,
        confidence: 'medium',
      }),
      contact({
        id: 'ct_trvip_2',
        fullName: 'Kerem Yılmaz',
        role: 'Genel Müdür',
        linkedin: 'linkedin.com/in/kerem-yilmaz-trvip',
        isDecisionMaker: true,
        confidence: 'low',
      }),
    ],
    addedDaysAgo: 21,
    scoredDaysAgo: 18,
    statusPath: [
      { status: 'researched', daysAgo: 17 },
      { status: 'first_contact', daysAgo: 6 },
    ],
    contactsAddedDaysAgo: 17,
    lastContactDaysAgo: 6,
    nextAction: { label: 'Takip maili gönder', dueInDays: 0, dueHour: 15 },
  },
  {
    id: 'cmp_nova',
    name: 'Nova Villas',
    website: 'novavillas.com',
    sector: 'Villa Kiralama',
    city: 'Antalya',
    companySize: '1-10',
    source: 'instagram',
    owner: ME,
    status: 'proposal',
    opportunityScore: 82,
    opportunities: [
      opp('website', 92, 'high', 'Mobil deneyim ve teklif çağrıları zayıf.'),
      opp('crm', 84, 'high', 'Müşteri ve rezervasyon operasyonu birden fazla kanalda ilerliyor.'),
      opp('meta_ads', 70, 'medium', 'Görsel içerik güçlü, ücretli dağıtım yok.'),
    ],
    contacts: [
      contact({
        id: 'ct_nova_1',
        fullName: 'Deniz Arslan',
        role: 'Kurucu',
        email: 'deniz@novavillas.com',
        phone: '+90 533 781 45 09',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 34,
    scoredDaysAgo: 30,
    statusPath: [
      { status: 'researched', daysAgo: 30 },
      { status: 'first_contact', daysAgo: 25 },
      { status: 'replied', daysAgo: 20 },
      { status: 'meeting', daysAgo: 9 },
      { status: 'proposal', daysAgo: 2 },
    ],
    contactsAddedDaysAgo: 29,
    notes: [
      { content: 'Görüşmede yaz sezonu öncesi yeni sitenin yayında olmasını istediklerini söylediler.', daysAgo: 9 },
      { content: 'Bütçe konusunda esnek, ama CRM için önce demo görmek istiyorlar.', daysAgo: 2 },
    ],
    lastContactDaysAgo: 2,
    nextAction: { label: 'Website teklifini hazırla', dueInDays: 0, dueHour: 17 },
  },
  {
    id: 'cmp_colorido',
    name: 'Colorido Tours',
    website: 'coloridotours.com',
    sector: 'Tur Operatörü',
    city: 'İstanbul',
    companySize: '11-50',
    source: 'instagram',
    owner: ME,
    status: 'replied',
    opportunityScore: 84,
    opportunities: [
      opp('meta_ads', 84, 'high', 'Instagram etkileşimi yüksek, reklam yönetimi yok.'),
      opp('creative', 76, 'medium', 'Tur görselleri tutarsız, marka dili oturmamış.'),
      opp('social_media', 72, 'medium', 'Paylaşım sıklığı düzensiz.'),
    ],
    contacts: [
      contact({
        id: 'ct_colorido_1',
        fullName: 'Ayşe Demir',
        role: 'Pazarlama Sorumlusu',
        email: 'ayse@coloridotours.com',
        isDecisionMaker: false,
        confidence: 'medium',
      }),
    ],
    addedDaysAgo: 16,
    scoredDaysAgo: 14,
    statusPath: [
      { status: 'researched', daysAgo: 14 },
      { status: 'first_contact', daysAgo: 8 },
      { status: 'replied', daysAgo: 1 },
    ],
    contactsAddedDaysAgo: 14,
    lastContactDaysAgo: 1,
    nextAction: { label: 'Gelen yanıta dönüş yap', dueInDays: -1, dueHour: 16 },
  },
  {
    id: 'cmp_istanbulsmile',
    name: 'Istanbul Smile Center',
    website: 'istanbulsmilecenter.com',
    sector: 'Diş Kliniği',
    city: 'İstanbul',
    companySize: '51-200',
    source: 'google_maps',
    owner: null,
    status: 'found',
    opportunityScore: 71,
    opportunities: [
      opp('seo', 74, 'medium', 'Yabancı hasta odaklı İngilizce içerik az.'),
      opp('google_ads', 70, 'medium', 'Sağlık turizmi aramalarında reklam var ama açılış sayfası genel.'),
    ],
    contacts: [],
    addedDaysAgo: 2,
    scoredDaysAgo: 2,
    nextAction: { label: 'Araştırmayı tamamla' },
  },
  {
    id: 'cmp_bosphorus',
    name: 'Bosphorus Transfer',
    website: 'bosphorustransfer.com',
    sector: 'Transfer',
    city: 'İstanbul',
    companySize: '1-10',
    source: 'google_maps',
    owner: ME,
    status: 'not_interested',
    opportunityScore: 48,
    opportunities: [opp('google_ads', 52, 'low', 'Küçük filo, reklam bütçesi sınırlı.')],
    contacts: [
      contact({
        id: 'ct_bosphorus_1',
        fullName: 'Emre Şahin',
        role: 'İşletme Sahibi',
        phone: '+90 542 300 17 64',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 40,
    scoredDaysAgo: 38,
    statusPath: [
      { status: 'researched', daysAgo: 38 },
      { status: 'first_contact', daysAgo: 30 },
      { status: 'not_interested', daysAgo: 20 },
    ],
    contactsAddedDaysAgo: 38,
    notes: [{ content: 'Reklamlarını kendileri yönettiklerini söylediler, şu an ihtiyaç yok.', daysAgo: 20 }],
    lastContactDaysAgo: 20,
  },
  {
    id: 'cmp_luna',
    name: 'Luna Furniture',
    website: 'lunamobilya.com.tr',
    sector: 'Mobilya',
    city: 'İzmir',
    companySize: '51-200',
    source: 'referral',
    owner: ME,
    status: 'meeting',
    opportunityScore: 79,
    opportunities: [
      opp('website', 81, 'high', 'E-ticaret altyapısı eski, ürün sayfaları yavaş.'),
      opp('meta_ads', 77, 'medium', 'Katalog reklamları için ürün akışı hazır değil.'),
      opp('seo', 68, 'medium', 'Kategori sayfalarında içerik yok.'),
    ],
    contacts: [
      contact({
        id: 'ct_luna_1',
        fullName: 'Canan Öztürk',
        role: 'Genel Müdür',
        email: 'canan.ozturk@lunamobilya.com.tr',
        phone: '+90 532 655 90 12',
        isDecisionMaker: true,
        confidence: 'high',
      }),
      contact({
        id: 'ct_luna_2',
        fullName: 'Burak Çelik',
        role: 'E-ticaret Sorumlusu',
        email: 'burak@lunamobilya.com.tr',
        isDecisionMaker: false,
        confidence: 'medium',
      }),
    ],
    addedDaysAgo: 26,
    scoredDaysAgo: 24,
    statusPath: [
      { status: 'researched', daysAgo: 24 },
      { status: 'first_contact', daysAgo: 19 },
      { status: 'replied', daysAgo: 12 },
      { status: 'meeting', daysAgo: 4 },
    ],
    contactsAddedDaysAgo: 23,
    notes: [
      { content: 'Referans: Ecru Atelier. İlk görüşme olumlu geçti.', daysAgo: 4 },
      { content: 'Showroom trafiğini online satışa çevirmek öncelikleri.', daysAgo: 4 },
    ],
    lastContactDaysAgo: 4,
    nextAction: { label: 'Görüşme notlarını teklif taslağına çevir', dueInDays: 2 },
  },
  {
    id: 'cmp_mira',
    name: 'Mira Aesthetic',
    website: 'miraestetik.com',
    sector: 'Estetik Klinik',
    city: 'İzmir',
    companySize: '11-50',
    source: 'instagram',
    owner: ME,
    status: 'later',
    opportunityScore: 66,
    opportunities: [
      opp('social_media', 70, 'medium', 'Önce/sonra içerikleri var, düzenli yayın yok.'),
      opp('creative', 65, 'medium', 'Görsel dil kliniğin fiyat segmentini yansıtmıyor.'),
    ],
    contacts: [
      contact({
        id: 'ct_mira_1',
        fullName: 'Dr. Elif Koç',
        role: 'Medikal Direktör',
        email: 'elif@miraestetik.com',
        isDecisionMaker: true,
        confidence: 'medium',
      }),
    ],
    addedDaysAgo: 45,
    scoredDaysAgo: 44,
    statusPath: [
      { status: 'researched', daysAgo: 44 },
      { status: 'first_contact', daysAgo: 30 },
      { status: 'later', daysAgo: 15 },
    ],
    contactsAddedDaysAgo: 44,
    notes: [{ content: 'Kasım ayında tekrar iletişime geçilebilir.', daysAgo: 15 }],
    lastContactDaysAgo: 15,
    nextAction: { label: 'Kasım ayında tekrar iletişime geç', dueInDays: 30 },
  },
  {
    id: 'cmp_atlas',
    name: 'Atlas Travel',
    website: 'atlastravel.com.tr',
    sector: 'Seyahat Acentesi',
    city: 'Ankara',
    companySize: '11-50',
    source: 'linkedin',
    owner: ME,
    status: 'awaiting_decision',
    opportunityScore: 77,
    opportunities: [
      opp('crm', 80, 'high', 'Talep formları e-postayla takip ediliyor, dönüşler kayboluyor.'),
      opp('google_ads', 71, 'medium', 'Kurumsal seyahat aramalarında görünürlük düşük.'),
    ],
    contacts: [
      contact({
        id: 'ct_atlas_1',
        fullName: 'Hakan Yurt',
        role: 'Kurucu Ortak',
        email: 'hakan@atlastravel.com.tr',
        phone: '+90 312 444 18 20',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 38,
    scoredDaysAgo: 36,
    statusPath: [
      { status: 'researched', daysAgo: 36 },
      { status: 'first_contact', daysAgo: 32 },
      { status: 'replied', daysAgo: 27 },
      { status: 'meeting', daysAgo: 18 },
      { status: 'proposal', daysAgo: 10 },
      { status: 'awaiting_decision', daysAgo: 3 },
    ],
    contactsAddedDaysAgo: 35,
    notes: [{ content: 'Ortaklar arasında bütçe onayı bekleniyor.', daysAgo: 3 }],
    lastContactDaysAgo: 3,
    nextAction: { label: 'Karar için Hakan Bey’i ara', dueInDays: 2, dueHour: 11 },
  },
  {
    id: 'cmp_pearl',
    name: 'Pearl Dental',
    website: 'pearldental.com.tr',
    sector: 'Diş Kliniği',
    city: 'Antalya',
    companySize: '11-50',
    source: 'google_maps',
    owner: ME,
    status: 'client',
    opportunityScore: 90,
    opportunities: [
      opp('google_ads', 90, 'high', 'Yabancı hasta talebi yüksek, reklam hesabı yönetilmiyordu.'),
      opp('crm', 85, 'high', 'Hasta takibi Excel’de yürütülüyor.'),
    ],
    contacts: [
      contact({
        id: 'ct_pearl_1',
        fullName: 'Dr. Ozan Erdem',
        role: 'Klinik Sahibi',
        email: 'ozan@pearldental.com.tr',
        isDecisionMaker: true,
        confidence: 'high',
      }),
      contact({
        id: 'ct_pearl_2',
        fullName: 'Gizem Aydın',
        role: 'Hasta Koordinatörü',
        email: 'gizem@pearldental.com.tr',
        phone: '+90 242 316 05 50',
        isDecisionMaker: false,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 70,
    scoredDaysAgo: 68,
    statusPath: [
      { status: 'researched', daysAgo: 68 },
      { status: 'first_contact', daysAgo: 62 },
      { status: 'replied', daysAgo: 58 },
      { status: 'meeting', daysAgo: 50 },
      { status: 'proposal', daysAgo: 44 },
      { status: 'client', daysAgo: 35 },
    ],
    contactsAddedDaysAgo: 60,
    lastContactDaysAgo: 0,
    nextAction: { label: 'Aylık rapor tarihini netleştir', dueInDays: 4 },
  },
  {
    id: 'cmp_ecru',
    name: 'Ecru Atelier',
    website: 'ecruatelier.com',
    sector: 'Moda',
    city: 'İstanbul',
    companySize: '1-10',
    source: 'referral',
    owner: ME,
    status: 'client',
    opportunityScore: 91,
    opportunities: [
      opp('meta_ads', 91, 'high', 'Ürün odaklı kampanyalar için güçlü katalog.'),
      opp('creative', 80, 'high', 'Sezonluk çekimler reklam formatlarına uyarlanmıyor.'),
    ],
    contacts: [
      contact({
        id: 'ct_ecru_1',
        fullName: 'Zeynep Ersoy',
        role: 'Kurucu & Tasarımcı',
        email: 'zeynep@ecruatelier.com',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 120,
    scoredDaysAgo: 118,
    statusPath: [
      { status: 'first_contact', daysAgo: 115 },
      { status: 'meeting', daysAgo: 110 },
      { status: 'proposal', daysAgo: 105 },
      { status: 'client', daysAgo: 98 },
    ],
    contactsAddedDaysAgo: 115,
    lastContactDaysAgo: 1,
    nextAction: { label: 'Aylık raporu hazırla', dueInDays: 0, dueHour: 12 },
  },
  {
    id: 'cmp_marmaris',
    name: 'Marmaris Yacht Club',
    website: 'marmarisyachtclub.com',
    sector: 'Yat Kiralama',
    city: 'Muğla',
    companySize: '11-50',
    source: 'event',
    owner: ME,
    status: 'meeting',
    opportunityScore: 79,
    opportunities: [
      opp('website', 83, 'high', 'Filo sayfaları eski, çok dilli destek eksik.'),
      opp('meta_ads', 75, 'medium', 'Sezon öncesi erken rezervasyon kampanyası yok.'),
    ],
    contacts: [
      contact({
        id: 'ct_marmaris_1',
        fullName: 'Can Tekin',
        role: 'Satış Müdürü',
        email: 'can@marmarisyachtclub.com',
        phone: '+90 252 412 77 30',
        isDecisionMaker: true,
        confidence: 'medium',
      }),
    ],
    addedDaysAgo: 19,
    scoredDaysAgo: 18,
    statusPath: [
      { status: 'researched', daysAgo: 18 },
      { status: 'first_contact', daysAgo: 12 },
      { status: 'replied', daysAgo: 6 },
      { status: 'meeting', daysAgo: 5 },
    ],
    contactsAddedDaysAgo: 18,
    notes: [{ content: 'Boat show’da tanıştık. Marmaris ve Göcek için ayrı kampanya düşünüyorlar.', daysAgo: 19 }],
    lastContactDaysAgo: 5,
    nextAction: { label: 'Tanışma görüşmesi', dueInDays: 0, dueHour: 14 },
  },
  {
    id: 'cmp_bodrumblue',
    name: 'Bodrum Blue Hotel',
    website: 'bodrumbluehotel.com',
    sector: 'Butik Otel',
    city: 'Bodrum',
    companySize: '11-50',
    source: 'inbound',
    owner: ME,
    status: 'first_contact',
    opportunityScore: 69,
    opportunities: [
      opp('website', 72, 'medium', 'Rezervasyon motoru siteden kopuk çalışıyor.'),
      opp('seo', 63, 'medium', '“Bodrum butik otel” aramalarında ilk sayfada değil.'),
    ],
    contacts: [
      contact({
        id: 'ct_bodrum_1',
        fullName: 'Rezervasyon Ekibi',
        role: 'Genel iletişim',
        email: 'info@bodrumbluehotel.com',
        isDecisionMaker: false,
        confidence: 'low',
      }),
    ],
    addedDaysAgo: 9,
    scoredDaysAgo: 8,
    statusPath: [
      { status: 'researched', daysAgo: 8 },
      { status: 'first_contact', daysAgo: 7 },
    ],
    contactsAddedDaysAgo: 8,
    lastContactDaysAgo: 7,
    nextAction: { label: 'Karar vericiyi bul', dueInDays: 1 },
  },
  {
    id: 'cmp_baskent',
    name: 'Başkent Fizik Tedavi',
    website: 'baskentfiziktedavi.com',
    sector: 'Sağlık',
    city: 'Ankara',
    companySize: '1-10',
    source: 'google_maps',
    owner: ME,
    status: 'disqualified',
    opportunityScore: 38,
    opportunities: [opp('social_media', 40, 'low', 'Tek şubeli, pazarlama bütçesi çok sınırlı.')],
    contacts: [],
    addedDaysAgo: 28,
    scoredDaysAgo: 27,
    statusPath: [
      { status: 'researched', daysAgo: 27 },
      { status: 'disqualified', daysAgo: 26 },
    ],
    notes: [{ content: 'Bütçe uygun değil, şimdilik listeden çıkarıldı.', daysAgo: 26 }],
  },
  {
    id: 'cmp_ege',
    name: 'Ege Rent a Car',
    website: 'egerentacar.com',
    sector: 'Araç Kiralama',
    city: 'İzmir',
    companySize: '11-50',
    source: 'google_maps',
    owner: null,
    status: 'researched',
    opportunityScore: 69,
    opportunities: [
      opp('website', 69, 'medium', 'Araç listesi güncel değil, fiyatlar telefonda veriliyor.'),
      opp('google_ads', 67, 'medium', 'Havalimanı araç kiralama aramalarında görünmüyor.'),
    ],
    contacts: [],
    addedDaysAgo: 6,
    scoredDaysAgo: 5,
    statusPath: [{ status: 'researched', daysAgo: 5 }],
    nextAction: { label: 'İletişim kişisini bul' },
  },
  {
    id: 'cmp_lykia',
    name: 'Lykia Organik',
    website: 'lykiaorganik.com',
    sector: 'E-ticaret',
    city: 'Antalya',
    companySize: '1-10',
    source: 'instagram',
    owner: ME,
    status: 'lost',
    opportunityScore: 58,
    opportunities: [
      opp('meta_ads', 60, 'medium', 'Sadık takipçi kitlesi var, reklam denenmemiş.'),
      opp('creative', 55, 'low', 'Ürün fotoğrafları amatör.'),
    ],
    contacts: [
      contact({
        id: 'ct_lykia_1',
        fullName: 'Mert Güneş',
        role: 'Kurucu',
        email: 'mert@lykiaorganik.com',
        isDecisionMaker: true,
        confidence: 'high',
      }),
    ],
    addedDaysAgo: 60,
    scoredDaysAgo: 58,
    statusPath: [
      { status: 'researched', daysAgo: 58 },
      { status: 'first_contact', daysAgo: 52 },
      { status: 'replied', daysAgo: 48 },
      { status: 'meeting', daysAgo: 42 },
      { status: 'proposal', daysAgo: 36 },
      { status: 'lost', daysAgo: 22 },
    ],
    contactsAddedDaysAgo: 55,
    notes: [{ content: 'Başka bir ajansla anlaştılar. 6 ay sonra durumu sorabiliriz.', daysAgo: 22 }],
    lastContactDaysAgo: 22,
  },
  {
    id: 'cmp_perasmile',
    name: 'Pera Smile Dental',
    website: null,
    sector: 'Diş Kliniği',
    city: 'İstanbul',
    companySize: null,
    source: 'manual',
    owner: null,
    status: 'found',
    opportunityScore: null,
    opportunities: [],
    contacts: [],
    addedDaysAgo: 0,
  },
];

export function getMockCompanies(now = new Date()): Company[] {
  return seeds.map((seed) => build(seed, now));
}
