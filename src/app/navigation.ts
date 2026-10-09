import {
  Building2,
  FileText,
  Handshake,
  House,
  ListChecks,
  Mail,
  Settings,
  Telescope,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type RouteId =
  | 'home'
  | 'discover'
  | 'prospects'
  | 'outreach'
  | 'pipeline'
  | 'proposals'
  | 'clients'
  | 'tasks'
  | 'settings'
  | 'agent';

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
}

// Only finished modules are listed (Phase 14 readiness): Ödemeler, KITE Finans, Berk (Kişisel),
// Raporlar and KITE Agent are not built; their old addresses open Ana Sayfa.
export const navItems: NavItem[] = [
  { id: 'home', label: 'Ana Sayfa', icon: House },
  { id: 'discover', label: 'Yeni Müşteri Bul', icon: Telescope },
  { id: 'prospects', label: 'Potansiyel Müşteriler', icon: Building2 },
  { id: 'outreach', label: 'Mail & Takip', icon: Mail },
  { id: 'pipeline', label: 'Satış Süreci', icon: Handshake },
  { id: 'proposals', label: 'Teklifler', icon: FileText },
  { id: 'clients', label: 'Müşteriler', icon: Users },
  { id: 'tasks', label: 'İşler', icon: ListChecks },
  { id: 'settings', label: 'Ayarlar & Otomasyon', icon: Settings },
];

export function isRouteId(value: string): value is RouteId {
  return navItems.some((item) => item.id === value);
}
