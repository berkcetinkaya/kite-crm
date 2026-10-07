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
sends. There is no scheduled sending; follow ups (Phase 7) are prepared and sent only by Berk.

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

## Takip Mailleri (Phase 7)

Follow ups are planned automatically but **never sent automatically**. A due follow up only appears in
the *Takip Kuyruğu* of **Mail & Takip**; Berk explicitly prepares the draft (*Takip Taslağını Hazırla*),
edits, approves and confirms *Bu Takip Mailini Gönder*. No timer, page load or server start generates a
draft or calls a model, and there is no automatic sending option anywhere.

- **Plan:** a confirmed first contact send creates a sequence (default 3 follow ups: 3, 7 and 14 days, set
  in *Ayarlar & Otomasyon → Takip Mailleri*, 1 to 3 steps). Each delay counts from the previous message's
  CONFIRMED send (or from Berk skipping the previous step); due dates are stored in UTC. A step without a
  confirmed previous message has no due date. Settings changes apply to new plans only. Sends made before
  Phase 7 get a plan only through *Takip Planı Oluştur* (never retroactively by the migration).
- **Before every follow up send** KITE reads the stored Gmail thread (read only). A new genuine reply is
  stored, applies the Phase 6 status rule, ends the sequence and blocks the send. If Gmail cannot be read,
  nothing is sent.
