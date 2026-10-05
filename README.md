# KITE OS

Internal operating system for KITE Growth: sales, outreach, clients, tasks and finance in one place.

## Geliştirme

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
- **Persistence:** research jobs, results and companies live in browser memory and reset on page refresh.

## Yapı

```
src/
  app/            App, navigation config, hash router
  domain/         Canonical business model: sales statuses, services, score bands, company,
                  research jobs/results, sectors, countries/cities, service guidance
  api/            Browser client for the research server (/api/research/*)
  state/          App-wide state owners (companies, research jobs: reducer + provider + runner)
  components/
    layout/       AppShell, Sidebar
    ui/           Card, Badge, Toast, Drawer, Tabs, FormField, EmptyState
    sales/        Status badge/options, opportunity score and summary
  features/
    home/         Ana Sayfa (Phase 1): sections/, sidebar/, home.css
    prospects/    Potansiyel Müşteriler (Phase 2): list, query, detail drawer
    discover/     Yeni Müşteri Bul (Phase 3): research form, demo results, transfer
    placeholder/  Placeholder for modules not built yet
  data/mock/      Mock data (replaced by live data in later phases)
  lib/            View types, date/number/text/url helpers, ids
  styles/         Design tokens (light/dark) and global styles
server/           Research server (Node, no framework): config, routes, provider adapter
  research/       Discovery, analysis pipeline, Anthropic + fixture providers, prompts, schemas
  web/            Safe public page fetcher (SSRF protection), HTML extraction, site inspection
```

## Fazlar

- **Phase 0:** App shell, navigation, design tokens
- **Phase 1:** Ana Sayfa ("Bugün ne yapmalıyım?") with mock data
- **Phase 2:** Potansiyel Müşteriler: company model, search/filter/sort, detail drawer, local edits
- **Phase 3:** Yeni Müşteri Bul: research requests, demo results, transfer to Potansiyel Müşteriler
- **Phase 4:** Real company research: server-side web search, website inspection, evidence-based scoring
