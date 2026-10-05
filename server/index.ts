// KITE OS research server. Keeps the Anthropic key server-side; the browser only talks to /api/*.
//   Development: `npm run dev:server` (Vite proxies /api to this server).
//   Production:  `npm run build && npm start` (serves dist/ and the API from one process).
import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config';
import { createApp } from './app';
import { createAnthropicProvider } from './research/anthropicProvider';
import { createFixtureProvider, fixtureFetcher } from './research/fixtureProvider';
import { createSafeFetcher } from './web/safeFetch';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');

const provider =
  config.provider === 'fixture'
    ? createFixtureProvider()
    : config.anthropicApiKey
      ? createAnthropicProvider(config)
      : null;

const fetchPage =
  config.provider === 'fixture'
    ? fixtureFetcher
    : createSafeFetcher({
        timeoutMs: config.limits.fetchTimeoutMs,
        maxBytes: config.limits.maxPageBytes,
        maxRedirects: config.limits.maxRedirects,
      });

const handler = createApp({
  config,
  provider,
  fetchPage,
  staticDir: process.env.NODE_ENV === 'production' && existsSync(distDir) ? distDir : undefined,
});

http.createServer(handler).listen(config.port, config.host, () => {
  const mode =
    config.provider === 'fixture'
      ? 'FIXTURE provider (offline test data)'
      : provider
        ? `Anthropic provider, model ${config.anthropicModel} (${process.env.KITE_ANTHROPIC_MODEL?.trim() ? 'KITE_ANTHROPIC_MODEL' : 'default'})`
        : 'real research disabled (KITE_ANTHROPIC_API_KEY not set)';
  console.log(`[server] http://${config.host}:${config.port} — ${mode}`);
});
