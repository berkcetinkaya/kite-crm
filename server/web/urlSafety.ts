// SSRF protection for the public website fetcher. Every URL (including each redirect target) is
// checked syntactically here, and every DNS answer is checked again at connect time (safeFetch's
// lookup hook), so a public-looking hostname cannot resolve to a private address.
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(public readonly reason: string) {
    super(`Unsafe URL: ${reason}`);
    this.name = 'UnsafeUrlError';
  }
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.localdomain'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Parses and validates a URL for public fetching. Throws UnsafeUrlError. */
export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError('unparseable');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`protocol ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError('credentials in URL');
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`port ${url.port}`);

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UnsafeUrlError('empty host');
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;

  if (isIP(bare)) {
    if (!isPublicIp(bare)) throw new UnsafeUrlError('private IP');
    return url;
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError('internal hostname');
  if (!host.includes('.')) throw new UnsafeUrlError('single-label hostname');
  // Hostnames that encode IPs in other notations (e.g. 2130706433, 0x7f.1) never reach here as
  // names: the WHATWG URL parser normalises them to dotted IPv4, which isIP() catches above.
  return url;
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isPublicIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return !IPV4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPublicIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return false;
  // IPv4-mapped / translated (::ffff:a.b.c.d, ::ffff:7f00:1): judge the embedded IPv4.
  const mapped = v.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  const mappedHex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPublicIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(v.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (v.startsWith('64:ff9b:') || v.startsWith('100::') || v.startsWith('2001:db8:')) return false; // NAT64 / discard / docs
  return true;
}

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicIpv4(ip);
  if (kind === 6) return isPublicIpv6(ip);
  return false;
}
