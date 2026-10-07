// Turns raw HTML into a small, bounded description of a page. Only this extract (never raw HTML)
// is passed to the model. Website text is untrusted data; nothing here interprets it as instructions.
import { parse, type HTMLElement } from 'node-html-parser';

export interface PageLink {
  url: string;
  text: string;
}

export interface PageExtract {
  url: string;
  kind: string;
  title: string;
  metaDescription: string;
  language: string | null;
  canonical: string | null;
  hasViewport: boolean;
  headings: { level: number; text: string }[];
  h1Count: number;
  navLabels: string[];
  ctaTexts: string[];
  formCount: number;
  formHints: string[];
  emails: string[];
  phones: string[];
  whatsappLinks: string[];
  socialLinks: string[];
  internalLinks: PageLink[];
  bookingSignal: boolean;
  ecommerceSignal: boolean;
  structuredDataTypes: string[];
  /** hreflang values of <link rel="alternate"> (language versions the site declares). */
  languageAlternates: string[];
  /** Latest year in a visible copyright line (e.g. "© 2019"); an observation, not a judgement. */
  copyrightYear: number | null;
  /** Visible text, whitespace-collapsed, bounded. */
  textExcerpt: string;
}

const MAX_TEXT = 2500;
const MAX_LIST = 25;

const CTA_PATTERN =
  /\b(book|booking|reserve|reservation|appointment|schedule|get a quote|request a quote|quote|contact us|call now|enquire|inquire|buy|shop now|add to cart|order|start|sign up|randevu|rezervasyon|teklif|iletişim|bize ulaşın|hemen ara|satın al|sepete ekle|termin|buchen|anfrage|kontakt|réserver|devis|contactez|reservar|cita|presupuesto|contatt|prenota|preventivo|احجز|اتصل)\b/i;

const BOOKING_PATTERN =
  /(calendly\.com|booksy|fresha|simplybook|setmore|acuityscheduling|opentable|resy\.com|sevenrooms|cloudbeds|siteminder|booking engine|online booking|book online|book now|randevu al|online randevu|rezervasyon yap|termin buchen|prendre rendez-vous|reservar cita|appointment)/i;

const ECOMMERCE_PATTERN =
  /(add to cart|add-to-cart|sepete ekle|in den warenkorb|ajouter au panier|añadir al carrito|aggiungi al carrello|cdn\.shopify|woocommerce|\/cart\b|\/checkout\b|"@type"\s*:\s*"Product"|data-product-id)/i;

const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com', 'pinterest.com'];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const uniq = (arr: string[], max = MAX_LIST) => [...new Set(arr.filter(Boolean))].slice(0, max);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && ha === hb;
}

