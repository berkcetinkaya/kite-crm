import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import type { Company } from '../../../domain/company';
import { MAIL_DRAFT_STATUS_LABELS, type MailDraft, type MailDraftStatus } from '../../../domain/mail/draft';
import { compareTr, foldForSearch } from '../../../lib/text';
import { companySectorLabel } from '../../prospects/query';

export const DRAFT_TONE: Record<MailDraftStatus, BadgeTone> = { review: 'warning', draft: 'info', approved: 'success' };

interface Props {
  companies: readonly Company[];
  drafts: readonly MailDraft[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Left column: companies with drafts first (newest first), then the other prospects. */
export function CompanyDraftList({ companies, drafts, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const byCompany = useMemo(() => new Map(drafts.map((d) => [d.companyId, d])), [drafts]);

  const rows = useMemo(() => {
    const q = foldForSearch(query.trim());
    const matches = companies.filter((c) => !q || foldForSearch(`${c.name} ${companySectorLabel(c)} ${c.city}`).includes(q));
    const withDraft = matches.filter((c) => byCompany.has(c.id)).sort((a, b) => byCompany.get(b.id)!.updatedAt.localeCompare(byCompany.get(a.id)!.updatedAt));
    const without = matches.filter((c) => !byCompany.has(c.id)).sort((a, b) => compareTr(a.name, b.name));
    return { withDraft, without };
  }, [companies, byCompany, query]);

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
