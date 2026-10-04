/** "https://www.Ornek.com/" -> "ornek.com". Returns null for empty input. */
export function normalizeWebsite(value: string): string | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
  return v || null;
}

export function isPlausibleDomain(value: string): boolean {
  return /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(value);
}

/** Absolute URL for an external link to a stored bare domain or profile path. */
export function toExternalUrl(value: string): string {
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

/**
 * Comparable host for duplicate detection: "https://www.Example.com/en/" -> "example.com".
 * Uses the URL parser so IDN domains are punycode-normalised. Returns null if unparseable.
 */
export function websiteHost(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
    return host.replace(/^www\d?\./, '') || null;
  } catch {
    return null;
  }
}
