// One proposal (Phase 8): read-only summary, edit (Taslak / Hazır only) and explicit, reversible
// status actions. A suggested company stage is offered as an unticked checkbox; nothing is emailed.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../api/dataApi';
import type { Company } from '../../domain/company';
import {
  BILLING_TYPE_LABELS,
  formatMoney,
  isEditableProposal,
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_TRANSITIONS,
  proposalTotals,
  SUGGESTED_STAGE,
  TAX_MODE_LABELS,
  type Proposal,
  type ProposalStatus,
} from '../../domain/sales';
import type { SalesStatus } from '../../domain/salesStatus';
import { SERVICES } from '../../domain/services';
import { formatShortDate, fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useSales } from '../../state/sales/SalesProvider';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { customerHref, startOnboardingHref } from '../customers/customersView';
import { ProposalEditor } from './ProposalEditor';
import { PROPOSAL_TONE, StageMoveChoice } from './salesView';

const ACTION_LABELS: Record<ProposalStatus, (from: ProposalStatus) => string> = {
  draft: (from) => (from === 'ready' ? 'Taslağa Geri Al' : 'Taslağa Geri Al (revize)'),
  ready: () => 'Gönderilmeye Hazır',
  sent: (from) => (from === 'ready' ? 'Gönderildi Olarak İşaretle' : 'Kararı Geri Al'),
  accepted: () => 'Kabul Edildi',
  rejected: () => 'Reddedildi',
  expired: () => 'Süresi Doldu',
};

