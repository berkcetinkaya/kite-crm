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
