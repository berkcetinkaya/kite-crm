// Teklifler tab of the company drawer (Phase 8): the company's proposals and a new one.
import { useState } from 'react';
import { FilePlus, FileText } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import type { Company } from '../../domain/company';
import { PROPOSAL_STATUS_LABELS } from '../../domain/sales';
import { formatShortDate } from '../../lib/date';
import { useSales } from '../../state/sales/SalesProvider';
import { ProposalDetail } from './ProposalDetail';
import { ProposalEditor } from './ProposalEditor';
import { PROPOSAL_TONE, totalsLabel } from './salesView';

export function ProposalsSection({ company }: { company: Company }) {
  const { proposalsFor } = useSales();
  const showToast = useToast();
  const proposals = proposalsFor(company.id);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="detail-section">
      <div className="sales-toolbar">
        <p className="sales-hint">Teklifler KITE'tan gönderilmez; durumlarını sen işaretlersin.</p>
        {!creating && (
          <button type="button" className="button button--primary button--sm" onClick={() => setCreating(true)}>
            <FilePlus size={14} aria-hidden="true" /> Yeni Teklif
          </button>
        )}
      </div>
      {creating && (
        <ProposalEditor
          company={company}
          onSaved={(p) => {
            setCreating(false);
            setOpenId(p.id);
            showToast({ title: 'Teklif oluşturuldu', description: `${p.title} · Taslak` });
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {proposals.length === 0 && !creating ? (
        <EmptyState icon={FileText} title="Henüz teklif yok" description="Görüşmeden sonra bu şirket için bir teklif hazırla." />
      ) : (
        <ul className="sales-list">
          {proposals.map((p) => (
            <li key={p.id} className="sales-card">
              {openId === p.id ? (
                <>
                  <ProposalDetail company={company} proposal={p} />
                  <button type="button" className="link-button" onClick={() => setOpenId(null)}>
                    Kapat
                  </button>
                </>
              ) : (
                <button type="button" className="sales-row" onClick={() => setOpenId(p.id)}>
                  <span className="sales-row__main">
                    <span className="sales-card__title">{p.title}</span>
                    <span className="sales-card__meta">
                      {totalsLabel(p)}
                      {p.sentAt ? ` · gönderim ${formatShortDate(new Date(p.sentAt))}` : ''}
                    </span>
                  </span>
                  <Badge tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
