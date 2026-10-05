// Error contract of the persistence API (/api/prospects, /api/research/jobs, /api/mail/drafts).
// Messages are Turkish and shown to Berk as they are.

export type DataErrorCode = 'invalid_request' | 'not_found' | 'conflict' | 'storage_error' | 'storage_unavailable';

export const DATA_ERROR_MESSAGES: Record<DataErrorCode, string> = {
  invalid_request: 'Gönderilen bilgiler geçersiz.',
  not_found: 'Kayıt bulunamadı.',
  conflict: 'Bu işlem şu anda yapılamıyor.',
  storage_error: 'Değişiklik kaydedilemedi. Lütfen tekrar dene.',
  storage_unavailable: 'Veri deposu kullanılamıyor. Sunucunun veritabanı ayarlarını kontrol et.',
};

/** Shown when the browser cannot reach the KITE server at all. */
export const DATA_UNREACHABLE_MESSAGE = 'KITE sunucusuna ulaşılamıyor. Değişiklikler kaydedilemez.';

export interface DataErrorBody {
  error: { code: string; message: string; problems?: string[] };
}
