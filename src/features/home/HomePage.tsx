import { useState } from 'react';
import { HomeHeader } from './sections/HomeHeader';
import { DailyMetrics } from './sections/DailyMetrics';
import { TodayActions } from './sections/TodayActions';
import { SalesFunnelSummary } from './sections/SalesFunnelSummary';
import { ActivityTabs } from './sections/ActivityTabs';
import { QuickResearch } from './sections/QuickResearch';
import { MiniCalendar } from './sidebar/MiniCalendar';
import { TodayMeetings } from './sidebar/TodayMeetings';
import { KiteFinanceCard, PersonalFinanceCard } from './sidebar/FinanceSummaries';
import { getMockActions } from '../../data/mock/actions';
import { mockDailyMetrics, mockFunnel } from '../../data/mock/metrics';
import { activityTabs, mockActivity } from '../../data/mock/activity';
import { getMockMeetings } from '../../data/mock/calendar';
import { mockKiteFinance, mockPersonalFinance } from '../../data/mock/finance';

// Ana Sayfa answers "Bugün ne yapmalıyım?": actions first, then opportunities, sales, meetings, money.
export function HomePage() {
  const [now] = useState(() => new Date());
  const [actions] = useState(() => getMockActions(now));
  const [meetings] = useState(() => getMockMeetings(now));

  return (
    <div className="page home">
      <HomeHeader now={now} />
      <div className="home__grid">
        <div className="home__main">
          <DailyMetrics metrics={mockDailyMetrics} />
          <TodayActions initialItems={actions} now={now} />
          <ActivityTabs tabs={activityTabs} rows={mockActivity} />
          <SalesFunnelSummary stages={mockFunnel} />
          <QuickResearch />
        </div>
        <aside className="home__side" aria-label="Takvim ve finans özeti">
          <MiniCalendar now={now} meetings={meetings} />
          <TodayMeetings now={now} meetings={meetings} />
          <KiteFinanceCard data={mockKiteFinance} />
          <PersonalFinanceCard data={mockPersonalFinance} />
        </aside>
      </div>
    </div>
  );
}
