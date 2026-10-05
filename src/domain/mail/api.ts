// Contract between the browser and the mail generation endpoint (/api/mail/*).
import type { ResearchErrorCode } from '../researchApi';
import type { MailEvidenceRef, MailGenerationNotes, MailSectorContext } from './draft';

export type { MailGenerateRequest } from './context';

export type MailErrorCode =
  | Extract<ResearchErrorCode, 'not_configured' | 'auth' | 'rate_limit' | 'busy' | 'timeout' | 'unavailable' | 'invalid_request' | 'provider_rejected' | 'invalid_response' | 'refused' | 'cancelled' | 'server_unreachable' | 'internal'>
  | 'unsafe_output';

export const MAIL_ERROR_MESSAGES: Record<MailErrorCode, string> = {
  not_configured: 'Mail taslağı üretmek için Anthropic API bağlantısı yapılandırılmalı.',
  auth: 'API bağlantısı doğrulanamadı.',
  rate_limit: 'Taslak servisi şu anda yoğun. Biraz sonra tekrar dene.',
  busy: 'Şu anda başka taslaklar hazırlanıyor. Biraz sonra tekrar dene.',
  timeout: 'Taslak hazırlama zaman aşımına uğradı.',
  unavailable: 'Taslak servisine şu anda ulaşılamıyor.',
  invalid_request: 'Taslak isteği geçersiz.',
  provider_rejected: 'Taslak servisi isteği reddetti (servis hatası). Biraz sonra tekrar dene.',
  invalid_response: 'Taslak servisi beklenmeyen bir yanıt verdi.',
  refused: 'Taslak servisi bu isteği işlemedi.',
  unsafe_output: 'Üretilen taslak KITE yazım ve doğruluk kurallarına uymadığı için kullanılmadı. Yeniden oluşturmayı dene.',
  cancelled: 'Taslak hazırlama durduruldu.',
  server_unreachable: 'Araştırma sunucusuna ulaşılamıyor.',
  internal: 'Taslak hazırlanırken beklenmeyen bir hata oluştu.',
};

export interface MailStatusResponse {
  ready: boolean;
  provider: 'anthropic' | 'fixture' | null;
}

export interface MailGenerateResponse {
  subjectOptions: string[];
  body: string;
  evidenceRefs: MailEvidenceRef[];
  sectorContext: MailSectorContext;
  generationNotes: MailGenerationNotes;
  generatedAt: string;
}

export interface MailErrorBody {
  error: { code: MailErrorCode; message: string; problems?: string[] };
}
