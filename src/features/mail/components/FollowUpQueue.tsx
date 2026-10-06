// Follow up queue (Phase 7): one compact card above the Mail & Takip grid. Groups come from the
// server (due state is never computed here); a row selects the company in the workspace below.
import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { FOLLOW_UP_QUEUE_GROUPS, FOLLOW_UP_QUEUE_LABELS, FOLLOW_UP_STATUS_LABELS, type FollowUpQueueGroup } from '../../../domain/followUp';
import { SERVICES } from '../../../domain/services';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { useFollowUps } from '../../../state/followUps/FollowUpsProvider';
import { FOLLOW_UP_TONE, nextFollowUpText, shortDate } from '../followUpView';

export function FollowUpQueue({ selectedId, onSelect }: { selectedId: string | null; onSelect: (companyId: string) => void }) {
  const { overview, loadError } = useFollowUps();
  const { companies } = useCompanies();
  const names = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const groups = useMemo(() => {
    const m = new Map<FollowUpQueueGroup, NonNullable<typeof overview>['sequences']>(FOLLOW_UP_QUEUE_GROUPS.map((g) => [g, []]));
    for (const s of overview?.sequences ?? []) m.get(s.queueGroup)!.push(s);
    return m;
  }, [overview]);
  const firstNonEmpty = FOLLOW_UP_QUEUE_GROUPS.find((g) => g !== 'finished' && groups.get(g)!.length > 0) ?? 'due';
  const [picked, setPicked] = useState<FollowUpQueueGroup | null>(null);
  const tab = picked ?? firstNonEmpty;
  const rows = groups.get(tab) ?? [];
  const now = overview ? new Date(overview.now) : new Date();

  if (!overview && !loadError) return null;

  return (
    <section className="card fu-queue" aria-labelledby="fu-queue-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="fu-queue-title" className="card__title">
            <CalendarClock size={16} aria-hidden="true" /> Takip Kuyruğu
          </h2>
          <p className="card__subtitle">
            {overview?.settings.enabled ? 'Takip zamanı gelenler senin onayını bekler; hiçbir takip otomatik gönderilmez.' : 'Takip sistemi kapalı. Ayarlar & Otomasyon’dan açabilirsin.'}
          </p>
        </div>
      </header>
      {loadError && (
        <p className="research-alert research-alert--error fu-queue__error" role="alert">
          Takipler yüklenemedi: {loadError}
        </p>
      )}
      <div className="fu-queue__tabs" role="tablist" aria-label="Takip grupları">
        {FOLLOW_UP_QUEUE_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={tab === g}
            className={tab === g ? `fu-queue__tab fu-queue__tab--active fu-queue__tab--${g}` : `fu-queue__tab fu-queue__tab--${g}`}
            onClick={() => setPicked(g)}
          >
            {FOLLOW_UP_QUEUE_LABELS[g]} <span className="fu-queue__count">{groups.get(g)!.length}</span>
          </button>
        ))}
      </div>
      <div className="fu-queue__body" role="tabpanel" aria-label={FOLLOW_UP_QUEUE_LABELS[tab]}>
        {rows.length === 0 ? (
          <p className="fu-queue__empty">Bu grupta takip yok.</p>
        ) : (
          <ul className="fu-queue__rows">
            {rows.map((s) => (
              <li key={s.id}>
                <button type="button" className={s.companyId === selectedId ? 'fu-row fu-row--active' : 'fu-row'} onClick={() => onSelect(s.companyId)} aria-current={s.companyId === selectedId ? 'true' : undefined}>
                  <span className="fu-row__company">{names.get(s.companyId) ?? 'Şirket'}</span>
                  <span className="fu-row__recipient">{s.recipientEmailSnapshot}</span>
                  <span className="fu-row__cell">
                    <span className="fu-row__label">Hizmet</span>
                    {SERVICES[s.service].label}
                  </span>
                  <span className="fu-row__cell">
                    <span className="fu-row__label">Son gönderim</span>
                    {shortDate(s.lastSentAt)}
                  </span>
                  <span className="fu-row__cell">
                    <span className="fu-row__label">Sonraki takip</span>
                    {nextFollowUpText(s, now)}
                  </span>
                  <span className="fu-row__cell">
                    <span className="fu-row__label">Yanıt</span>
                    {s.replied ? 'Yanıt geldi' : 'Yanıt yok'}
                  </span>
                  <Badge tone={FOLLOW_UP_TONE[s.effectiveStatus]}>{FOLLOW_UP_STATUS_LABELS[s.effectiveStatus]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
