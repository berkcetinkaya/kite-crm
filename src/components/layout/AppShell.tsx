import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import type { RouteId } from '../../app/navigation';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  route: RouteId;
  children: ReactNode;
}

export function AppShell({ route, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="shell">
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menüyü aç"
          aria-expanded={menuOpen}
        >
          <Menu size={20} />
        </button>
        <span className="mobile-bar__title">KITE OS</span>
      </header>
      <Sidebar active={route} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <main className="shell__main">{children}</main>
    </div>
  );
}
