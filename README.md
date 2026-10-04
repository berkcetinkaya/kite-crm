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
  components/
    layout/       AppShell, Sidebar
    ui/           Card, Badge, Toast (shared primitives)
  features/
    home/         Ana Sayfa (Phase 1): sections/, sidebar/, home.css
    placeholder/  Placeholder for modules not built yet
  data/mock/      Mock data (replaced by live data in later phases)
  lib/            Domain types, date and number formatting
  styles/         Design tokens (light/dark) and global styles
```

## Fazlar

- **Phase 0:** App shell, navigation, design tokens
- **Phase 1:** Ana Sayfa ("Bugün ne yapmalıyım?") with mock data