export function extractPage(html: string, pageUrl: string, kind = 'home'): PageExtract {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: false, pre: true } });

  const structuredDataTypes: string[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.text);
      const items = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const item of items) {
        const t = item?.['@type'];
        if (typeof t === 'string') structuredDataTypes.push(t);
        else if (Array.isArray(t)) structuredDataTypes.push(...t.filter((x: unknown) => typeof x === 'string'));
      }
    } catch {
      // Malformed JSON-LD is ignored.
    }
  }
  const rawHtmlForSignals = html.slice(0, 400_000);
  const bookingSignal = BOOKING_PATTERN.test(rawHtmlForSignals);
  const ecommerceSignal = ECOMMERCE_PATTERN.test(rawHtmlForSignals);

  for (const el of root.querySelectorAll('script, style, noscript, svg, template, iframe')) el.remove();

  const meta = (name: string) =>
    root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
    root.querySelector(`meta[property="og:${name}"]`)?.getAttribute('content') ??
    '';

  const headings = root
    .querySelectorAll('h1, h2, h3')
    .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.text).slice(0, 140) }))
    .filter((h) => h.text)
    .slice(0, 20);

  const navLabels = uniq(
    root
      .querySelectorAll('nav a, header a')
      .map((a) => clean(a.text).slice(0, 40))
      .filter((t) => t.length > 1 && t.length <= 40),
    30,
  );

  const links = root.querySelectorAll('a[href]');
  const emails: string[] = [];
  const phones: string[] = [];
  const whatsappLinks: string[] = [];
  const socialLinks: string[] = [];
  const internalLinks: PageLink[] = [];
  const ctaTexts: string[] = [];

  for (const a of links) {
    const href = (a.getAttribute('href') ?? '').trim();
    const text = clean(a.text).slice(0, 60);
    if (CTA_PATTERN.test(text)) ctaTexts.push(text);
    if (href.startsWith('mailto:')) {
      const email = href.slice(7).split('?')[0].trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emails.push(email);
      continue;
    }
    if (href.startsWith('tel:')) {
      const phone = href.slice(4).replace(/[^\d+]/g, '');
      if (phone.replace(/\D/g, '').length >= 7) phones.push(phone);
      continue;
    }
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const host = hostOf(abs);
    if (!host) continue;
    if (host === 'wa.me' || host.endsWith('whatsapp.com')) {
      whatsappLinks.push(abs.split('?')[0]);
      continue;
    }
    if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) {
      socialLinks.push(abs.split('?')[0]);
      continue;
    }
    if (sameSite(abs, pageUrl) && /^https?:/.test(abs)) internalLinks.push({ url: abs.split('#')[0], text });
  }
  for (const b of root.querySelectorAll('button, input[type="submit"]')) {
    const text = clean(b.text || b.getAttribute('value') || '').slice(0, 60);
    if (CTA_PATTERN.test(text)) ctaTexts.push(text);
  }

  const forms = root.querySelectorAll('form');
  const formHints = uniq(
    forms.flatMap((f: HTMLElement) =>
      f.querySelectorAll('input, select, textarea').map((i) => i.getAttribute('type') || i.getAttribute('name') || i.tagName.toLowerCase()),
    ),
    15,
  );

  const bodyText = clean((root.querySelector('main') ?? root.querySelector('body') ?? root).text);

  return {
    url: pageUrl,
    kind,
    title: clean(root.querySelector('title')?.text ?? '').slice(0, 160),
    metaDescription: clean(meta('description')).slice(0, 300),
    language: root.querySelector('html')?.getAttribute('lang')?.slice(0, 12) ?? null,
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    hasViewport: !!root.querySelector('meta[name="viewport"]'),
    headings,
    h1Count: root.querySelectorAll('h1').length,
    navLabels,
    ctaTexts: uniq(ctaTexts, 15),
    formCount: forms.length,
    formHints,
    emails: uniq(emails, 5),
    phones: uniq(phones, 5),
    whatsappLinks: uniq(whatsappLinks, 3),
    socialLinks: uniq(socialLinks, 8),
    internalLinks: internalLinks.slice(0, 200),
    bookingSignal,
    ecommerceSignal,
    structuredDataTypes: uniq(structuredDataTypes, 10),
    languageAlternates: uniq(root.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => (l.getAttribute('hreflang') ?? '').toLowerCase()).filter((h) => h && h !== 'x-default'), 20),
    copyrightYear: copyrightYear(clean((root.querySelector('body') ?? root).text)),
    textExcerpt: bodyText.slice(0, MAX_TEXT),
  };
}

/** Latest plausible year in a copyright line ("© 2019", "Copyright 2015-2021"); null when none is visible. */
export function copyrightYear(text: string): number | null {
  const max = new Date().getFullYear() + 1;
  const years = [...text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y >= 1995 && y <= max);
  return years.length ? Math.max(...years) : null;
}

/** Page kinds worth one extra request, with multilingual URL/label keywords. Order = priority. */
const PAGE_KINDS: [string, RegExp][] = [
  ['contact', /contact|iletisim|iletişim|kontakt|contacto|contatti|contactez|اتصل/i],
  ['services', /services?|hizmet|leistung|servicios|servizi|treatments?|tedavi|behandlung|tours?|turlar|properties|listings|emlak|collections?|products?|urunler|ürünler|shop/i],
  ['booking', /book|booking|reserv|randevu|termin|appointment|cita|prenota/i],
  ['about', /about|hakkimizda|hakkımızda|uber-uns|über-uns|a-propos|quienes|chi-siamo|who-we-are|team|ekibimiz/i],
  ['pricing', /pric|fiyat|preise|tarif|precios|prezzi|packages|paketler/i],
];

/** Picks up to `max` same-site pages to inspect after the homepage. */
export function pickExtraPages(home: PageExtract, max: number): { url: string; kind: string }[] {
  const chosen: { url: string; kind: string }[] = [];
  const seen = new Set([home.url.replace(/\/$/, '')]);
  for (const [kind, pattern] of PAGE_KINDS) {
    if (chosen.length >= max) break;
    const link = home.internalLinks.find((l) => {
      const key = l.url.replace(/\/$/, '');
      if (seen.has(key)) return false;
      let path = '';
      try {
        path = decodeURIComponent(new URL(l.url).pathname);
      } catch {
        return false;
      }
      return pattern.test(path) || pattern.test(l.text);
    });
    if (link) {
      seen.add(link.url.replace(/\/$/, ''));
      chosen.push({ url: link.url, kind });
    }
  }
  return chosen;
}