export function ProposalDetail({ company, proposal }: { company: Company; proposal: Proposal }) {
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<ProposalStatus | null>(null);
  const totals = proposalTotals(proposal.items);
  const expiredHint = proposal.status === 'sent' && proposal.validUntil && proposal.validUntil < new Date().toISOString();

  if (editing) return <ProposalEditor company={company} proposal={proposal} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  return (
    <article className="proposal-detail" aria-label={`Teklif: ${proposal.title}`}>
      <header className="sales-card__head">
        <p className="sales-card__title">{proposal.title}</p>
        <Badge tone={PROPOSAL_TONE[proposal.status]}>{PROPOSAL_STATUS_LABELS[proposal.status]}</Badge>
      </header>
      <table className="proposal-lines">
        <thead>
          <tr>
            <th scope="col">Hizmet</th>
            <th scope="col">Açıklama</th>
            <th scope="col">Tip</th>
            <th scope="col" className="num">
              Tutar
            </th>
          </tr>
        </thead>
        <tbody>
          {proposal.items.map((i) => (
            <tr key={i.id}>
              <td>{SERVICES[i.service].label}</td>
              <td>{i.description || '—'}</td>
              <td>{BILLING_TYPE_LABELS[i.billingType]}</td>
              <td className="num">
                {formatMoney(i.unitAmountMinor * i.quantity, proposal.currency)}
                {i.quantity > 1 && <span className="sales-hint"> ({i.quantity} × {formatMoney(i.unitAmountMinor, proposal.currency)})</span>}
              </td>
            </tr>
          ))}
          {proposal.items.length === 0 && (
            <tr>
              <td colSpan={4} className="sales-hint">
                Henüz kalem yok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <dl className="proposal-totals">
        <div>
          <dt>Tek seferlik</dt>
          <dd>{formatMoney(totals.oneTimeMinor, proposal.currency)}</dd>
        </div>
        <div>
          <dt>Aylık</dt>
          <dd>{formatMoney(totals.monthlyMinor, proposal.currency)}</dd>
        </div>
        <div>
          <dt>Vergi</dt>
          <dd>
            {TAX_MODE_LABELS[proposal.taxMode]}
            {proposal.taxRateBp !== null && proposal.taxMode !== 'unspecified' ? ` (%${(proposal.taxRateBp / 100).toLocaleString('tr-TR')})` : ''}
          </dd>
        </div>
        <div>
          <dt>Sözleşme</dt>
          <dd>{proposal.contractMonths ? `${proposal.contractMonths} ay` : '—'}</dd>
        </div>
        <div>
          <dt>Geçerlilik</dt>
          <dd>{proposal.validUntil ? formatShortDate(new Date(proposal.validUntil)) : '—'}</dd>
        </div>
        <div>
          <dt>Gönderim</dt>
          <dd>{proposal.sentAt ? formatShortDate(new Date(proposal.sentAt)) : '—'}</dd>
        </div>
        {proposal.decidedAt && (
          <div>
            <dt>Karar</dt>
            <dd>{formatShortDate(new Date(proposal.decidedAt))}</dd>
          </div>
        )}
      </dl>
      {proposal.lossReason && (
        <p className="sales-card__text">
          <strong>Ret nedeni:</strong> {proposal.lossReason}
        </p>
      )}
      {proposal.notes && <p className="sales-card__text">{proposal.notes}</p>}
      {expiredHint && <p className="sales-hint sales-hint--warn">Geçerlilik tarihi geçti. Gerekirse “Süresi Doldu” olarak işaretle; KITE bunu kendiliğinden yapmaz.</p>}

      {action ? (
        <TransitionForm company={company} proposal={proposal} to={action} onDone={() => setAction(null)} />
      ) : (
        <div className="sales-card__actions">
          {isEditableProposal(proposal.status) && (
            <button type="button" className="button button--secondary button--sm" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" /> Düzenle
            </button>
          )}
          {PROPOSAL_TRANSITIONS[proposal.status].map((to) => (
            <button key={to} type="button" className={to === 'draft' ? 'button button--ghost button--sm' : 'button button--secondary button--sm'} onClick={() => setAction(to)}>
              {ACTION_LABELS[to](proposal.status)}
            </button>
          ))}
        </div>
      )}
      {proposal.status === 'accepted' && !action && <CustomerLink company={company} proposal={proposal} />}
      <p className="sales-hint">Teklif KITE'tan gönderilmez; gönderdikten sonra burada “Gönderildi” olarak işaretle.</p>
    </article>
  );
}

/** Accepted proposal → explicit onboarding start (never automatic), or the existing customer. */
function CustomerLink({ company, proposal }: { company: Company; proposal: Proposal }) {
  const { customerFor } = useCustomers();
  const customer = customerFor(company.id);
  return customer ? (
    <a className="button button--secondary button--sm proposal-customer-link" href={customerHref(customer.id)}>
      Müşteri sayfasında aç
    </a>
  ) : (
    <a className="button button--primary button--sm proposal-customer-link" href={startOnboardingHref(company.id, proposal.id)}>
      Müşteri onboarding'ini başlat
    </a>
  );
}

function TransitionForm({ company, proposal, to, onDone }: { company: Company; proposal: Proposal; to: ProposalStatus; onDone: () => void }) {
  const { transitionProposal } = useSales();
  const showToast = useToast();
  const [date, setDate] = useState(toDateInputValue(new Date().toISOString()));
  const [reason, setReason] = useState('');
  const [move, setMove] = useState<SalesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstSend = to === 'sent' && proposal.status === 'ready';
  const needsDate = firstSend || to === 'accepted' || to === 'rejected';
  const suggested = SUGGESTED_STAGE[to];

  const submit = async () => {
    if (to === 'rejected' && !reason.trim()) return setError('Ret veya kayıp nedenini yaz.');
    setBusy(true);
    setError(null);
    try {
      const at = needsDate ? fromDateInputValue(date) : null;
      await transitionProposal(proposal.id, {
        to,
        ...(firstSend ? { sentAt: at } : {}),
        ...(to === 'accepted' || to === 'rejected' ? { decidedAt: at } : {}),
        ...(to === 'rejected' ? { lossReason: reason.trim() } : {}),
        moveCompanyTo: move,
      });
      showToast({ title: `Teklif: ${PROPOSAL_STATUS_LABELS[to]}`, description: proposal.title });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <div className="sales-form sales-form--inline" role="alertdialog" aria-label={`Teklif durumu: ${PROPOSAL_STATUS_LABELS[to]}`}>
      <p className="sales-card__title">
        {PROPOSAL_STATUS_LABELS[proposal.status]} → {PROPOSAL_STATUS_LABELS[to]}
      </p>
      {needsDate && (
        <label className="field">
          <span className="field__label">{firstSend ? 'Gönderim tarihi' : 'Karar tarihi'}</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      {to === 'rejected' && (
        <label className="field">
          <span className="field__label">Ret / kayıp nedeni</span>
          <textarea className="input textarea" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Bütçe bu yıl için uygun değil" />
        </label>
      )}
      {to === 'draft' && proposal.status !== 'ready' && <p className="sales-hint">Teklif revize için taslağa döner; önceki gönderim ve karar bilgisi temizlenir (geçmişte kayıtlı kalır).</p>}
      {suggested ? (
        <StageMoveChoice company={company} suggested={suggested} value={move} onChange={setMove} choose={to === 'rejected'} />
      ) : (
        (to === 'sent' || to === 'expired') && <StageMoveChoice company={company} suggested={to === 'sent' ? 'awaiting_decision' : company.status} value={move} onChange={setMove} choose />
      )}
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={() => void submit()} disabled={busy}>
          Onayla
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onDone} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
