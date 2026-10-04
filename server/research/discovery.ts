// Discovery: ask the provider for candidates, then validate them in code. Model-proposed URLs are
// never trusted: official websites must be safe public URLs that are not directories/social/aggregators,
// and cited sources must either have appeared in the search results or live on the official domain.
import type { DiscoverResponse, DiscoveredCandidate } from '../../src/domain/researchApi';
import type { EvidenceSourceType, ResearchCriteria, ResearchEvidence } from '../../src/domain/research';
import { websiteHost } from '../../src/lib/url';
import { foldForSearch } from '../../src/lib/text';
import { assertPublicHttpUrl } from '../web/urlSafety';
import type { ResearchProviderAdapter } from './provider';
import { parseDiscoveryCandidates } from './schemas';

/** Hosts that are never a company's official website (directories, social, aggregators, references). */
const NOT_OFFICIAL_HOSTS = [
  'wikipedia.org', 'wikidata.org', 'facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com',
  'tiktok.com', 'youtube.com', 'pinterest.com', 'google.com', 'goo.gl', 'g.page', 'maps.app.goo.gl', 'yelp.com',
  'tripadvisor.com', 'booking.com', 'airbnb.com', 'expedia.com', 'hotels.com', 'trustpilot.com', 'glassdoor.com',
  'crunchbase.com', 'bloomberg.com', 'zoominfo.com', 'yellowpages.com', 'yell.com', 'foursquare.com',
  'clutch.co', 'opencorporates.com', 'dnb.com', 'apple.com', 'amazon.com', 'etsy.com', 'ebay.com',
  'whatsapp.com', 'wa.me', 'medium.com', 'reddit.com', 'quora.com', 'trendyol.com', 'hepsiburada.com',
  'sahibinden.com', 'doktortakvimi.com', 'zocdoc.com', 'healthgrades.com', 'whatclinic.com', 'realtor.com',
  'zillow.com', 'rightmove.co.uk', 'bayut.com', 'propertyfinder.ae', 'dubizzle.com', 'getyourguide.com', 'viator.com',
];

const NOT_OFFICIAL_PATTERN = /(^|\.)(tripadvisor|booking|yelp|wikipedia|yellowpages|google)\./;

export function isNotOfficialHost(host: string): boolean {
  return NOT_OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || NOT_OFFICIAL_PATTERN.test(host);
}

/** Validates an official website URL; returns the normalised origin URL or null. */
export function validateOfficialWebsite(raw: string | null): { url: string; host: string } | { error: string } {
  if (!raw) return { error: 'Resmi website belirlenemedi.' };
  let url: URL;
  try {
    url = assertPublicHttpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: 'Website adresi geçersiz veya güvenli değil.' };
  }
  const host = websiteHost(url.toString());
  if (!host) return { error: 'Website adresi geçersiz.' };
  if (isNotOfficialHost(host)) return { error: 'Önerilen adres bir rehber, sosyal medya veya platform sayfası; resmi website değil.' };
  return { url: `${url.protocol}//${url.host}/`, host };
}

/**
 * The source type is decided by code, not the model: pages on the official domain are official;
 * anything else the model labelled "official" is downgraded to a search result.
 */
function evidenceSourceType(url: string, claimed: EvidenceSourceType, official: boolean): EvidenceSourceType {
  if (official) return new URL(url).pathname.length > 1 ? 'official_page' : 'official_website';
  return claimed === 'official_website' || claimed === 'official_page' ? 'search_result' : claimed;
}

export interface DiscoveryOptions {
  targetCount: number;
  maxSearches: number;
  knownHosts: string[];
  signal?: AbortSignal;
  now?: () => Date;
  makeId?: (i: number) => string;
}

export async function runDiscovery(
  provider: ResearchProviderAdapter,
  criteria: ResearchCriteria,
  options: DiscoveryOptions,
): Promise<DiscoverResponse> {
  const raw = await provider.discoverCompanies({
    criteria,
    knownHosts: options.knownHosts,
    targetCount: options.targetCount,
    maxSearches: options.maxSearches,
    signal: options.signal,
  });
  // Allow a little slack for rejections, but never accept an unbounded list.
  const parsed = parseDiscoveryCandidates(raw.candidates, options.targetCount * 2);
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  const searchUrls = new Set(raw.searchResults.map((r) => r.url));

  const candidates: DiscoveredCandidate[] = [];
  const rejected: DiscoverResponse['rejected'] = [];
  const seenHosts = new Set<string>();
  const seenNames = new Set<string>();

  for (const c of parsed) {
    if (candidates.length >= options.targetCount) break;
    const site = validateOfficialWebsite(c.officialWebsite);
    if ('error' in site) {
      rejected.push({ name: c.name, reason: site.error });
      continue;
    }
    const nameKey = `${foldForSearch(c.name)}|${foldForSearch(c.country || criteria.country)}`;
    if (seenHosts.has(site.host) || seenNames.has(nameKey)) {
      rejected.push({ name: c.name, reason: 'Aynı şirket listede zaten var (tekrar).' });
      continue;
    }
    seenHosts.add(site.host);
    seenNames.add(nameKey);

    const evidence: ResearchEvidence[] = [];
    for (const s of c.sources) {
      const sourceHost = websiteHost(s.url);
      const official = sourceHost === site.host;
      // Only URLs the search tool actually returned, or pages on the official domain (re-fetched later).
      if (!official && !searchUrls.has(s.url)) continue;
      try {
        assertPublicHttpUrl(s.url);
      } catch {
        continue;
      }
      evidence.push({
        id: `d${evidence.length + 1}`,
        url: s.url,
        title: s.title || s.url,
        sourceType: evidenceSourceType(s.url, s.sourceType, official),
        claim: s.claim,
        retrievedAt,
      });
    }

    candidates.push({
      id: options.makeId?.(candidates.length) ?? `cand_${candidates.length + 1}_${Date.now().toString(36)}`,
      name: c.name,
      website: site.url,
      city: c.city,
      country: c.country || criteria.country,
      sectorFit: c.sectorFit,
      profileFit: c.profileFit,
      confidence: c.confidence,
      evidence,
    });
  }

  // An empty list is a valid answer ("no companies found"); the route maps it to no_candidates.
  return { candidates, rejected, searchesUsed: raw.searchesUsed };
}
