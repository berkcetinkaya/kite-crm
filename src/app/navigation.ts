import {
  CalendarDays,
  Handshake,
  Home,
  ListChecks,
  Mail,
  Search,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type RouteId =
  | 'home'
  | 'pipeline'
  | 'research'
  | 'outreach'
  | 'clients'
  | 'tasks'
  | 'calendar'
  | 'finance'
  | 'settings';

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { id: 'home', label: 'Ana Sayfa', icon: Home },
  { id: 'pipeline', label: 'Satış Süreci', icon: Handshake },
  { id: 'research', label: 'Araştırma', icon: Search },
  { id: 'outreach', label: 'Mailler', icon: Mail },
  { id: 'clients', label: 'Müşteriler', icon: Users },
  { id: 'tasks', label: 'Görevler', icon: ListChecks },
  { id: 'calendar', label: 'Takvim', icon: CalendarDays },
  { id: 'finance', label: 'Finans', icon: Wallet },
  { id: 'settings', label: 'Ayarlar', icon: Settings },
];

export function isRouteId(value: string): value is RouteId {
  return navItems.some((item) => item.id === value);
}
