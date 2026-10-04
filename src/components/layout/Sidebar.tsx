import { navItems, type RouteId } from '../../app/navigation';

interface SidebarProps {
  active: RouteId;
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ active, open, onNavigate }: SidebarProps) {
  return (
    <aside className={open ? 'sidebar sidebar--open' : 'sidebar'} aria-label="Ana menü">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">K</span>
        <div>
          <p className="sidebar__name">KITE OS</p>
          <p className="sidebar__org">KITE Growth</p>
        </div>
      </div>
      <nav className="sidebar__nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#/${id}`}
            className={id === active ? 'sidebar__link sidebar__link--active' : 'sidebar__link'}
            aria-current={id === active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar__footer">
        <span className="avatar" aria-hidden="true">B</span>
        <div>
          <p className="sidebar__user">Berk Çetinkaya</p>
          <p className="sidebar__role">Kurucu</p>
        </div>
      </div>
    </aside>
  );
}
