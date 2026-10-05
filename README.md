# KITE OS

Internal operating system for KITE Growth: sales, outreach, clients, tasks and finance in one place.

## Geliştirme

Requires **Node.js 22.13.0 or newer** (the server uses the built-in `node:sqlite` module, available
without a flag from 22.13; Vite 8 itself needs 22.12+). `package.json` declares this under `engines`.

```bash
npm install
npm run dev          # UI: http://localhost:5173 (proxies /api to the research server)
npm run dev:server   # research server: http://127.0.0.1:8787 (needed for "Gerçek Araştırma")
npm test             # unit + fixture tests (no API calls, no cost)
npm run build        # typecheck (app + server) + production build
npm start            # production: serves dist/ and /api from one Node process
```

## Gerçek Araştırma (Phase 4) kurulumu

1. `cp .env.example .env` and set `KITE_ANTHROPIC_API_KEY`. Optional: `KITE_ANTHROPIC_MODEL` (default
   `claude-opus-5-5`) and the research limits listed in `.env.example`. The generic `ANTHROPIC_API_KEY`,
   `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL` are deliberately ignored, so KITE's
   settings stay separate from Claude Code or other tools.
2. Run `npm run dev:server` next to `npm run dev`, or `npm run build && npm start` for production.
3. In **Yeni Müşteri Bul**, choose **Gerçek** as the research mode. The badge shows whether the server is ready.

- **Demo vs Gerçek:** Demo creates fictional companies locally (no network). Gerçek searches the public web on
  the server (Anthropic web search), inspects a few public pages of each official website with a bounded,
  SSRF-protected fetcher, and scores every KITE service from evidence. Results are always labelled by mode.
- **Without a key:** demo mode keeps working; Gerçek shows "Gerçek araştırmayı kullanmak için Anthropic API
  bağlantısı yapılandırılmalı."
- **Offline testing:** `RESEARCH_PROVIDER=fixture npm run dev:server` runs the full real-research UI with
  deterministic fixture data on `.example` domains, labelled "Test verisi (fixture)".
- **Security:** `KITE_ANTHROPIC_API_KEY` is read only by the Node server (`server/`). It is never sent to the
  browser, never prefixed with `VITE_`, and `.env` is git-ignored. Never commit a real key.
- **Persistence:** research jobs, results and transferred companies are stored in the server database
  (see *Kalıcı Veri* below) and survive refreshes and server restarts.

## Sektörler ve Mail & Takip (Phase 5)

- **Sectors:** every sector the UI shows is Turkish. `src/domain/sectorTaxonomy/` holds the catalogue
  (id, Turkish label, family, English search terms, aliases) and 20 sector families. Legacy and English
  values ("Dental Clinic", "Transfer") resolve to their Turkish label; unknown sectors are kept as typed.
- **CRM sector intelligence:** `src/domain/sectorIntelligence/` (family profiles + sector overrides +
  generic fallback). It is general guidance about a type of business, never a fact about a company.
- **Mail drafts:** Mail & Takip prepares first contact drafts on the server (`/api/mail/*`) from Phase 4
  evidence, sector intelligence and the selected service. Drafts are reviewed, edited and approved;
  **nothing is sent** and the company's sales status does not change. Offline:
  `RESEARCH_PROVIDER=fixture npm run dev:server` uses a deterministic fixture generator (no API call).
  With a key, the same isolated `KITE_ANTHROPIC_*` settings are used.

## Kalıcı Veri (Phase 5.5)

Companies (with contacts, notes, history, opportunities and research provenance), research jobs and
results, and mail drafts with their versions are stored in a local **SQLite** database through Node's
built-in `node:sqlite` module. Only the Node server opens the file; the browser reads and writes through
the KITE API (`/api/prospects`, `/api/research/jobs`, `/api/mail/drafts`).

- **Location:** `data/kite.db` by default. Override with `KITE_DB_PATH` (absolute, or relative to the
  project root). `data/` and `*.db*` files are git-ignored: the database is never committed.
- **Schema:** versioned migrations in `server/db/migrations.ts` run automatically on startup and are
  idempotent (`schema_migrations` records the applied versions).
- **Fresh install:** the CRM starts empty. Mock companies are never inserted automatically. For a demo
  database run `npm run db:seed-demo` (only works on a database with no companies).
- **Restarts:** research jobs that were running when the server stopped are marked as failed
  ("Araştırma, sunucu yeniden başlatıldığı için yarıda kaldı.").
- **Secrets:** the database stores business data only. API keys, credentials, tokens and headers are
  never written to it.
- **Backup:** stop the server (`Ctrl+C`; it closes the database cleanly), then copy `data/kite.db`. If
  `kite.db-wal` / `kite.db-shm` files exist next to it, copy them together with the main file. To restore,
  stop the server and put the copied file(s) back at the configured path.
- **If saving fails** the UI shows a Turkish error and does not pretend the change was saved.

## Gmail Gönderimi ve Yanıt Takibi (Phase 6)

An approved draft is sent through Gmail only when Berk picks a stored contact in **Mail & Takip**,
presses **Gönder…**, reviews the full final mail and confirms **Bu Maili Gönder**. Approval alone never
sends. There is no scheduled sending and no automatic follow-up.

