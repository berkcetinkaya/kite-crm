import { AppShell } from '../components/layout/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { HomePage } from '../features/home/HomePage';
import { ProspectsPage } from '../features/prospects/ProspectsPage';
import { DiscoverPage } from '../features/discover/DiscoverPage';
import { lazy, Suspense } from 'react';
import { MailDraftsProvider } from '../state/mail/MailDraftsProvider';
import { CompaniesProvider } from '../state/companies/CompaniesProvider';
import { ResearchProvider } from '../state/research/ResearchProvider';
import { OutreachProvider } from '../state/outreach/OutreachProvider';
import { FollowUpsProvider } from '../state/followUps/FollowUpsProvider';
import { SalesProvider } from '../state/sales/SalesProvider';
import { CustomersProvider } from '../state/customers/CustomersProvider';
import { CustomersPage } from '../features/customers/CustomersPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { KiteFinancePage } from '../features/finance/KiteFinancePage';
import { PersonalFinancePage } from '../features/finance/PersonalFinancePage';
import { PipelinePage } from '../features/pipeline/PipelinePage';
import { ProposalsPage } from '../features/proposals/ProposalsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import type { RouteId } from './navigation';
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
    case 'settings':
      return <SettingsPage />;
    case 'pipeline':
      return <PipelinePage />;
    case 'proposals':
      return <ProposalsPage />;
    case 'clients':
      return <CustomersPage />;
    case 'tasks':
      return <TasksPage />;
    case 'finance':
      return <KiteFinancePage />;
    case 'personal':
      return <PersonalFinancePage />;
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
            {/* Gmail connection and sent mail history (Phase 6); updates companies after a send or reply. */}
            <OutreachProvider>
              {/* Follow up plans (Phase 7): server-decided due state; never generates or sends on its own. */}
              <FollowUpsProvider>
                {/* Meetings and proposals (Phase 8): manual sales process; never sends or moves stages on its own. */}
                <SalesProvider>
                  {/* Customers (Phase 9): onboarding, services, access tracking; every change is explicit. */}
                  <CustomersProvider>
                    <AppShell route={route}>
                      <Page route={route} />
                    </AppShell>
                  </CustomersProvider>
                </SalesProvider>
              </FollowUpsProvider>
            </OutreachProvider>
          </MailDraftsProvider>
        </ResearchProvider>
      </CompaniesProvider>
    </ToastProvider>
  );
}
