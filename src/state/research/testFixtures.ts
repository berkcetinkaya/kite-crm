// Shared test data for research state tests. Not used by the app.
import type { WebsiteTechnicalSummary } from '../../domain/research';

export const EMPTY_TECHNICAL_FOR_TESTS: WebsiteTechnicalSummary = {
  inspected: false,
  finalUrl: null,
  https: null,
  httpStatus: null,
  redirected: null,
  responseTimeMs: null,
  hasViewport: null,
  hasTitle: null,
  hasMetaDescription: null,
  h1Count: null,
  formCount: null,
  ctaCount: null,
  hasBookingSignal: null,
  hasEcommerceSignal: null,
  hasWhatsApp: null,
  hasEmail: null,
  hasPhone: null,
  hasContactPage: null,
  socialLinks: [],
  language: null,
  hasStructuredData: null,
  hasCanonical: null,
  pagesInspected: [],
};
