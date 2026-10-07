// Bounded website inspection: homepage + a few same-site pages (contact, services, booking, about,
// pricing). Never crawls further. Failures are reported, not thrown, so one site cannot fail a job.
import type { WebsiteTechnicalSummary } from '../../src/domain/research';
import { extractPage, pickExtraPages, type PageExtract } from './extract';
import { FetchError, type PageFetcher } from './safeFetch';

export interface WebsiteInspection {
  ok: boolean;
  /** Why the homepage could not be inspected (internal code, not shown raw to users). */
  failure: string | null;
  pages: PageExtract[];
  technical: WebsiteTechnicalSummary;
}

export const EMPTY_TECHNICAL: WebsiteTechnicalSummary = {
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
  languageVersions: null,
  copyrightYear: null,
  pagesInspected: [],
};

export async function inspectWebsite(
  website: string,
  fetchPage: PageFetcher,
  options: { maxExtraPages: number; signal?: AbortSignal },
): Promise<WebsiteInspection> {
  const start = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  let home;
  try {
    home = await fetchPage(start, options.signal);
  } catch (e) {
    if (options.signal?.aborted) throw e;
    // Some sites still only answer on plain HTTP; try once before giving up.
    if (start.startsWith('https://') && e instanceof FetchError && e.code === 'network') {
      try {
        home = await fetchPage(start.replace('https://', 'http://'), options.signal);
      } catch {
        // fall through
      }
    }
    if (!home) {
      return { ok: false, failure: e instanceof FetchError ? e.code : 'network', pages: [], technical: EMPTY_TECHNICAL };
    }
  }

  const homeExtract = extractPage(home.html, home.finalUrl, 'home');
  const pages: PageExtract[] = [homeExtract];
  for (const extra of pickExtraPages(homeExtract, options.maxExtraPages)) {
    if (options.signal?.aborted) break;
    try {
      const page = await fetchPage(extra.url, options.signal);
      pages.push(extractPage(page.html, page.finalUrl, extra.kind));
    } catch {
      // A missing sub-page is not a failure of the inspection.
    }
  }

  const any = (fn: (p: PageExtract) => boolean) => pages.some(fn);
  const social = [...new Set(pages.flatMap((p) => p.socialLinks))].slice(0, 8);
  const ctaCount = homeExtract.ctaTexts.length;

  return {
    ok: true,
    failure: null,
    pages,
    technical: {
      inspected: true,
      finalUrl: home.finalUrl,
      https: home.finalUrl.startsWith('https://'),
      httpStatus: home.status,
      redirected: home.redirected,
      responseTimeMs: home.elapsedMs,
      hasViewport: homeExtract.hasViewport,
      hasTitle: !!homeExtract.title,
      hasMetaDescription: !!homeExtract.metaDescription,
      h1Count: homeExtract.h1Count,
      formCount: pages.reduce((n, p) => n + p.formCount, 0),
      ctaCount,
      hasBookingSignal: any((p) => p.bookingSignal),
      hasEcommerceSignal: any((p) => p.ecommerceSignal),
      hasWhatsApp: any((p) => p.whatsappLinks.length > 0),
      hasEmail: any((p) => p.emails.length > 0),
      hasPhone: any((p) => p.phones.length > 0),
      hasContactPage: pages.some((p) => p.kind === 'contact'),
      socialLinks: social,
      language: homeExtract.language,
      hasStructuredData: homeExtract.structuredDataTypes.length > 0,
      hasCanonical: !!homeExtract.canonical,
      languageVersions: homeExtract.languageAlternates.length,
      copyrightYear: pages.map((p) => p.copyrightYear).reduce<number | null>((m, y) => (y !== null && (m === null || y > m) ? y : m), null),
      pagesInspected: pages.map((p) => ({ url: p.url, title: p.title, kind: p.kind })),
    },
  };
}
