# KITE OS

Internal operating system for KITE Growth: sales, outreach, clients, tasks and finance in one place.

## Geliştirme

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run typecheck
```

## Yapı

```
src/
  app/            App, navigation config, hash router
  domain/         Canonical business model: sales statuses, services, score bands, company,
                  research jobs/results, sectors, countries/cities, service guidance
  state/          App-wide state owners (companies, research jobs: reducer + provider)
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
```

## Fazlar

- **Phase 0:** App shell, navigation, design tokens
- **Phase 1:** Ana Sayfa ("Bugün ne yapmalıyım?") with mock data
- **Phase 2:** Potansiyel Müşteriler: company model, search/filter/sort, detail drawer, local edits
- **Phase 3:** Yeni Müşteri Bul: research requests, demo results, transfer to Potansiyel Müşteriler
