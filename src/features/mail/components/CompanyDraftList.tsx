import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import type { Company } from '../../../domain/company';
import { MAIL_DRAFT_STATUS_LABELS, type MailDraft, type MailDraftStatus } from '../../../domain/mail/draft';
import { compareTr, foldForSearch } from '../../../lib/text';
import { useOutreach } from '../../../state/outreach/OutreachProvider';
import { useFollowUps } from '../../../state/followUps/FollowUpsProvider';
import { FOLLOW_UP_QUEUE_LABELS } from '../../../domain/followUp';
import { companySectorLabel } from '../../prospects/query';
import type { PreparationOverviewItem } from '../../../domain/outreachPrep';
import { READINESS_LABELS } from '../../../domain/outreachReadiness';
import { READINESS_TONE } from './PreparationPanel';

/** Readiness filters (Phase 13): the four readiness groups plus the outreach progress views. */
export const READINESS_FILTERS = ['all', 'ready', 'missing', 'review', 'blocked', 'draft_approved', 'sent', 'replied'] as const;
export type ReadinessFilter = (typeof READINESS_FILTERS)[number];
export const READINESS_FILTER_LABELS: Record<ReadinessFilter, string> = {
  all: 'Tümü',
  ready: 'Hazır',
  missing: 'Eksik Bilgi',
  review: 'İnceleme Gerekli',
  blocked: 'Uygun Değil',
  draft_approved: 'Taslak Hazır',
  sent: 'İlk Temas Gönderildi',
  replied: 'Yanıt Geldi',
};

export function matchesReadiness(item: PreparationOverviewItem | undefined, f: ReadinessFilter): boolean {
  if (f === 'all') return true;
  if (!item) return false;
  if (f === 'draft_approved' || f === 'sent' || f === 'replied') return item.readiness.progress === f;
  return item.readiness.state === f;
}

export const DRAFT_TONE: Record<MailDraftStatus, BadgeTone> = { review: 'warning', draft: 'info', approved: 'success' };

interface Props {
  companies: readonly Company[];
  drafts: readonly MailDraft[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Phase 13 readiness per company (absent while loading). */
  readiness: ReadonlyMap<string, PreparationOverviewItem>;
}

/** Left column: companies with drafts first (newest first), then the other prospects. */
export function CompanyDraftList({ companies, drafts, selectedId, onSelect, readiness }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReadinessFilter>('all');
  const byCompany = useMemo(() => new Map(drafts.map((d) => [d.companyId, d])), [drafts]);
  const { sends, messages } = useOutreach();
  const { sequenceFor } = useFollowUps();

  const rows = useMemo(() => {
    const q = foldForSearch(query.trim());
    const matches = companies.filter((c) => (!q || foldForSearch(`${c.name} ${companySectorLabel(c)} ${c.city}`).includes(q)) && matchesReadiness(readiness.get(c.id), filter));
    const withDraft = matches.filter((c) => byCompany.has(c.id)).sort((a, b) => byCompany.get(b.id)!.updatedAt.localeCompare(byCompany.get(a.id)!.updatedAt));
    const without = matches.filter((c) => !byCompany.has(c.id)).sort((a, b) => compareTr(a.name, b.name));
    return { withDraft, without };
  }, [companies, byCompany, query, readiness, filter]);
  const count = (f: ReadinessFilter) => companies.filter((c) => matchesReadiness(readiness.get(c.id), f)).length;

  const item = (c: Company) => {
    const d = byCompany.get(c.id);
    return (
      <li key={c.id}>
        <button
          type="button"
          className={c.id === selectedId ? 'mail-list__item mail-list__item--active' : 'mail-list__item'}
          aria-current={c.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(c.id)}
        >
          <span className="mail-list__name">{c.name}</span>
          <span className="mail-list__meta">{[companySectorLabel(c), c.city].filter(Boolean).join(' · ')}</span>
          {d ? <Badge tone={DRAFT_TONE[d.status]}>{MAIL_DRAFT_STATUS_LABELS[d.status]}</Badge> : <span className="mail-list__none">Taslak yok</span>}
          <OutreachBadge companyId={c.id} sends={sends} replied={messages.some((m) => m.companyId === c.id && m.direction === 'inbound')} />
          {(() => {
            const r = readiness.get(c.id);
            return r ? <span className={`mail-list__readiness mail-list__readiness--${READINESS_TONE[r.readiness.state]}`}>{READINESS_LABELS[r.readiness.state]}</span> : null;
          })()}
          {(() => {
            const seq = sequenceFor(c.id);
            if (!seq || seq.queueGroup === 'finished' || seq.queueGroup === 'upcoming') return null;
            return <span className={`mail-list__followup mail-list__followup--${seq.queueGroup}`}>{FOLLOW_UP_QUEUE_LABELS[seq.queueGroup]}</span>;
          })()}
        </button>
      </li>
    );
  };

  return (
    <section className="card mail-list" aria-labelledby="mail-list-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="mail-list-title" className="card__title">
            Şirketler ve Taslaklar
          </h2>
          <p className="card__subtitle">{drafts.length} taslak · {companies.length} şirket</p>
        </div>
      </header>
      <div className="mail-list__search">
        <Search size={14} aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Şirket, sektör veya şehir ara"
          aria-label="Şirket ara"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="chip-row mail-list__filters" role="group" aria-label="Hazırlık durumu">
        {READINESS_FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setFilter(f)}>
            {READINESS_FILTER_LABELS[f]}
            {f !== 'all' && readiness.size > 0 && <span className="filter-chip__count">{count(f)}</span>}
          </button>
        ))}
      </div>
      <div className="mail-list__scroll">
        {rows.withDraft.length > 0 && (
          <>
            <p className="mail-list__group">Taslaklar</p>
            <ul className="mail-list__items">{rows.withDraft.map(item)}</ul>
          </>
        )}
        <p className="mail-list__group">Potansiyel Müşteriler</p>
        {rows.without.length ? <ul className="mail-list__items">{rows.without.map(item)}</ul> : <p className="mail-list__empty">Eşleşen şirket yok.</p>}
      </div>
    </section>
  );
}

/** Gmail state of the company's first contact mail, next to the draft status. */
function OutreachBadge({ companyId, sends, replied }: { companyId: string; sends: ReturnType<typeof useOutreach>['sends']; replied: boolean }) {
  const latest = sends.find((s) => s.companyId === companyId && s.status !== 'failed');
  if (replied) return <span className="mail-list__outreach mail-list__outreach--replied">Yanıt geldi</span>;
  if (!latest) return null;
  const label = latest.status === 'sent' ? 'Gönderildi' : latest.status === 'ambiguous' ? 'Kontrol gerekiyor' : 'Gönderiliyor';
  return <span className={`mail-list__outreach mail-list__outreach--${latest.status}`}>{label}</span>;
}
