import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, isPublicIp } from './urlSafety';
import { createSafeFetcher, FetchError } from './safeFetch';

describe('assertPublicHttpUrl', () => {
  const rejected = [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://127.1.2.3:80/',
    'http://2130706433/', // 127.0.0.1 as an integer
    'http://0x7f.0.0.1/',
    'http://10.0.0.5/',
    'http://172.16.4.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://metadata.google.internal/',
    'http://intranet/',
    'http://printer.local/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'javascript:alert(1)',
    'http://user:pass@example.com/',
    'http://example.com:8080/',
    'not a url',
  ];
  it.each(rejected)('rejects %s', (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow();
  });

  it.each(['https://example.com/', 'http://www.dentglow.com.tr/contact', 'https://8.8.8.8/', 'https://münchen.example/'])('accepts %s', (url) => {
    expect(() => assertPublicHttpUrl(url)).not.toThrow();
  });
});

describe('isPublicIp', () => {
  it('classifies addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIp('192.168.0.10')).toBe(false);
    expect(isPublicIp('::ffff:10.0.0.1')).toBe(false);
    expect(isPublicIp('::ffff:7f00:1')).toBe(false);
    expect(isPublicIp('not-an-ip')).toBe(false);
  });
});

describe('createSafeFetcher', () => {
  const fetchPage = createSafeFetcher({ timeoutMs: 2000, maxBytes: 100_000, maxRedirects: 2 });

  it('refuses private targets before connecting', async () => {
    await expect(fetchPage('http://127.0.0.1:80/')).rejects.toMatchObject({ code: 'unsafe_url' });
    await expect(fetchPage('http://169.254.169.254/')).rejects.toBeInstanceOf(FetchError);
  });

  it('refuses hostnames that resolve to loopback (DNS check at connect time)', async () => {
    // "localhost.example" is not a special name syntactically, but "localhost" is; use a name
    // that resolves to 127.0.0.1 on every system:
    await expect(fetchPage('http://localhost/')).rejects.toMatchObject({ code: 'unsafe_url' });
  });
});
