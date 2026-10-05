import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { HomePage } from '../features/home/HomePage';
import { PlaceholderPage } from '../features/placeholder/PlaceholderPage';
import { ProspectsPage } from '../features/prospects/ProspectsPage';
import { DiscoverPage } from '../features/discover/DiscoverPage';
import { lazy, Suspense } from 'react';
import { MailDraftsProvider } from '../state/mail/MailDraftsProvider';
import { CompaniesProvider } from '../state/companies/CompaniesProvider';
import { ResearchProvider } from '../state/research/ResearchProvider';
import { navItems, type RouteId } from './navigation';
import { useHashRoute } from './useHashRoute';

// Mail & Takip carries the sector intelligence data; it loads when the page is first opened.
const MailPage = lazy(() => import('../features/mail/MailPage').then((m) => ({ default: m.MailPage })));

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case 'home':
      return <HomePage />;
    case 'discover':
      return <DiscoverPage />;
    case 'prospects':
      return <ProspectsPage />;
    case 'outreach':
      return (
        <Suspense fallback={<div className="page" aria-busy="true" />}>
          <MailPage />
        </Suspense>
      );
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
          {/* Mail drafts read companies and research results; they never change a company. */}
          <MailDraftsProvider>
            <AppShell route={route}>
              <Page route={route} />
            </AppShell>
          </MailDraftsProvider>
        </ResearchProvider>
      </CompaniesProvider>
    </ToastProvider>
  );
}