- **Connect:** *Ayarlar & Otomasyon → Gmail'i Bağla*. Google OAuth (web server flow with `state` bound
  to the browser by an HttpOnly cookie, single-use, plus PKCE S256). Scopes: `gmail.send` (send approved
  mail) and `gmail.readonly` (read the threads KITE sent, find an unclear send). No modify/delete scope.
- **Setup:** create an OAuth client (type *Web application*) in Google Cloud, enable the Gmail API, register
  the redirect URI (e.g. `http://localhost:5173/api/gmail/oauth/callback` in development) and set
  `KITE_GMAIL_CLIENT_ID`, `KITE_GMAIL_CLIENT_SECRET`, `KITE_GMAIL_REDIRECT_URI` and `KITE_CREDENTIALS_KEY`
  (see `.env.example`).
- **Credentials:** the Gmail grant is stored encrypted (AES-256-GCM) in `data/gmail-credentials.enc`
  (`KITE_GMAIL_TOKEN_PATH`), never in SQLite, browser storage or logs. The key comes only from
  `KITE_CREDENTIALS_KEY`. A missing or wrong key fails safely (Gmail shows as not usable). *Bağlantıyı Kes*
  revokes the grant at Google and deletes the file. Back up the key separately from the data directory.
- **Duplicate protection:** every confirmation has an idempotency key; a draft can have only one send that
  is in flight, sent or unresolved (also a UNIQUE index). If Gmail does not answer clearly (timeout, 5xx)
  the send is marked **Kontrol gerekiyor**: never retried automatically; *Gmail'de Kontrol Et* looks it up
  by its `X-KITE-Send-Id` header, or Berk marks it as not sent.
- **After a confirmed send:** the exact subject/body snapshot and Gmail message/thread ids are stored, the
  company gets a history entry and `lastContactAt`, and moves to **İlk Temas** unless it is already later in
  the pipeline (or in a side state such as İlgilenmiyor).
- **Replies:** *Yanıtları Kontrol Et* reads only the Gmail threads of KITE sends, stores new messages that
  are not Berk's own (de-duplicated by Gmail message id) as plain text, and moves the company to **Yanıt
  Geldi** only from Bulundu/Araştırıldı/İlk Temas. Görüşme and later stages and side states never move.
- **Offline:** `KITE_GMAIL_PROVIDER=fixture` uses a deterministic fixture Gmail (no Google request, no real
  email). Recipient addresses containing `reject`, `ratelimit`, `timeout`, `lost`, `reply` or `replies` pick
  the simulated outcome.

## Yapı

```
src/
  app/            App, navigation config, hash router
  domain/         Canonical business model: sales statuses, services, score bands, company,
                  research jobs/results, sectors, countries/cities, service guidance
  domain/sectorTaxonomy/     Sector catalogue, families, aliases, resolution (Phase 5)
  domain/sectorIntelligence/ CRM profiles per family/sector, inheritance, fallback (Phase 5)
  domain/mail/    Mail draft model, generation context, output safety rules (Phase 5)
  api/            Browser clients for the server (/api/research/*, /api/mail/*, data API)
  state/          App-wide state owners (companies, research jobs: reducer + provider + runner)
  components/
    layout/       AppShell, Sidebar
    ui/           Card, Badge, Toast, Drawer, Tabs, FormField, EmptyState
    sales/        Status badge/options, opportunity score and summary
  features/
    home/         Ana Sayfa (Phase 1): sections/, sidebar/, home.css
    prospects/    Potansiyel Müşteriler (Phase 2): list, query, detail drawer
    discover/     Yeni Müşteri Bul (Phase 3): research form, demo results, transfer
    mail/         Mail & Takip (Phase 5–6): company list, draft editor, send confirmation, thread + replies
    settings/     Ayarlar & Otomasyon (Phase 6): Gmail connection
    placeholder/  Placeholder for modules not built yet
  data/mock/      Mock data (replaced by live data in later phases)
  lib/            View types, date/number/text/url helpers, ids
  styles/         Design tokens (light/dark) and global styles
server/           Research server (Node, no framework): config, routes, provider adapter
  research/       Discovery, analysis pipeline, Anthropic + fixture providers, prompts, schemas
  web/            Safe public page fetcher (SSRF protection), HTML extraction, site inspection
  mail/           Mail generation: prompts, schema, Anthropic + fixture providers, validation
  db/             SQLite connection, migrations, repositories, demo seed command (Phase 5.5)
  persistence/    Request validation, persistence services (transactions), data API routes
  gmail/          Gmail adapter: OAuth (state + PKCE), encrypted credential store, REST client, fixture
  outreach/       Sending (eligibility, idempotency, unclear sends), reply sync, /api/gmail + /api/outreach
data/             Local database (git-ignored, created on first start)
```

## Fazlar

- **Phase 0:** App shell, navigation, design tokens
- **Phase 1:** Ana Sayfa ("Bugün ne yapmalıyım?") with mock data
- **Phase 2:** Potansiyel Müşteriler: company model, search/filter/sort, detail drawer, local edits
- **Phase 3:** Yeni Müşteri Bul: research requests, demo results, transfer to Potansiyel Müşteriler
- **Phase 4:** Real company research: server-side web search, website inspection, evidence-based scoring
- **Phase 5:** Turkish sector system, CRM sector intelligence, first contact mail drafts (no sending)
- **Phase 5.5:** Persistent data layer: SQLite on the server, repositories, data API, restart-safe state
- **Phase 6:** Gmail sending of approved drafts (explicit confirmation, duplicate protection) and reply tracking
