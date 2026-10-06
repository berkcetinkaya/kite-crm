// Ana Sayfa (Phase 10): the operational dashboard. Everything comes from the read-only
// /api/dashboard snapshot; nothing here is fabricated, stored, generated or sent. Rows link into the
// existing pages, or open the company drawer for company-level actions.
import { useState } from 'react';
import { CompanyDrawer } from '../prospects/detail/CompanyDrawer';
import { HomeHeader } from './sections/HomeHeader';
import { AttentionQueue } from './sections/AttentionQueue';
import { MomentumTable, SalesActivity, SalesOverview } from './sections/SalesSections';
import { CustomerOpsCard, FollowUpCard, MeetingsCard, ProposalStatusCard } from './sections/OperationsSections';
import { QuickResearch } from './sections/QuickResearch';
import { useDashboard } from './useDashboard';

export function HomePage() {
  const { data, loading, error, range, setRange, reload } = useDashboard();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const now = data ? new Date(data.now) : new Date();

  return (
    <div className="page home">
      <HomeHeader now={now} range={range} onRange={setRange} onRefresh={() => void reload()} loading={loading} />
      {error && (
        <p className="research-alert research-alert--error page-alert" role="alert">
          Özet yüklenemedi: {error}
        </p>
      )}
      {!data ? (
        !error && <p className="dash-loading" aria-busy="true">Özet hazırlanıyor…</p>
      ) : (
        <div className="home__grid" aria-busy={loading}>
          <div className="home__main">
            <AttentionQueue items={data.attention} onOpenCompany={setCompanyId} />
            <div className="dash-pair">
              <SalesOverview sales={data.sales} />
              <ProposalStatusCard dashboard={data} />
            </div>
            <CustomerOpsCard customers={data.customers} />
            <SalesActivity dashboard={data} />
            <MomentumTable rows={data.momentum} onOpenCompany={setCompanyId} />
          </div>
          <aside className="home__side" aria-label="Görüşmeler, takip ve hızlı araştırma">
            <MeetingsCard meetings={data.meetings} onOpenCompany={setCompanyId} />
            <FollowUpCard followUps={data.followUps} />
            <QuickResearch />
          </aside>
        </div>
      )}
      <CompanyDrawer
        companyId={companyId}
        onClose={() => {
          setCompanyId(null);
          void reload(); // actions in the drawer may change the snapshot
        }}
      />
    </div>
  );
}
