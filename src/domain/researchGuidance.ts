// What research for each KITE service will look for. Explanatory only in Phase 3; Phase 4 can use
// the same signals as research instructions.
import type { ServiceKey } from './services';

export interface ResearchGuidance {
  /** One-line focus of the research. */
  focus: string;
  signals: string[];
}

export const RESEARCH_GUIDANCE: Record<ServiceKey, ResearchGuidance> = {
  crm: {
    focus: 'Operasyonel karmaşıklığı yüksek şirketler',
    signals: [
      'Rezervasyon veya randevu yoğunluğu',
      'Çok sayıda potansiyel müşteri (lead) takibi',
      'Ödeme ve tahsilat takibi',
      'WhatsApp ağırlıklı müşteri iletişimi',
      'Excel / manuel iş akışları',
      'Birden fazla operasyon adımı',
      'Teklif ağırlıklı satış süreci',
      'Tekrarlayan takipler',
      'Birden fazla şube veya ekip',
      'Rezervasyon / müşteri takibi karmaşıklığı',
    ],
  },
  website: {
    focus: 'Web sitesi işini yapmayan şirketler',
    signals: [
      'Eski görünen tasarım',
      'Zayıf mobil deneyim',
      'Zayıf CTA’lar',
      'Kötü rezervasyon / form deneyimi',
      'Marka ile site arasında uyumsuzluk',
      'Karışık site yapısı',
      'Zayıf premium konumlandırma',
      'Yetersiz güven unsurları',
      'Eski görsel hiyerarşi',
      'Zayıf dönüşüm yolculuğu',
    ],
  },
  google_ads: {
    focus: 'Aranan, dönüşüm potansiyeli yüksek hizmet/ürünler',
    signals: [
      'Net ticari niyet',
      'Aranabilir hizmet veya ürünler',
      'Güçlü dönüşüm potansiyeli',
      'Görünür ücretli arama fırsatı',
      'Yerel arama niyeti',
      'Yüksek bilet değerli hizmetler',
      'Ölçülebilir lead üretimi',
      'Güçlü işlem odaklı anahtar kelimeler',
    ],
  },
  meta_ads: {
    focus: 'Görsel anlatıma uygun, sosyal reklam potansiyeli olan şirketler',
    signals: [
      'Görsel ürün veya hizmetler',
      'Zayıf ya da düzensiz ücretli sosyal medya varlığı',
      'Kampanya potansiyeli',
      'Yeniden pazarlama (remarketing) potansiyeli',
      'Teklif / kampanya odaklı iş modeli',
      'Görsel hikâye anlatımı fırsatları',
      'Premium veya özendirici ürün / hizmetler',
    ],
  },
  social_media: {
    focus: 'Sosyal medyası markasının gerisinde kalan şirketler',
    signals: [
      'Düzensiz paylaşım',
      'Zayıf görsel kimlik',
      'Düşük içerik kalitesi',
      'Reels’in zayıf kullanımı',
      'Zayıf CTA / içerik yapısı',
      'Düzensiz kampanya iletişimi',
      'Düşük görsel tutarlılık',
      'Zayıf marka hikâyesi',
    ],
  },
  creative: {
    focus: 'Reklam kreatifleri zayıf veya tekrar eden şirketler',
    signals: [
      'Zayıf reklam kreatifleri',
      'Tekrar eden görseller',
      'Zayıf teklif sunumu',
      'Zayıf ürün / hizmet anlatımı',
      'Eskimiş görsel dil',
      'Jenerik reklam tasarımı',
      'Zayıf ilk saniye kancaları (hook)',
      'Ücretli sosyal kreatiflerde düşük çeşitlilik',
    ],
  },
  seo: {
    focus: 'Arama talebi olan ama organikte zayıf kalan şirketler',
    signals: [
      'Arama odaklı hizmetler',
      'Zayıf organik görünürlük potansiyeli',
      'İçerik boşlukları',
      'Zayıf site yapısı',
      'Güçlü bilgi amaçlı arama talebi',
      'Şehir / hizmet açılış sayfası potansiyeli',
      'Kategori içeriği fırsatları',
      'Yerel SEO fırsatları',
    ],
  },
};
