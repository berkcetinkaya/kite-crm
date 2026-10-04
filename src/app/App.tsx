import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { HomePage } from '../features/home/HomePage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { ProspectsPage } from '../features/prospects/ProspectsPage';
import { DiscoverPage } from '../features/discover/DiscoverPage';
import { CompaniesProvider } from '../state/companies/CompaniesProvider';
import { ResearchProvider } from '../state/research/ResearchProvider';
import { navItems, type RouteId } from './navigation';
import { useHashRoute } from './useHashRoute';

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case 'home':
      return <HomePage />;
    case 'discover':
      return <DiscoverPage />;
    case 'prospects':
      return <ProspectsPage />;
    default:
      return <PlaceholderPage title={navItems.find((item) => item.id === route)?.label ?? ''} />;
  }
}

export function App() {
  const route = useHashRoute();

  return (
    <ToastProvider>
      <CompaniesProvider>
        {/* Research state is separate; it only talks to CompaniesProvider when transferring results. */}
        <ResearchProvider>
          <AppShell route={route}>
            <Page route={route} />
          </AppShell>
        </ResearchProvider>
      </CompaniesProvider>
    </ToastProvider>
  );
}
