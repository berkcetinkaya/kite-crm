import type { ServiceKey } from '../../domain/services';

export const researchServices: ServiceKey[] = ['crm', 'website', 'google_ads', 'meta_ads', 'social_media'];

export const researchSectors = [
  'Diş Kliniği',
  'Estetik Klinik',
  'Butik Otel',
  'Villa Kiralama',
  'Tur Operatörü',
  'Transfer',
  'Restoran',
  'E-ticaret',
] as const;

export const researchLocations = [
  'İstanbul',
  'Ankara',
  'İzmir',
  'Antalya',
  'Muğla (Bodrum / Marmaris)',
  'Türkiye geneli',
] as const;

export const researchCompanyCounts = [10, 20, 30, 50] as const;
