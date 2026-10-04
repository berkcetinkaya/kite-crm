import {
  Bot,
  Building2,
  ChartColumn,
  CreditCard,
  FileText,
  Handshake,
  House,
  ListChecks,
  Mail,
  PiggyBank,
  Settings,
  Telescope,
  Users,
  Wallet,
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
  | 'payments'
  | 'finance'
  | 'personal'
  | 'reports'
  | 'settings'
  | 'agent';

export interface NavItem {
  id: RouteId;
  label: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { id: 'home', label: 'Ana Sayfa', icon: House },
  { id: 'discover', label: 'Yeni Müşteri Bul', icon: Telescope },
  { id: 'prospects', label: 'Potansiyel Müşteriler', icon: Building2 },
  { id: 'outreach', label: 'Mail & Takip', icon: Mail },
  { id: 'pipeline', label: 'Satış Süreci', icon: Handshake },
  { id: 'proposals', label: 'Teklifler', icon: FileText },
  { id: 'clients', label: 'Müşteriler', icon: Users },
  { id: 'tasks', label: 'İşler & Hatırlatmalar', icon: ListChecks },
  { id: 'payments', label: 'Ödemeler', icon: CreditCard },
  { id: 'finance', label: 'KITE Finans', icon: Wallet },
  { id: 'personal', label: 'Berk (Kişisel)', icon: PiggyBank },
  { id: 'reports', label: 'Raporlar', icon: ChartColumn },
  { id: 'settings', label: 'Ayarlar & Otomasyon', icon: Settings },
  { id: 'agent', label: 'KITE Agent', icon: Bot },
];

export function isRouteId(value: string): value is RouteId {
  return navItems.some((item) => item.id === value);
}