- **Same conversation:** follow ups are sent with the original `threadId`, `In-Reply-To` (latest KITE
  message) and `References` (the conversation's Message-IDs) and the original subject, as Gmail requires for
  threading. The recipient is always the original send's address; KITE never switches to another contact.
- **Stops and pauses:** a reply (sync or pre-send check) completes the sequence; approved drafts stay in the
  history but cannot be sent. *Yanıt Geldi*, later stages and İlgilenmiyor / Uygun Değil / Kaybedildi stop
  it; *Şimdilik Bekle* or turning the system off pauses it until Berk resumes it. An unclear (*Kontrol
  gerekiyor*) send or a removed recipient address blocks it until resolved. Sales statuses never move
  backwards because of follow ups.
- **Actions:** *Ertele* (new date, original kept), *Adımı Atla* (nothing sent; next step counted from the
  skip), *Takibi Durdur* (optional reason; history kept; sales status unchanged), *Takibi Sürdür*.
- **Generation:** separate follow up prompt and structured output (body, angle, evidence and sector use
  case ids, earlier messages considered, step). Step 1 gentle reminder, step 2 one new angle, step 3 closes
  the loop. Hard limit 140 words, no new subject, no pretending the prospect replied, no pressure or hype,
  company facts only from Phase 4 evidence (the same rules as the first email).
- **QA controls:** with `KITE_TEST_CONTROLS=1`, `KITE_GMAIL_PROVIDER=fixture` and `RESEARCH_PROVIDER=fixture`
  the server exposes `/api/test/*` (movable clock, fixture replies, failing thread reads). These routes do
  not exist in any other configuration.

## Satış Süreci ve Teklifler (Phase 8)

Manual sales process after a prospect replies. Nothing here sends email, writes proposals with AI,
generates PDFs or invoices, or changes a sales stage on its own.

- **Stages:** the existing pipeline (Yanıt Geldi → Görüşme → Teklif → Karar Bekleniyor → Müşteri, plus
  Kaybedildi and the other side states). Every change is a normal status change with a history entry.
  Meeting and proposal actions only *offer* a stage (an unticked checkbox); the status select still
  allows any manual change. Moving a company past İlk Temas stops an active follow-up plan (Phase 7 rule);
  the UI warns before that.
- **Meetings** (company drawer → Görüşmeler): date/time, online / telefon / yüz yüze, contact (snapshot),
  notes, outcome, next action. Completing a meeting can also store its next action as the company's
  “Sonraki Adım”. A meeting never makes a company a customer.
- **Proposals** (company drawer → Teklifler, or the Teklifler page): title, currency (TRY, USD, EUR, GBP,
  AED; no FX), contract months, valid until, notes, tax metadata (KDV hariç / dahil / belirtilmedi + rate;
  no tax calculation) and line items (any KITE service, one-time or monthly, amount in minor units,
  quantity). One-time and monthly totals are always shown separately. A service that is not yet an
  opportunity is added as one only when “Bu hizmeti opportunity olarak da ekle” is ticked.
- **Proposal statuses:** Taslak → Gönderilmeye Hazır → Gönderildi (with the date Berk sent it) → Kabul
  Edildi / Reddedildi (with a reason) / Süresi Doldu (marked manually). Decisions can be reopened and sent
  proposals reopened to Taslak for revision; content is editable only in Taslak / Gönderilmeye Hazır.
- **Satış Süreci** page: Yanıt Gelenler, Görüşmede, Teklif Hazırlanıyor, Karar Bekleyen Teklifler, Kabul
  Edilen Teklifler, Kaybedilenler. Rows open the company drawer.
- **Data:** schema v4 adds `meetings`, `proposals` and `proposal_items` (additive; no existing row changes).

## Müşteriler ve Onboarding (Phase 9)

Operational layer after a company becomes a customer. Manual first: KITE never starts onboarding,
activates a customer or service, completes onboarding, closes a service or marks access as received on
its own. No invoicing, payments, accounting, subscriptions, automated email or file storage.

- **Starting onboarding** (Müşteriler → “Onboarding Başlat”, an accepted proposal's “Müşteri onboarding'ini
  başlat”, or the company drawer's Müşteri card): the company must be at Müşteri. Otherwise the form shows
  an unticked “Şirketi Müşteri aşamasına taşı” checkbox and cannot be submitted until it is ticked (a
  normal status change with history). One customer record per company.
- **Services:** prefilled from the accepted proposal as editable copies (amount, currency and billing
  type are reference only). Several services of one type are allowed with an optional scope
  (e.g. `Meta Ads · Gulf`). Statuses Hazırlanıyor / Aktif / Beklemede / Tamamlandı / İptal; activating
  sets the start date, closing sets the end date.
- **Customer statuses:** Onboarding → Aktif (“Onboarding'i tamamla”; open checklist items need an explicit
  confirmation) / Beklemede / Tamamlandı / Kaybedildi, all reversible. Kaybedildi offers the Kaybedildi
  sales stage only as an unticked checkbox.
- **Onboarding checklist:** suggested items per service (editable, removable, custom items, due dates;
  Gerekli Değil items do not count). Progress and “blocked” (overdue item, access problem) are derived.
- **Access requirements:** Meta Business, Google Ads, GA4, Search Console, website admin, social accounts,
  other; İstenmedi / İstendi / Alındı / Sorun Var with dates. **Şifre, API key veya token saklamayın.**
  There are no credential fields; notes that clearly contain credentials (`password:`, `şifre:`,
  `api key:`, `secret:`, `token:`, bearer tokens) are refused by the server.
- **Responsible person** is the company owner (changes go through the normal company history).
  Every customer action is recorded in the company's single history timeline.
- **Data:** schema v5 adds `customers`, `customer_services`, `onboarding_items` and
  `access_requirements` (additive; no existing row changes).

## Ana Sayfa Operasyon Paneli (Phase 10)

Ana Sayfa is a read-only operational dashboard over existing data (`GET /api/dashboard?range=7d|30d|90d|month`).
It never writes, generates, sends, calls Gmail or Anthropic, or stores reporting data; schema stays v5.
No mock or fabricated numbers: with no data, every section shows an empty state.

- **Bugün (attention queue, current state):** access problems and overdue onboarding (Kritik); due or blocked
  follow-ups, meetings without an outcome, overdue next actions (Kritik when more than 3 days late), proposals
  waiting 7+ days (Kritik when their valid-until date has passed), next actions due today; meetings today and
  active customers without a next action (Takip). One row per signal; a blocked customer shows its specific
  cause, never a generic "blocked" row. Rows open the existing page or the company drawer.
- **Satış Özeti:** current counts for İlk Temas → Müşteri and Kaybedildi, plus stalled companies (open stages
  only: İlk Temas, Yanıt Geldi, Görüşme, Teklif, Karar Bekleniyor; 14+ days without movement).
- **Teklif Durumu:** counts per status; awaiting-decision and accepted (range) values from proposal items, one
  line per currency, one-time and monthly separate. No FX, totals, revenue or forecasts.
- **Müşteri Operasyonu:** Onboarding / Aktif / Beklemede, Engel Var, overdue items, access problems, active
  services, customers without a next action, onboarding progress.
- **Takip and Görüşmeler:** follow-up queue counts (links to Mail & Takip); meetings without an outcome, today
  and the next 7 days.
- **Seçili dönem:** plain counts of what happened in the selected range (new companies, sends, replies,
  meetings, proposals sent/accepted/rejected, new customers, stage entries). No conversion or win rates.
- **Momentum:** open-stage companies by days without movement: days in stage (from history), since the last
  send, since the last reply (inbound mail; `lastContactAt` is unchanged) and since the last activity.

## İşler: Görevler ve Hatırlatmalar (Phase 11)

İşler (`#/tasks`) shows every open piece of work in one list. Only manual tasks are stored in a new table;
everything else is derived at read time from the record that owns it and is never copied
(`GET /api/work`, read-only). Ana Sayfa's Bugün is the urgent subset of the same work items.

- **Sources:** Manuel Görev, Sonraki Adım, Görüşme, Takip, Onboarding, Erişim, Teklif and Müşteri (active
  customer without a next action). Access marked Sorun Var reaches Bugün (Kritik); İstendi and İstenmedi
  stay on İşler only; Alındı produces no item. Onboarding items appear individually on İşler and grouped per
  customer on Bugün.
- **Views:** Bugün (due today, overdue, plus everything Bugün shows), Gecikmiş, Yaklaşan (next 7 days),
  Tamamlananlar (manual tasks marked Tamamlandı in the last 30 / 90 days) and Tümü; source filter (Manuel,
  Satış, Takip, Müşteri) and search. All dates use the shared İstanbul business day.
- **Actions:** manual tasks can be completed, edited, cancelled and reopened. A next action can be cleared or
  changed (normal company history), onboarding and access status changed through their Phase 9 endpoints.
  Meetings, follow-ups and proposals only open their own pages; nothing bypasses their rules.
- **Manual tasks** (`/api/tasks`): title, notes, priority (Düşük / Normal / Yüksek), due date with optional
  time, owner (team members), optional company or customer. Statuses Açık / Tamamlandı / İptal;
  `closed_at` is set when closed and cleared on reopen. Only an explicit Tamamlandı of a company-linked task
  writes one company history entry. Notes that clearly contain credentials are refused.
- **Reminders** are due dates inside KITE OS only: no email, push, WhatsApp, calendar sync or background jobs.
- **Data:** schema v6 adds the `tasks` table (additive; no existing row changes).

## Yeni Müşteri Bul: Aday İnceleme (Phase 12)

Real research runs (Phase 4 jobs) now end in a human review workspace. Candidates stay outside the CRM
(`research_results`) until a reviewer explicitly adds them; nothing is sent, drafted or followed up.

- **Hedef:** explicit filters (sector family, website rule: required / any / none, public contact
  required, language, company size) and a pre-run summary: provider (fixture = free test, Anthropic =
  paid), maximum companies, web searches and website inspections. Real (paid) runs are capped per day
  (`RESEARCH_MAX_REAL_RUNS_PER_DAY`, default 10); fixture runs never count. Nothing starts on page load.
- **İnceleme:** per candidate: priority (Yüksek / Orta / Düşük Potansiyel) with "Neden bu firma?"
  reasons, research confidence (Yüksek / Orta / Düşük, never a percentage), Gözlenen / Çıkarım /
  Bilinmiyor signals, contact channels with their source, and a live duplicate check. Review decisions
  (İncelenmedi / Uygun / Uygun Değil, a reason is required) stay reversible until conversion. Safe bulk
  actions: Uygun, Uygun Değil, assign service or sector, add to CRM.
- **Duplicates:** same website host, exact published email or a host already converted from another run
  are hard matches (CRM'de mevcut, blocked). Same name + country or same phone is Muhtemel tekrar and
  needs an explicit "Farklı şirket" confirmation. Another unconverted run with the same host is shown for
  information. Nothing is merged.
- **CRM'e Ekle:** each candidate converts in its own transaction (a failure never rolls back the others)
  and only once (idempotent). The company opens at Bulundu with only the explicitly selected services as
  opportunities, the approved contacts (never guessed) and the reviewer note. A candidate marked Uygun
  Değil must be changed first.
- **Re-research:** one candidate at a time, explicit; the latest 3 previous snapshots are kept and the
  changes are listed. Reviewer decisions are never overwritten.
- **Website observations:** declared language versions (hreflang) and the latest visible copyright
  year are observations only; there is no SEO crawler and no invented score.
- **Data:** schema v7 adds `research_job_details`, `candidate_reviews` and `research_result_versions`
  (additive; duplicates, confidence and priority are computed live and never stored).

## Mail & Takip: Outreach Hazırlığı (Phase 13)

Every CRM company gets a computed outreach readiness (never stored as authoritative state) and a
Hazırlık tab next to the draft. Drafts are written from evidence chosen by code; the model only
phrases them. Nothing is sent, approved or followed up automatically.

- **Readiness** (first match wins): **Gönderime Uygun Değil** (Müşteri, Kaybedildi, İlgilenmiyor,
  Uygun Değil, active customer, first contact already sent, active or paused follow up, research
  exclusion, hard CRM duplicate) · **İnceleme Gerekli** (unconfirmed probable duplicate, Phase 12
  candidate without an Uygun review, low research confidence, Şimdilik Bekle, unclear earlier send) ·
  **Eksik Bilgi** (no contact with a valid email, no service, no evidence-backed angle) · **Hazır**.
  Manual and pre-Phase 12 companies are judged on the data they have; the candidate review rule only
  applies to companies that came from a Phase 12 candidate.
- **CRM duplicates** (the company itself excluded): same website host or exact contact email is hard
  and blocks; same normalized name + country or a matching phone is probable and needs "Farklı şirket".
- **Recipient:** contacts with a valid email only, best first: decision maker, named contacts by
  confidence, then the general address (neutral greeting). Nothing is guessed.
- **Angle:** a fixed catalogue per service, each defined by research signals. An angle exists only
  with evidence; strength is 2 per Gözlenen and 1 per Arama kaynağı / Çıkarım signal. "Genel tanıtım"
  (identity, sector and service only, no company claims) is used only when chosen explicitly. CTA
  options are low friction and follow research confidence; four tones (default Premium & Sakin) change
  wording only.
- **Evidence policy:** Gözlenen may be stated directly (fixed sentences), Arama kaynağı must be
  source-qualified, Çıkarım must be hedged, Bilinmiyor is never used. Revenue, budgets, traffic,
  conversion rates, team size, customer counts, growth, percentages and money amounts need a manual
  fact entered in Hazırlık.
- **Generation (prompt v2):** structured fields only (no raw research JSON), output with sections and
  a claim map. Every company-specific sentence must cite known sources; unsupported output is rejected
  before anything is saved. One automatic repair attempt with the exact problems; a second failure
  saves nothing and shows the reasons.
- **Regeneration:** whole draft, subject only, opening only or CTA only. Sections carry hashes: an
  edited section is never rewritten on its own, and replacing edits needs an explicit confirmation
  (the current text goes to Önceki sürümler). Up to two alternatives (another angle, another tone).
- **Batch:** up to 5 Hazır companies without a draft, one after another, each isolated, with a result
  per company. Real (Anthropic) generations are capped per İstanbul day
  (`MAIL_MAX_REAL_GENERATIONS_PER_DAY`, default 30; repair attempts count, fixture never counts).
- **One generation authority:** `/api/outreach-prep` and the compatibility endpoint
  `/api/mail/drafts/generate` both run the same Phase 13 service (the compatibility endpoint passes
  its service, language and contact as overrides, saved only on success). The stateless Phase 5
  `/api/mail/generate` is retired (410).
- **Send guard:** the existing Gmail send path refuses a new first contact when readiness is
  Gönderime Uygun Değil. Threading, send records, reply sync and the automatic follow up plan after a
  confirmed send are unchanged.
- **Data:** schema v8 adds `outreach_preparations` (one row per company: choices, claim map, sections,
  alternatives, readiness snapshot, prompt version). Draft text stays in `mail_drafts`.

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
    mail/         Mail & Takip (Phase 5–7): company list, draft editor, send confirmation, conversation timeline,
                  follow up queue and plan panel
    settings/     Ayarlar & Otomasyon (Phase 6–7): Gmail connection, follow up cadence
    sales/        Meetings, proposal editor/detail, drawer tabs and Satış card (Phase 8)
    pipeline/     Satış Süreci (Phase 8)
    proposals/    Teklifler (Phase 8)
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
  outreach/       Sending (eligibility, idempotency, unclear sends), reply sync, /api/gmail + /api/outreach,
                  follow up sending (pre-send thread check, same Gmail thread)
  followUp/       Follow up planner (sequences, due state, status rules, Berk's actions) + /api/follow-ups
  testing/        Fixture-only QA controls (/api/test/*), mounted only in full fixture mode
  sales/          Meetings and proposals (transactions, explicit stage moves) + /api/sales
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
- **Phase 7:** Follow up planning, due detection, follow up drafts, approval and safe same-thread sending (never automatic)
- **Phase 8:** Sales process after a reply: meetings, multi-service proposals, Satış Süreci and Teklifler (manual only)
- **Phase 9:** Müşteriler: manual onboarding, customer services, onboarding checklist and access tracking (no credentials)
- **Phase 10:** Ana Sayfa operational dashboard: attention queue, aging, sales/proposal/customer summaries (read-only)
- **Phase 11:** İşler: unified work list over existing records plus small manual tasks (schema v6), shared with Bugün
- **Phase 12:** Prospecting review: run filters and limits, candidate review, live duplicates, confidence and priority, idempotent CRM conversion (schema v7)
- **Phase 13:** Outreach readiness, evidence-based prepared drafts with claim validation, edit-safe regeneration, batch of 5, first-contact send guard (schema v8)
