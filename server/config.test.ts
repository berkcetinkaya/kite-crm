import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig: API key isolation', () => {
  it('reads the key only from KITE_ANTHROPIC_API_KEY', () => {
    expect(loadConfig({ KITE_ANTHROPIC_API_KEY: '  kite-test-key  ' }).anthropicApiKey).toBe('kite-test-key');
  });

  it('ignores the generic ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'generic-key', ANTHROPIC_AUTH_TOKEN: 'generic-token' });
    expect(config.anthropicApiKey).toBeNull();
  });

  it('prefers nothing but the KITE variable when both are set', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'generic-key', KITE_ANTHROPIC_API_KEY: 'kite-key' });
    expect(config.anthropicApiKey).toBe('kite-key');
  });

  it('treats an empty KITE variable as not configured', () => {
    expect(loadConfig({ KITE_ANTHROPIC_API_KEY: '   ' }).anthropicApiKey).toBeNull();
  });

  it('ignores the generic ANTHROPIC_BASE_URL', () => {
    expect(loadConfig({ ANTHROPIC_BASE_URL: 'https://proxy.invalid' }).anthropicBaseUrl).toBe('https://api.anthropic.com');
  });
});
