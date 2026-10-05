// Central sector catalogue. Every selectable sector has a stable id, a Turkish UI label, a family,
// search terms (English, used internally for international web research) and aliases (old values,
// Turkish and English spellings) so stored values resolve to the same definition.
//
// Rules:
// - labelTr is the only text the UI shows. ids and searchTerms are implementation details.
// - Aliases and search terms must be unique across definitions (enforced by tests).
// - crmProfileId points to a sector-specific CRM profile (sectorIntelligence/crmProfiles.ts);
//   without it the family profile is used.
import type { SectorFamilyId } from './families';

export interface SectorDefinition {
  id: string;
  labelTr: string;
  familyId: SectorFamilyId;
  /** English terms for web research. The first one is the primary term. */
  searchTerms: string[];
  /** Other spellings that resolve to this sector (legacy values, Turkish variants, abbreviations). */
  aliases: string[];
  crmProfileId?: string;
}

const s = (
  id: string,
  labelTr: string,
  familyId: SectorFamilyId,
  searchTerms: string[],
  aliases: string[] = [],
  crmProfileId?: string,
): SectorDefinition => ({ id, labelTr, familyId, searchTerms, aliases, ...(crmProfileId ? { crmProfileId } : {}) });

export const SECTOR_DEFINITIONS: readonly SectorDefinition[] = [
  // ---------- Sağlık ----------
  s('dental_clinic', 'Diş Kliniği', 'health', ['Dental Clinic', 'Dental Center', 'Dental Practice'], ['Dental Klinik', 'diş kliniği', 'dental centre', 'dentist', 'diş hekimi', 'ağız ve diş sağlığı merkezi', 'diş polikliniği'], 'dental_clinic'),
  s('aesthetic_clinic', 'Estetik Klinik', 'health', ['Aesthetic Clinic', 'Medical Aesthetics Clinic', 'Cosmetic Clinic'], ['estetik merkezi', 'medikal estetik', 'aesthetic centre'], 'aesthetic_clinic'),
  s('plastic_surgery', 'Plastik Cerrahi', 'health', ['Plastic Surgery Clinic', 'Cosmetic Surgery'], ['plastic surgery', 'estetik cerrahi'], 'aesthetic_clinic'),
  s('hair_transplant', 'Saç Ekimi', 'health', ['Hair Transplant Clinic'], ['hair transplant', 'saç ekim merkezi'], 'hair_transplant'),
  s('dermatology', 'Dermatoloji Kliniği', 'health', ['Dermatology Clinic'], ['Dermatoloji', 'dermatology', 'cildiye']),
  s('ivf_clinic', 'Tüp Bebek (IVF) Kliniği', 'health', ['Fertility Clinic', 'IVF Clinic'], ['Fertility / IVF Clinic', 'tüp bebek merkezi', 'tüp bebek', 'fertility']),
  s('private_hospital', 'Özel Hastane', 'health', ['Private Hospital'], ['hastane', 'hospital', 'özel hastane'], 'hospital'),
  s('hospital_group', 'Hastane Grubu', 'health', ['Hospital Group'], ['hastaneler grubu'], 'hospital'),
  s('clinic_group', 'Klinik Grubu', 'health', ['Clinic Group', 'Clinic Chain'], ['klinikler grubu', 'klinik zinciri'], 'clinic_group'),
  s('healthcare_services', 'Sağlık Hizmetleri', 'health', ['Healthcare Provider', 'Healthcare Services'], ['Sağlık', 'healthcare', 'poliklinik', 'tıp merkezi', 'medical center']),
  s('medical_tourism', 'Sağlık Turizmi', 'health', ['Medical Tourism'], ['medikal turizm'], 'medical_tourism'),
  s('dental_tourism', 'Diş Turizmi', 'health', ['Dental Tourism', 'Dental Holiday'], [], 'medical_tourism'),
  s('aesthetic_tourism', 'Estetik Turizmi', 'health', ['Aesthetic Tourism', 'Cosmetic Surgery Tourism'], [], 'medical_tourism'),
  s('hair_transplant_tourism', 'Saç Ekimi Turizmi', 'health', ['Hair Transplant Tourism'], [], 'medical_tourism'),
  s('medical_tourism_facilitator', 'Sağlık Turizmi Aracı Kurumu', 'health', ['Medical Tourism Facilitator', 'Medical Tourism Agency'], ['sağlık turizmi acentesi'], 'medical_tourism'),
  s('diagnostic_center', 'Görüntüleme ve Tanı Merkezi', 'health', ['Diagnostic Center', 'Diagnostic Imaging Center'], ['tanı merkezi', 'diagnostic centre'], 'diagnostics'),
  s('laboratory', 'Tıbbi Laboratuvar', 'health', ['Medical Laboratory', 'Laboratory'], ['laboratuvar', 'tahlil laboratuvarı'], 'diagnostics'),
  s('radiology_center', 'Radyoloji Merkezi', 'health', ['Radiology Center'], ['radyoloji', 'radiology centre'], 'diagnostics'),
  s('veterinary_clinic', 'Veteriner Kliniği', 'health', ['Veterinary Clinic', 'Vet Clinic', 'Animal Hospital'], ['veteriner', 'veteriner hekim', 'hayvan hastanesi'], 'veterinary'),
  s('physiotherapy', 'Fizik Tedavi Merkezi', 'health', ['Physiotherapy Clinic'], ['fizyoterapi', 'fizik tedavi', 'physiotherapy'], 'therapy_practice'),
  s('psychology_practice', 'Psikoloji ve Danışmanlık Merkezi', 'health', ['Psychology Practice', 'Therapy Center'], ['psikolog', 'psikoloji', 'terapi merkezi'], 'therapy_practice'),

  // ---------- Turizm ve Konaklama ----------
  s('hotel', 'Otel ve Konaklama', 'tourism', ['Hotel'], ['otel', 'konaklama', 'hotels'], 'hotel'),
  s('luxury_hotel', 'Lüks Otel', 'tourism', ['Luxury Hotel', '5 Star Hotel'], ['beş yıldızlı otel'], 'hotel'),
  s('boutique_hotel', 'Butik Otel', 'tourism', ['Boutique Hotel'], ['butik otel'], 'hotel'),
  s('resort', 'Tatil Köyü ve Resort', 'tourism', ['Resort', 'Beach Resort'], ['tatil köyü'], 'hotel'),
  s('hospitality_group', 'Otel Grubu', 'tourism', ['Hospitality Group', 'Hotel Group'], ['otel zinciri'], 'hotel'),
  s('golf_resort', 'Golf Resort', 'tourism', ['Golf Resort'], [], 'hotel'),
  s('ski_resort', 'Kayak Merkezi', 'tourism', ['Ski Resort'], ['kayak oteli'], 'hotel'),
  s('villa_rental', 'Villa Kiralama', 'tourism', ['Villa Rental'], ['villa kiralama', 'kiralık villa'], 'villa_rental'),
  s('holiday_rental', 'Tatil Evi Kiralama', 'tourism', ['Holiday Rental', 'Vacation Rental'], ['günlük kiralık ev', 'apart kiralama'], 'villa_rental'),
  s('dmc', 'Turizm Acentesi (DMC)', 'tourism', ['Destination Management Company', 'DMC', 'Tourism Company'], ['Tourism / DMC', 'turizm şirketi', 'turizm acentesi'], 'tour_travel'),
  s('tour_operator', 'Tur Operatörü', 'tourism', ['Tour Operator'], ['tur operatörü', 'tur şirketi'], 'tour_travel'),
  s('travel_agency', 'Seyahat Acentesi', 'tourism', ['Travel Agency'], ['seyahat acentası', 'travel agent'], 'tour_travel'),
  s('luxury_travel', 'Lüks Seyahat', 'tourism', ['Luxury Travel Agency', 'Luxury Travel Company'], ['Luxury Travel'], 'tour_travel'),
  s('corporate_travel', 'Kurumsal Seyahat', 'tourism', ['Corporate Travel Management', 'Business Travel Agency'], ['Corporate Travel'], 'tour_travel'),
  s('cruise', 'Kruvaziyer', 'tourism', ['Cruise Line', 'Cruise'], ['kruvaziyer turu'], 'tour_travel'),
  s('boat_tour', 'Tekne Turu', 'tourism', ['Boat Tour'], ['tekne turları', 'gulet turu'], 'tour_travel'),
  s('excursion_company', 'Günübirlik Tur Şirketi', 'tourism', ['Excursion Company', 'Day Tours'], ['günübirlik tur'], 'tour_travel'),
  s('adventure_tourism', 'Macera Turizmi', 'tourism', ['Adventure Tourism'], ['outdoor tur'], 'tour_travel'),
  s('vip_transfer', 'VIP Transfer', 'tourism', ['VIP Transfer', 'Airport Transfer'], ['Transfer', 'transfer hizmeti', 'havalimanı transferi'], 'transfer'),
  s('chauffeur_service', 'Şoförlü Araç Hizmeti', 'tourism', ['Chauffeur Service', 'Private Driver'], ['şoförlü araç', 'limousine service'], 'transfer'),
  s('yacht_charter', 'Yat Kiralama', 'tourism', ['Yacht Charter'], ['yat kiralama', 'gulet kiralama'], 'charter'),
  s('private_jet', 'Özel Jet Kiralama', 'tourism', ['Private Jet Charter'], ['Private Jet', 'özel jet'], 'charter'),
  s('beach_club', 'Plaj Kulübü (Beach Club)', 'tourism', ['Beach Club'], ['plaj kulübü'], 'hospitality_venue'),
  s('attraction', 'Turistik Cazibe Merkezi', 'tourism', ['Tourist Attraction', 'Attraction'], ['turistik tesis'], 'attraction'),
  s('theme_park', 'Tema Parkı', 'tourism', ['Theme Park'], ['eğlence parkı', 'lunapark'], 'attraction'),
  s('luxury_concierge', 'Lüks Konsiyerj', 'tourism', ['Luxury Concierge Service'], ['Luxury Concierge', 'konsiyerj']),

  // ---------- Gayrimenkul ----------
  s('real_estate', 'Gayrimenkul', 'real_estate', ['Real Estate Company'], ['real estate', 'emlak', 'gayrimenkul şirketi']),
  s('real_estate_agency', 'Gayrimenkul Ofisi', 'real_estate', ['Real Estate Agency', 'Real Estate Broker', 'Realtor'], ['emlak ofisi', 'emlakçı', 'emlak danışmanı']),
  s('luxury_real_estate', 'Lüks Gayrimenkul', 'real_estate', ['Luxury Real Estate'], ['lüks konut']),
  s('property_developer', 'Gayrimenkul Geliştirici', 'real_estate', ['Property Developer', 'Real Estate Developer'], ['konut projesi', 'proje geliştirici'], 'property_developer'),
  s('real_estate_investment', 'Gayrimenkul Yatırımı', 'real_estate', ['Real Estate Investment Company'], ['Real Estate Investment']),
  s('commercial_real_estate', 'Ticari Gayrimenkul', 'real_estate', ['Commercial Real Estate'], ['ticari emlak']),
  s('office_leasing', 'Ofis Kiralama', 'real_estate', ['Office Leasing'], ['kiralık ofis']),
  s('retail_leasing', 'Mağaza Kiralama', 'real_estate', ['Retail Leasing', 'Retail Space Leasing'], ['kiralık mağaza']),
  s('property_consultancy', 'Gayrimenkul Danışmanlığı', 'real_estate', ['Property Consultancy'], ['gayrimenkul danışmanı']),
  s('property_management', 'Mülk Yönetimi', 'real_estate', ['Property Management Company'], ['Property Management', 'site yönetimi', 'apartman yönetimi'], 'property_management'),
  s('coworking', 'Ortak Çalışma Alanı', 'real_estate', ['Coworking Space'], ['Coworking', 'paylaşımlı ofis'], 'coworking'),
  s('business_center', 'İş Merkezi', 'real_estate', ['Business Center'], ['business centre', 'sanal ofis'], 'coworking'),

  // ---------- İnşaat ----------
  s('construction', 'İnşaat Şirketi', 'construction', ['Construction Company', 'Contractor'], ['Construction', 'inşaat', 'müteahhit', 'yapı şirketi']),
  s('renovation', 'Tadilat ve Dekorasyon', 'construction', ['Renovation Company'], ['tadilat', 'renovation']),
  s('architecture', 'Mimarlık Ofisi', 'construction', ['Architecture Firm'], ['Architecture', 'mimarlık', 'mimar'], 'design_project'),
  s('interior_design', 'İç Mimarlık', 'construction', ['Interior Design Studio'], ['Interior Design', 'iç tasarım', 'iç mimar'], 'design_project'),
  s('flooring', 'Zemin Kaplama', 'construction', ['Flooring Company'], ['Flooring', 'parke']),
  s('equipment_rental', 'Ekipman ve İş Makinesi Kiralama', 'construction', ['Equipment Rental'], ['iş makinesi kiralama', 'ekipman kiralama'], 'equipment_rental'),

  // ---------- Perakende ve E Ticaret ----------
  s('ecommerce', 'E Ticaret', 'retail', ['E-commerce', 'Online Store'], ['e ticaret', 'e-ticaret', 'eticaret', 'online mağaza', 'ecommerce', 'internet mağazası'], 'ecommerce'),
  s('marketplace', 'Online Pazaryeri', 'retail', ['Online Marketplace', 'Marketplace'], ['pazaryeri'], 'marketplace'),
  s('marketplace_seller', 'Pazaryeri Satıcısı', 'retail', ['Marketplace Seller'], ['pazaryeri mağazası'], 'ecommerce'),
  s('d2c_brand', 'Doğrudan Tüketiciye Satış Markası (D2C)', 'retail', ['D2C Brand', 'Direct to Consumer Brand'], ['d2c'], 'ecommerce'),
  s('consumer_brand', 'Tüketici Markası', 'retail', ['Consumer Brand'], []),
  s('subscription_business', 'Abonelik İşletmesi', 'retail', ['Subscription Business'], ['abonelik'], 'subscription'),
  s('luxury_retail', 'Lüks Perakende', 'retail', ['Luxury Retail'], ['lüks mağaza']),
  s('luxury_goods', 'Lüks Tüketim Ürünleri', 'retail', ['Luxury Goods'], []),
  s('luxury_brand', 'Lüks Marka', 'retail', ['Luxury Brand'], []),
  s('premium_brand', 'Premium Marka', 'retail', ['Premium Brand'], []),
  s('fashion', 'Moda', 'retail', ['Fashion Brand', 'Fashion'], ['moda markası', 'giyim mağazası', 'butik']),
  s('luxury_fashion', 'Lüks Moda', 'retail', ['Luxury Fashion'], []),
  s('jewelry', 'Mücevher', 'retail', ['Jewelry Store', 'Jewellery'], ['Jewelry', 'kuyumcu', 'mücevherat']),
  s('watches', 'Saat', 'retail', ['Watch Retailer', 'Watches'], ['saat mağazası']),
  s('cosmetics', 'Kozmetik', 'retail', ['Cosmetics Brand', 'Cosmetics'], ['kozmetik markası']),
  s('skincare', 'Cilt Bakım Ürünleri', 'retail', ['Skincare Brand', 'Skincare'], []),
  s('beauty_brand', 'Güzellik Markası', 'retail', ['Beauty Brand'], []),
  s('perfume', 'Parfüm', 'retail', ['Perfume Brand', 'Perfume'], ['parfümeri']),
  s('haircare', 'Saç Bakım Ürünleri', 'retail', ['Haircare Brand', 'Haircare'], []),
  s('consumer_electronics', 'Tüketici Elektroniği', 'retail', ['Consumer Electronics'], ['elektronik mağazası']),
  s('pharmacy_chain', 'Eczane Zinciri', 'retail', ['Pharmacy Chain', 'Pharmacy'], ['eczane']),
  s('furniture', 'Mobilya', 'retail', ['Furniture Store', 'Furniture Company'], ['Furniture', 'mobilya mağazası'], 'furniture_showroom'),
  s('home_decoration', 'Ev Dekorasyonu', 'retail', ['Home Decor Store', 'Home Decoration'], ['dekorasyon']),
  s('interior_products', 'İç Mekan Ürünleri', 'retail', ['Interior Products'], []),
  s('kitchen_bathroom', 'Mutfak ve Banyo', 'retail', ['Kitchen and Bathroom Showroom'], ['Kitchen & Bathroom', 'mutfak banyo'], 'furniture_showroom'),
  s('lighting', 'Aydınlatma', 'retail', ['Lighting Store', 'Lighting'], ['aydınlatma mağazası']),
  s('art_gallery', 'Sanat Galerisi', 'retail', ['Art Gallery'], ['galeri'], 'collector_sales'),
  s('auction_house', 'Müzayede Evi', 'retail', ['Auction House'], ['müzayede'], 'collector_sales'),
  s('antiques', 'Antika', 'retail', ['Antiques Dealer', 'Antiques'], ['antikacı'], 'collector_sales'),
  s('beverage_brand', 'İçecek Markası', 'retail', ['Beverage Brand'], []),
  s('coffee_brand', 'Kahve Markası', 'retail', ['Coffee Brand'], []),
  s('franchise', 'Franchise İşletmesi', 'retail', ['Franchise'], ['franchise', 'bayilik sistemi'], 'franchise'),

  // ---------- Güzellik ve Kişisel Bakım ----------
  s('beauty_salon', 'Güzellik Salonu', 'beauty', ['Beauty Salon'], ['güzellik merkezi', 'beauty center']),
  s('hair_salon', 'Kuaför', 'beauty', ['Hair Salon'], ['kuaför salonu', 'hairdresser']),
  s('barber', 'Berber', 'beauty', ['Barber Shop', 'Barber'], ['erkek kuaförü']),
  s('wellness_spa', 'Spa ve Wellness', 'beauty', ['Wellness Center', 'Spa'], ['Wellness / Spa', 'spa merkezi', 'wellness']),
  s('nail_studio', 'Tırnak Stüdyosu', 'beauty', ['Nail Salon'], ['manikür pedikür', 'nail bar']),

  // ---------- Otomotiv ----------
  s('automotive', 'Otomotiv', 'automotive', ['Automotive Company'], ['Automotive', 'otomotiv şirketi']),
  s('car_rental', 'Araç Kiralama', 'automotive', ['Car Rental'], ['araç kiralama', 'araba kiralama', 'rent a car', 'oto kiralama'], 'car_rental'),
  s('car_dealership', 'Otomobil Bayisi', 'automotive', ['Car Dealership'], ['oto galeri', 'otomobil galerisi', 'araç bayisi'], 'car_dealership'),
  s('luxury_automotive', 'Lüks Otomotiv', 'automotive', ['Luxury Car Dealer', 'Luxury Automotive'], [], 'car_dealership'),
  s('commercial_vehicles', 'Ticari Araçlar', 'automotive', ['Commercial Vehicles'], ['ticari araç'], 'car_dealership'),
  s('fleet_services', 'Filo Hizmetleri', 'automotive', ['Fleet Services', 'Fleet Management'], ['filo kiralama', 'filo yönetimi'], 'car_rental'),
  s('auto_service', 'Oto Servis', 'automotive', ['Auto Repair Shop', 'Car Service Center'], ['oto tamir', 'araç servisi', 'oto bakım', 'otomotiv servisi'], 'auto_service'),
  s('mobility', 'Mobilite', 'automotive', ['Mobility Company', 'Mobility'], ['mobilite hizmetleri']),
  s('marine_yacht_sales', 'Yat ve Tekne Satışı', 'automotive', ['Yacht Sales', 'Yacht Broker'], ['Marine / Yacht Sales', 'tekne satışı']),
  s('marine_services', 'Denizcilik Hizmetleri', 'automotive', ['Marine Services'], ['denizcilik']),
  s('yacht_refit', 'Yat Bakım ve Refit', 'automotive', ['Yacht Refit'], ['tekne bakım'], 'auto_service'),

  // ---------- Eğitim ----------
  s('education', 'Eğitim Kurumu', 'education', ['Education Company'], ['Education', 'eğitim kurumu', 'eğitim şirketi']),
  s('private_school', 'Özel Okul', 'education', ['Private School'], ['kolej', 'özel kolej']),
  s('language_school', 'Dil Okulu', 'education', ['Language School'], ['dil kursu'], 'course_center'),
  s('university', 'Üniversite', 'education', ['University'], ['üniversite']),
  s('online_education', 'Online Eğitim', 'education', ['Online Education', 'Online Courses'], ['uzaktan eğitim'], 'course_center'),
  s('training_company', 'Eğitim ve Kurs Şirketi', 'education', ['Training Company'], ['kurs merkezi', 'dershane', 'etüt merkezi'], 'course_center'),
  s('corporate_education', 'Kurumsal Eğitim', 'education', ['Corporate Training'], ['Corporate Education'], 'corporate_training'),

  // ---------- Profesyonel Hizmetler ----------
  s('consulting', 'Danışmanlık', 'professional', ['Consulting Firm', 'Consulting'], ['danışmanlık şirketi']),
  s('management_consultancy', 'Yönetim Danışmanlığı', 'professional', ['Management Consultancy'], []),
  s('business_consultancy', 'İş Danışmanlığı', 'professional', ['Business Consultancy'], ['iş geliştirme danışmanlığı']),
  s('legal_services', 'Hukuk Bürosu', 'professional', ['Law Firm', 'Legal Services'], ['avukatlık bürosu', 'avukatlık ofisi', 'hukuk bürosu'], 'law_firm'),
  s('corporate_law', 'Şirketler Hukuku', 'professional', ['Corporate Law Firm', 'Corporate Law'], [], 'law_firm'),
  s('immigration_law', 'Göç Hukuku', 'professional', ['Immigration Law Firm', 'Immigration Law'], [], 'law_firm'),
  s('immigration_consultancy', 'Göçmenlik Danışmanlığı', 'professional', ['Immigration Consultancy'], ['vize danışmanlığı', 'visa consultancy'], 'immigration'),
  s('citizenship_residency', 'Vatandaşlık ve Oturum Danışmanlığı', 'professional', ['Citizenship by Investment', 'Residency Consultancy'], ['Citizenship / Residency Consultancy', 'oturum izni danışmanlığı'], 'immigration'),
  s('accounting', 'Muhasebe ve Mali Müşavirlik', 'professional', ['Accounting Firm', 'Accountants'], ['Accounting', 'muhasebe', 'mali müşavir', 'muhasebe bürosu', 'smmm'], 'accounting'),
  s('tax_advisory', 'Vergi Danışmanlığı', 'professional', ['Tax Advisory'], ['vergi danışmanı'], 'accounting'),
  s('recruitment', 'İşe Alım ve Personel', 'professional', ['Recruitment Agency'], ['Recruitment', 'insan kaynakları ajansı', 'personel ajansı'], 'recruitment'),
  s('executive_search', 'Yönetici Arama (Executive Search)', 'professional', ['Executive Search'], ['headhunter'], 'recruitment'),
  s('hr_services', 'İK Hizmetleri', 'professional', ['HR Services'], ['insan kaynakları hizmetleri']),
  s('professional_services', 'Profesyonel Hizmet Şirketi', 'professional', ['Professional Services'], []),
  s('b2b_services', 'B2B Hizmetler', 'professional', ['B2B Services'], []),
  s('relocation_services', 'Taşınma ve Yerleşim Danışmanlığı', 'professional', ['Relocation Services'], ['relocation'], 'immigration'),

  // ---------- Finans ve Sigorta ----------
  s('finance', 'Finans', 'finance', ['Financial Services', 'Finance'], ['finansal hizmetler']),
  s('insurance', 'Sigorta', 'finance', ['Insurance Agency', 'Insurance Broker', 'Insurance'], ['sigorta acentesi', 'sigorta brokeri'], 'insurance'),
  s('investment_company', 'Yatırım Şirketi', 'finance', ['Investment Company'], []),
  s('investment_advisory', 'Yatırım Danışmanlığı', 'finance', ['Investment Advisory'], [], 'wealth'),
  s('wealth_management', 'Varlık Yönetimi', 'finance', ['Wealth Management'], ['portföy yönetimi'], 'wealth'),
  s('private_equity', 'Özel Sermaye (Private Equity)', 'finance', ['Private Equity'], [], 'deal_flow'),
  s('venture_capital', 'Girişim Sermayesi', 'finance', ['Venture Capital'], ['vc'], 'deal_flow'),
  s('mortgage_broker', 'Konut Kredisi Danışmanlığı', 'finance', ['Mortgage Broker'], ['kredi danışmanı']),

  // ---------- Teknoloji ----------
  s('b2b_saas', 'B2B Yazılım (SaaS)', 'technology', ['B2B SaaS'], ['saas'], 'saas'),
  s('software_company', 'Yazılım Şirketi', 'technology', ['Software Company'], ['yazılım firması']),
  s('it_services', 'BT Hizmetleri', 'technology', ['IT Services', 'Managed IT Services'], ['bilgi teknolojileri hizmetleri']),
  s('cybersecurity', 'Siber Güvenlik', 'technology', ['Cybersecurity Company'], ['Cybersecurity']),
  s('fintech', 'Finansal Teknoloji (Fintech)', 'technology', ['Fintech'], [], 'saas'),
  s('healthtech', 'Sağlık Teknolojisi', 'technology', ['Healthtech', 'Health Tech Company'], [], 'saas'),
  s('edtech', 'Eğitim Teknolojisi', 'technology', ['Edtech'], [], 'saas'),
  s('proptech', 'Gayrimenkul Teknolojisi', 'technology', ['Proptech'], [], 'saas'),
  s('traveltech', 'Seyahat Teknolojisi', 'technology', ['Traveltech', 'Travel Technology Company'], [], 'saas'),

  // ---------- Üretim ----------
  s('manufacturing', 'Üretim', 'manufacturing', ['Manufacturing Company', 'Manufacturer'], ['Manufacturing', 'imalat', 'üretim firması', 'fabrika']),
  s('b2b_manufacturing', 'B2B Üretim', 'manufacturing', ['B2B Manufacturing', 'Contract Manufacturer'], ['fason üretim']),
  s('industrial_equipment', 'Endüstriyel Ekipman', 'manufacturing', ['Industrial Equipment'], []),
  s('industrial_automation', 'Endüstriyel Otomasyon', 'manufacturing', ['Industrial Automation'], ['otomasyon']),
  s('machinery', 'Makine', 'manufacturing', ['Machinery Manufacturer', 'Machinery'], ['makine imalatı']),
  s('packaging', 'Ambalaj', 'manufacturing', ['Packaging Manufacturer', 'Packaging'], ['ambalaj üretimi']),
  s('printing', 'Matbaa ve Baskı', 'manufacturing', ['Printing Company', 'Printing'], ['matbaa']),
  s('textile', 'Tekstil', 'manufacturing', ['Textile Company', 'Textile'], ['tekstil üretimi']),
  s('fashion_manufacturer', 'Hazır Giyim Üreticisi', 'manufacturing', ['Fashion Manufacturer', 'Apparel Manufacturer'], ['konfeksiyon']),
  s('jewelry_manufacturer', 'Mücevher Üreticisi', 'manufacturing', ['Jewelry Manufacturer'], []),
  s('food_manufacturing', 'Gıda Üretimi', 'manufacturing', ['Food Manufacturer', 'Food Manufacturing'], ['gıda üreticisi']),
  s('kitchen_manufacturer', 'Mutfak Üreticisi', 'manufacturing', ['Kitchen Manufacturer'], ['mutfak imalatı']),
  s('bathroom_manufacturer', 'Banyo Ürünleri Üreticisi', 'manufacturing', ['Bathroom Manufacturer'], []),
  s('lighting_manufacturer', 'Aydınlatma Üreticisi', 'manufacturing', ['Lighting Manufacturer'], []),
  s('stone_marble', 'Doğal Taş ve Mermer', 'manufacturing', ['Natural Stone', 'Marble Supplier'], ['Stone / Marble', 'mermer', 'doğal taş']),
  s('shipyard', 'Tersane', 'manufacturing', ['Shipyard'], ['tekne imalatı']),
  s('dental_laboratory', 'Diş Laboratuvarı', 'manufacturing', ['Dental Laboratory'], ['diş protez laboratuvarı']),

  // ---------- Lojistik ve Taşımacılık ----------
  s('logistics', 'Lojistik', 'logistics', ['Logistics Company'], ['Logistics', 'lojistik firması']),
  s('freight', 'Nakliye ve Yük Taşımacılığı', 'logistics', ['Freight Forwarder', 'Freight'], ['nakliye', 'yük taşımacılığı']),
  s('shipping', 'Denizyolu Taşımacılığı', 'logistics', ['Shipping Company', 'Shipping'], ['denizyolu']),
  s('courier', 'Kurye ve Kargo', 'logistics', ['Courier Service'], ['kurye', 'kargo']),
  s('moving_company', 'Evden Eve Nakliyat', 'logistics', ['Moving Company'], ['nakliyat', 'evden eve']),

  // ---------- Toptan Satış ve Distribütörlük ----------
  s('wholesale', 'Toptan Satış', 'wholesale', ['Wholesale', 'Wholesaler'], ['toptancı', 'toptan']),
  s('import_export', 'İthalat ve İhracat', 'wholesale', ['Import Export Company'], ['Import / Export', 'dış ticaret']),
  s('import_company', 'İthalat Şirketi', 'wholesale', ['Import Company'], ['ithalatçı']),
  s('export_company', 'İhracat Şirketi', 'wholesale', ['Export Company'], ['ihracatçı']),
  s('medical_devices', 'Tıbbi Cihaz', 'wholesale', ['Medical Devices', 'Medical Device Company'], ['medikal cihaz']),
  s('medical_distribution', 'Medikal Dağıtım', 'wholesale', ['Medical Distribution', 'Medical Supplies Distributor'], ['medikal malzeme']),
  s('beauty_distribution', 'Kozmetik Distribütörlüğü', 'wholesale', ['Beauty Distribution', 'Cosmetics Distributor'], ['kozmetik toptan']),
  s('building_materials', 'Yapı Malzemeleri', 'wholesale', ['Building Materials Supplier', 'Building Materials'], ['yapı market', 'inşaat malzemeleri']),
  s('construction_equipment', 'İş Makineleri', 'wholesale', ['Construction Equipment'], ['iş makinesi']),
  s('restaurant_supply', 'Restoran Tedarikçisi', 'wholesale', ['Restaurant Supply'], ['endüstriyel mutfak']),
  s('hotel_supply', 'Otel Tedarikçisi', 'wholesale', ['Hotel Supply'], ['otel ekipmanları']),

  // ---------- Yeme İçme ----------
  s('food_beverage', 'Yiyecek ve İçecek', 'food', ['Food and Beverage Company'], ['Food & Beverage', 'yiyecek içecek']),
  s('restaurant', 'Restoran', 'food', ['Restaurant'], ['restoran', 'lokanta']),
  s('restaurant_group', 'Restoran Grubu', 'food', ['Restaurant Group'], ['restoran zinciri'], 'restaurant_group'),
  s('fine_dining', 'Fine Dining Restoran', 'food', ['Fine Dining'], ['fine dining']),
  s('cafe_chain', 'Kafe Zinciri', 'food', ['Cafe Chain'], ['kafe', 'kahve zinciri'], 'restaurant_group'),
  s('catering', 'Catering ve Yemek Hizmetleri', 'food', ['Catering Company'], ['Catering', 'catering', 'toplu yemek'], 'catering'),
  s('bakery', 'Fırın ve Pastane', 'food', ['Bakery'], ['pastane', 'fırın']),

  // ---------- Spor ve Fitness ----------
  s('fitness', 'Fitness Stüdyosu', 'sports', ['Fitness Studio', 'Fitness'], ['fitness', 'pilates stüdyosu', 'yoga stüdyosu']),
  s('gym', 'Spor Salonu', 'sports', ['Gym'], ['spor salonu', 'fitness salonu']),
  s('sports_club', 'Spor Kulübü', 'sports', ['Sports Club'], ['spor kulübü']),
  s('golf', 'Golf Kulübü', 'sports', ['Golf Club', 'Golf'], ['golf kulübü']),
  s('sports_academy', 'Spor Akademisi', 'sports', ['Sports Academy'], ['spor okulu', 'futbol okulu'], 'sports_academy'),

  // ---------- Etkinlik ve Organizasyon ----------
  s('events', 'Etkinlik Organizasyonu', 'events', ['Event Management', 'Events'], ['organizasyon', 'etkinlik ajansı']),
  s('event_venue', 'Etkinlik Mekanı', 'events', ['Event Venue'], ['etkinlik salonu', 'davet salonu'], 'event_venue'),
  s('event_production', 'Etkinlik Prodüksiyonu', 'events', ['Event Production'], []),
  s('conference_exhibition', 'Kongre ve Fuar', 'events', ['Exhibition Organizer', 'Conference Organizer'], ['Conference / Exhibition', 'fuar organizasyonu'], 'exhibitions'),
  s('mice', 'Kongre ve Toplantı Turizmi (MICE)', 'events', ['MICE Agency', 'Meetings and Events'], ['MICE']),
  s('wedding', 'Düğün Organizasyonu', 'events', ['Wedding Planner', 'Wedding'], ['düğün', 'düğün planlama'], 'wedding'),
  s('destination_wedding', 'Destinasyon Düğünü', 'events', ['Destination Wedding Planner'], ['Destination Wedding'], 'wedding'),
  s('wedding_venue', 'Düğün Mekanı', 'events', ['Wedding Venue'], ['düğün salonu', 'kır düğünü mekanı'], 'event_venue'),
  s('nightlife_venue', 'Gece Kulübü ve Eğlence Mekanı', 'events', ['Nightlife Venue'], ['gece kulübü'], 'hospitality_venue'),
  s('entertainment', 'Eğlence', 'events', ['Entertainment Company'], ['Entertainment', 'eğlence şirketi']),

  // ---------- Medya ve Yaratıcı Hizmetler ----------
  s('marketing_agency', 'Pazarlama Ajansı', 'media', ['Marketing Agency'], ['reklam ajansı', 'dijital ajans'], 'agency'),
  s('creative_studio', 'Kreatif Stüdyo', 'media', ['Creative Studio'], ['tasarım stüdyosu'], 'agency'),
  s('photography_production', 'Fotoğraf ve Video Prodüksiyonu', 'media', ['Video Production', 'Photography Studio'], ['Photography / Production', 'fotoğraf stüdyosu', 'prodüksiyon şirketi'], 'agency'),
  s('media_company', 'Medya Şirketi', 'media', ['Media Company'], ['yayıncılık']),

  // ---------- Ev ve Yerel Hizmetler ----------
  s('home_services', 'Ev Hizmetleri', 'home_services', ['Home Services'], ['ev hizmetleri']),
  s('cleaning_services', 'Temizlik Hizmetleri', 'home_services', ['Cleaning Services', 'Cleaning Company'], ['temizlik şirketi']),
  s('facility_management', 'Tesis Yönetimi', 'home_services', ['Facility Management'], ['tesis yönetim']),
  s('security_services', 'Güvenlik Hizmetleri', 'home_services', ['Security Services Company'], ['Security Services', 'özel güvenlik']),
  s('hvac', 'Isıtma, Soğutma ve Havalandırma', 'home_services', ['HVAC Contractor'], ['HVAC', 'klima servisi', 'iklimlendirme']),
  s('pool_landscaping', 'Havuz ve Peyzaj', 'home_services', ['Pool and Landscaping', 'Landscaping Company'], ['Pool / Landscaping', 'peyzaj', 'havuz bakımı']),
  s('smart_home', 'Akıllı Ev Sistemleri', 'home_services', ['Smart Home Installer', 'Smart Home'], ['akıllı ev']),
  s('home_automation', 'Ev Otomasyonu', 'home_services', ['Home Automation'], []),
  s('pet_services', 'Evcil Hayvan Hizmetleri', 'home_services', ['Pet Services', 'Pet Grooming'], ['Evcil Hayvan', 'pet kuaför', 'pet otel'], 'pet_services'),

  // ---------- Enerji ----------
  s('solar_energy', 'Güneş Enerjisi', 'energy', ['Solar Energy Company', 'Solar Installer'], ['Solar Energy', 'GES kurulumu', 'güneş paneli']),
  s('renewable_energy', 'Yenilenebilir Enerji', 'energy', ['Renewable Energy'], []),
  s('energy_services', 'Enerji Hizmetleri', 'energy', ['Energy Services'], []),
  s('ev_charging', 'Elektrikli Araç Şarj', 'energy', ['EV Charging'], ['şarj istasyonu']),
];
