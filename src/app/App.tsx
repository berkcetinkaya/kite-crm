import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { HomePage } from '../features/home/HomePage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { navItems } from './navigation';
import { useHashRoute } from './useHashRoute';

export function App() {
  const route = useHashRoute();
  const label = navItems.find((item) => item.id === route)?.label ?? '';

  return (
    <ToastProvider>
      <AppShell route={route}>{route === 'home' ? <HomePage /> : <PlaceholderPage title={label} />}</AppShell>
    </ToastProvider>
  );
}
