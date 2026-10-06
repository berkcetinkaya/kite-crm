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
import { createFixtureMailProvider } from './mail/fixtureMailProvider';
import { createAnthropicMailProvider } from './mail/anthropicMailProvider';
import { openStore, type OpenedStore } from './db/store';
import { createPersistenceServices } from './persistence/services';
import { createGmailProvider } from './gmail';
import { createOutreachService } from './outreach/service';
import { createFollowUpPlanner } from './followUp/service';
import { createSalesService } from './sales/service';
import { createClock } from './clock';
import { createTestRoutes } from './testing/routes';

const config = loadConfig();
// One clock for every timestamp; movable only through the fixture-only test controls.
const clock = createClock(config.testClockOffsetMs);
const now = () => clock.now();
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '../dist');

const provider =
  config.provider === 'fixture'
    ? createFixtureProvider()
    : config.anthropicApiKey
      ? createAnthropicProvider(config)
      : null;

// Mail drafts use the same provider choice and the same KITE-only credentials as research.
const mailProvider =
  config.provider === 'fixture'
    ? createFixtureMailProvider()
    : config.anthropicApiKey
      ? createAnthropicMailProvider(config)
      : null;

const fetchPage =
  config.provider === 'fixture'
    ? fixtureFetcher
    : createSafeFetcher({
        timeoutMs: config.limits.fetchTimeoutMs,
        maxBytes: config.limits.maxPageBytes,
        maxRedirects: config.limits.maxRedirects,
      });

// Persistent data (Phase 5.5): SQLite file at KITE_DB_PATH (default data/kite.db). Migrations run
// on every start; a research job that was still running when the process stopped is marked failed.
let store: OpenedStore | null = null;
try {
  store = openStore(config.dbPath);
  const interrupted = store.research.markInterrupted('Araştırma, sunucu yeniden başlatıldığı için yarıda kaldı.', new Date().toISOString());
  console.log(`[db] ${config.dbPath} (schema v${store.schemaVersion})${interrupted ? `, ${interrupted} yarıda kalan araştırma işaretlendi` : ''}`);
} catch (e) {
  console.error('[db] database could not be opened; data endpoints are disabled:', e instanceof Error ? e.message : e);
}
// Follow ups (Phase 7): planning only. Generation happens solely on Berk's explicit request.
const followUps = store ? createFollowUpPlanner(store, { now, mailProvider }) : null;
const data = store ? createPersistenceServices(store, { mailProvider, now, followUps }) : null;
// Sales process (Phase 8): meetings and proposals, manual only (no email, no AI, no automatic stage moves).
const sales = store ? createSalesService(store, { now, followUps }) : null;

// Gmail (Phase 6): OAuth credentials live in the encrypted credential file, never in the database.
const gmailProvider = createGmailProvider(config.gmail, { now: () => clock.now().getTime() });
const gmail = gmailProvider.provider;
const outreach = store ? createOutreachService(store, gmail, { now, followUps }) : null;
if (outreach) {
  const recovered = outreach.recoverInterrupted();
  if (recovered.sends) console.log(`[gmail] ${recovered.sends} yarıda kalan gönderim "kontrol gerekiyor" olarak işaretlendi`);
}
// Startup evaluation of stored follow up state (local rules only: no Gmail, no model, no send).
if (followUps) {
  const changed = followUps.reconcileAll();
  if (changed) console.log(`[followup] ${changed} takip planı kayıtlı duruma göre güncellendi`);
}
const testRoutes = config.testControls && gmailProvider.fixture ? createTestRoutes({ clock, store, fixture: gmailProvider.fixture }) : null;
if (testRoutes) console.log('[test] TEST CONTROLS enabled (fixture Gmail + fixture provider only)');

const handler = createApp({
  config,
  provider,
  mailProvider,
  data,
  outreach,
  followUps,
  sales,
  testRoutes,
  fetchPage,
  staticDir: process.env.NODE_ENV === 'production' && existsSync(distDir) ? distDir : undefined,
});

const server = http.createServer(handler);

// Close the database cleanly (WAL checkpoint) when the process is stopped.
function shutdown() {
  server.close();
  try {
    store?.close();
  } catch {
    // already closed
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(config.port, config.host, () => {
  const mode =
    config.provider === 'fixture'
      ? 'FIXTURE provider (offline test data)'
      : provider
        ? `Anthropic provider, model ${config.anthropicModel} (${process.env.KITE_ANTHROPIC_MODEL?.trim() ? 'KITE_ANTHROPIC_MODEL' : 'default'})`
        : 'real research disabled (KITE_ANTHROPIC_API_KEY not set)';
  console.log(`[server] http://${config.host}:${config.port} — ${mode}`);
  const gmailMode = gmail.kind === 'fixture' ? 'FIXTURE Gmail (no real email is sent)' : gmail.configured ? 'Google OAuth configured' : 'not configured (KITE_GMAIL_CLIENT_ID/SECRET/REDIRECT_URI)';
  console.log(`[gmail] ${gmailMode}`);
});
