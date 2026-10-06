// One customer (Phase 9): status actions, details, services, onboarding checklist, access tracking and
// the company's single history timeline. Every change is an explicit action confirmed by the server.
import { useState } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import type { CustomerResult, CustomersApi } from '../../api/customersApi';
import { Badge } from '../../components/ui/Badge';
import { Tabs, type TabItem } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { TEAM_MEMBERS, type Company } from '../../domain/company';
import {
  ACCESS_KIND_LABELS,
  ACCESS_KINDS,
  ACCESS_STATUS_LABELS,
  ACCESS_STATUSES,
  containsSecret,
  CUSTOMER_SERVICE_STATUS_LABELS,
  CUSTOMER_SERVICE_STATUSES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TRANSITIONS,
  customerBlockers,
  NO_SECRETS_WARNING,
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_STATUSES,
  onboardingProgress,
  serviceDisplayName,
  suggestedOnboarding,
  type AccessKind,
  type AccessRequirement,
  type Customer,
  type CustomerService,
  type CustomerServiceInput,
  type CustomerStatus,
  type OnboardingItem,
} from '../../domain/customers';
import { BILLING_TYPE_LABELS, BILLING_TYPES, CURRENCIES, formatMoney, minorToInput, parseAmountToMinor, PROPOSAL_STATUS_LABELS, type BillingType, type Currency } from '../../domain/sales';
import type { SalesStatus } from '../../domain/salesStatus';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../domain/services';
import { formatShortDate, fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { useSales } from '../../state/sales/SalesProvider';
import { HistorySection } from '../prospects/detail/HistorySection';
import { StageMoveChoice } from '../sales/salesView';
import { ACCESS_TONE, CUSTOMER_TONE, NoSecretsNotice, ONBOARDING_TONE, ProgressBar, SERVICE_TONE } from './customersView';

type SectionId = 'overview' | 'services' | 'onboarding' | 'access' | 'history';

const ACTION_LABELS: Record<CustomerStatus, (from: CustomerStatus) => string> = {
  onboarding: (from) => (from === 'lost' ? "Onboarding'e geri al" : "Onboarding'e dön"),
  active: (from) => (from === 'onboarding' ? "Onboarding'i tamamla" : from === 'on_hold' ? 'Devam ettir (Aktif)' : 'Yeniden aktifleştir'),
  on_hold: () => 'Beklemeye al',
  completed: () => 'Tamamlandı olarak kapat',
  lost: () => 'Kaybedildi',
};

const fmtDate = (iso: string | null) => (iso ? formatShortDate(new Date(iso)) : '—');

/** Runs a customer action, shows the server's Turkish error and a toast on success. */
function useAction() {
  const { run } = useCustomers();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (call: (api: CustomersApi) => Promise<CustomerResult>, toast?: string) => {
    setBusy(true);
    setError(null);
    try {
      const c = await run(call);
      if (toast) showToast({ title: toast });
      setBusy(false);
      return c;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return null;
    }
  };
  return { busy, error, setError, act };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="research-alert research-alert--error" role="alert">
      {error}
    </p>
  ) : null;
}

export function CustomerDetail({ customer, company, onOpenCompany }: { customer: Customer; company: Company; onOpenCompany: () => void }) {
  const [section, setSection] = useState<SectionId>('overview');
  const progress = onboardingProgress(customer.onboarding);
  const blockers = customerBlockers(customer, new Date().toISOString());
  const tabs: TabItem<SectionId>[] = [
    { id: 'overview', label: 'Genel Bakış' },
    { id: 'services', label: 'Hizmetler', count: customer.services.length },
    { id: 'onboarding', label: 'Onboarding', count: customer.onboarding.length },
    { id: 'access', label: 'Erişimler', count: customer.access.length },
    { id: 'history', label: 'Geçmiş', count: company.history.length },
  ];

  return (
    <article className="customer-detail" aria-label={`Müşteri: ${company.name}`}>
      <header className="customer-detail__head">
        <div>
          <h2 className="customer-detail__name">{company.name}</h2>
          <p className="sales-hint">
            Başlangıç {fmtDate(customer.startDate)}
            {customer.endDate && ` · bitiş ${fmtDate(customer.endDate)}`}
            {customer.onboardingCompletedAt && ` · onboarding tamamlandı ${fmtDate(customer.onboardingCompletedAt)}`}
          </p>
        </div>
        <Badge tone={CUSTOMER_TONE[customer.status]}>{CUSTOMER_STATUS_LABELS[customer.status]}</Badge>
      </header>
      <div className="customer-detail__facts">
        <OwnerSelect customer={customer} company={company} />
        <span className="customer-detail__fact">
          <span className="field__label">Onboarding</span>
          <ProgressBar done={progress.done} total={progress.total} />
        </span>
        <button type="button" className="button button--ghost button--sm" onClick={onOpenCompany}>
          <ExternalLink size={14} aria-hidden="true" /> Şirket kartı (görüşmeler, teklifler, notlar)
        </button>
      </div>
      {blockers.length > 0 && (
        <ul className="customer-blockers" aria-label="Engeller">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <StatusActions customer={customer} company={company} openItems={progress.open} />
      <Tabs
        items={tabs}
        active={section}
        onChange={setSection}
        label="Müşteri detayı"
        renderPanel={(id) => {
          switch (id) {
            case 'overview':
              return <Overview customer={customer} company={company} />;
            case 'services':
              return <Services customer={customer} />;
            case 'onboarding':
              return <Onboarding customer={customer} />;
            case 'access':
              return <Access customer={customer} />;
            case 'history':
              return <HistorySection company={company} />;
          }
        }}
      />
    </article>
  );
}

/** Responsible person = the company owner (one source of truth, normal company history). */
function OwnerSelect({ customer, company }: { customer: Customer; company: Company }) {
  const { busy, error, act } = useAction();
  const details = { startDate: customer.startDate, endDate: customer.endDate, primaryContactId: customer.primaryContactId, commercialNotes: customer.commercialNotes, operationalNotes: customer.operationalNotes };
  return (
    <label className="customer-detail__fact">
      <span className="field__label">Sorumlu</span>
      <select className="input" value={company.owner ?? ''} disabled={busy} onChange={(e) => void act((api) => api.update(customer.id, details, e.target.value || null), 'Sorumlu güncellendi')}>
        <option value="">Atanmadı</option>
        {[...new Set([...TEAM_MEMBERS, ...(company.owner ? [company.owner] : [])])].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <ErrorLine error={error} />
    </label>
  );
}

function StatusActions({ customer, company, openItems }: { customer: Customer; company: Company; openItems: number }) {
  const [to, setTo] = useState<CustomerStatus | null>(null);
  if (to) return <StatusForm customer={customer} company={company} to={to} openItems={openItems} onDone={() => setTo(null)} />;
  return (
    <div className="sales-card__actions">
      {CUSTOMER_TRANSITIONS[customer.status].map((s) => (
        <button key={s} type="button" className={s === 'active' && customer.status === 'onboarding' ? 'button button--primary button--sm' : 'button button--secondary button--sm'} onClick={() => setTo(s)}>
          {ACTION_LABELS[s](customer.status)}
        </button>
      ))}
    </div>
  );
}

function StatusForm({ customer, company, to, openItems, onDone }: { customer: Customer; company: Company; to: CustomerStatus; openItems: number; onDone: () => void }) {
  const { busy, error, act } = useAction();
  const completing = customer.status === 'onboarding' && to === 'active';
  const closing = to === 'completed' || to === 'lost';
  const [confirm, setConfirm] = useState(false);
  const [date, setDate] = useState(toDateInputValue(new Date().toISOString()));
  const [move, setMove] = useState<SalesStatus | null>(null);
  const needsConfirm = completing && openItems > 0;

  const submit = async () => {
    const r = await act(
      (api) => api.changeStatus(customer.id, { to, ...(needsConfirm ? { confirmOpenItems: confirm } : {}), ...(closing ? { date: fromDateInputValue(date) } : {}), moveCompanyTo: move }),
      completing ? 'Onboarding tamamlandı; müşteri Aktif' : `Müşteri: ${CUSTOMER_STATUS_LABELS[to]}`,
    );
    if (r) onDone();
  };

  return (
    <div className="sales-form sales-form--inline" role="alertdialog" aria-label={`Müşteri durumu: ${CUSTOMER_STATUS_LABELS[to]}`}>
      <p className="sales-card__title">
        {CUSTOMER_STATUS_LABELS[customer.status]} → {CUSTOMER_STATUS_LABELS[to]}
      </p>
      {needsConfirm && (
        <label className="stage-move__check">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>
            {openItems} açık onboarding adımı var. Yine de onboarding'i tamamla ve müşteriyi Aktif yap.
          </span>
        </label>
      )}
      {closing && (
        <label className="field">
          <span className="field__label">Bitiş tarihi</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      {to === 'lost' && <StageMoveChoice company={company} suggested="lost" value={move} onChange={setMove} choose />}
      {closing && <p className="sales-hint">Hizmetlerin durumu değişmez; gerekirse her hizmeti ayrıca kapat.</p>}
      <ErrorLine error={error} />
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={() => void submit()} disabled={busy || (needsConfirm && !confirm)}>
          Onayla
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onDone} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ---------- Overview: details, notes, accepted proposal ----------

function Overview({ customer, company }: { customer: Customer; company: Company }) {
  const { proposalsFor } = useSales();
  const { busy, error, setError, act } = useAction();
  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(toDateInputValue(customer.startDate));
  const [endDate, setEndDate] = useState(toDateInputValue(customer.endDate));
  const [contactId, setContactId] = useState(customer.primaryContactId ?? '');
  const [commercial, setCommercial] = useState(customer.commercialNotes);
  const [operational, setOperational] = useState(customer.operationalNotes);
  const source = customer.sourceProposalId ? proposalsFor(company.id).find((p) => p.id === customer.sourceProposalId) : undefined;
  const contactKnown = company.contacts.some((c) => c.id === customer.primaryContactId);

  const save = async () => {
    const start = fromDateInputValue(startDate);
    if (!start) return setError('Başlangıç tarihini seç.');
    if (containsSecret(commercial) || containsSecret(operational)) return setError(`Notlarda şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`);
    const r = await act((api) => api.update(customer.id, { startDate: start, endDate: fromDateInputValue(endDate), primaryContactId: contactId || null, commercialNotes: commercial, operationalNotes: operational }), 'Müşteri bilgileri kaydedildi');
    if (r) setEditing(false);
  };

  if (editing)
    return (
      <div className="sales-form">
        <div className="sales-form__grid">
          <label className="field">
            <span className="field__label">Başlangıç tarihi</span>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Bitiş tarihi</span>
            <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Ana iletişim kişisi</span>
          <select className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Seçilmedi</option>
            {!contactKnown && customer.primaryContactId && <option value={customer.primaryContactId}>{customer.primaryContactName ?? 'Önceki kişi'}</option>}
            {company.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
                {c.email ? ` · ${c.email}` : ''}
              </option>
            ))}
          </select>
        </label>
        <NoSecretsNotice />
        <label className="field">
          <span className="field__label">Ticari notlar</span>
          <textarea className="input textarea" rows={3} maxLength={4000} value={commercial} onChange={(e) => setCommercial(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Operasyon notları</span>
          <textarea className="input textarea" rows={3} maxLength={4000} value={operational} onChange={(e) => setOperational(e.target.value)} />
        </label>
        <ErrorLine error={error} />
        <div className="form-actions">
          <button type="button" className="button button--primary button--sm" onClick={() => void save()} disabled={busy}>
            Kaydet
          </button>
          <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(false)} disabled={busy}>
            Vazgeç
          </button>
        </div>
      </div>
    );

  return (
    <div className="customer-overview">
      <dl className="proposal-totals">
        <div>
          <dt>Başlangıç</dt>
          <dd>{fmtDate(customer.startDate)}</dd>
        </div>
        <div>
          <dt>Bitiş</dt>
          <dd>{fmtDate(customer.endDate)}</dd>
        </div>
        <div>
          <dt>Ana kişi</dt>
          <dd>
            {customer.primaryContactName ?? '—'}
            {customer.primaryContactEmail && <span className="sales-hint"> · {customer.primaryContactEmail}</span>}
          </dd>
        </div>
        <div>
          <dt>Kabul edilen teklif</dt>
          <dd>{source ? `${source.title} · ${PROPOSAL_STATUS_LABELS[source.status]}` : customer.sourceProposalId ? 'Teklif bulunamadı' : 'Teklifsiz'}</dd>
        </div>
      </dl>
      <h3 className="customer-section-title">Ticari notlar</h3>
      <p className="sales-card__text">{customer.commercialNotes || <span className="text-subtle">Not yok</span>}</p>
      <h3 className="customer-section-title">Operasyon notları</h3>
      <p className="sales-card__text">{customer.operationalNotes || <span className="text-subtle">Not yok</span>}</p>
      <div className="sales-card__actions">
        <button type="button" className="button button--secondary button--sm" onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" /> Bilgileri düzenle
        </button>
      </div>
    </div>
  );
}

// ---------- Services ----------

const emptyService = (): CustomerServiceInput => ({ service: 'meta_ads', label: '', billingType: null, amountMinor: null, currency: null, sourceProposalId: null, sourceItemId: null, notes: '', startDate: null, endDate: null });
const toInput = ({ service, label, billingType, amountMinor, currency, sourceProposalId, sourceItemId, notes, startDate, endDate }: CustomerService): CustomerServiceInput => ({
  service,
  label,
  billingType,
  amountMinor,
  currency,
  sourceProposalId,
  sourceItemId,
  notes,
  startDate,
  endDate,
});

function Services({ customer }: { customer: Customer }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <div className="customer-panel">
      <p className="sales-hint">Tutarlar yalnızca referanstır; KITE fatura veya ödeme takibi yapmaz. Aynı hizmetten birden fazla (farklı kapsamla) olabilir.</p>
      <ul className="sales-list">
        {customer.services.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <ServiceForm customerId={customer.id} service={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id}>
              <ServiceRow service={s} onEdit={() => setEditing(s.id)} />
            </li>
          ),
        )}
      </ul>
      {customer.services.length === 0 && <p className="sales-hint">Henüz hizmet yok.</p>}
      {editing === 'new' ? (
        <ServiceForm customerId={customer.id} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="button button--secondary button--sm" onClick={() => setEditing('new')}>
          <Plus size={14} aria-hidden="true" /> Hizmet ekle
        </button>
      )}
    </div>
  );
}

function ServiceRow({ service: s, onEdit }: { service: CustomerService; onEdit: () => void }) {
  const { busy, error, act } = useAction();
  return (
    <div className="sales-card">
      <header className="sales-card__head">
        <p className="sales-card__title">{serviceDisplayName(s)}</p>
        <Badge tone={SERVICE_TONE[s.status]}>{CUSTOMER_SERVICE_STATUS_LABELS[s.status]}</Badge>
      </header>
      <p className="sales-card__meta">
        {s.startDate ? `Başlangıç ${fmtDate(s.startDate)}` : 'Başlamadı'}
        {s.endDate && ` · bitiş ${fmtDate(s.endDate)}`}
        {s.amountMinor !== null && s.currency && ` · ${formatMoney(s.amountMinor, s.currency)}${s.billingType ? ` ${BILLING_TYPE_LABELS[s.billingType].toLowerCase()}` : ''} (referans)`}
        {s.sourceItemId && ' · tekliften'}
      </p>
      {s.notes && <p className="sales-card__text">{s.notes}</p>}
      <div className="sales-card__actions">
        <label className="customer-inline-select">
          <span className="visually-hidden">Hizmet durumu</span>
          <select
            className="input"
            value={s.status}
            disabled={busy}
            onChange={(e) => void act((api) => api.serviceStatus(s.id, e.target.value as CustomerService['status']), `${serviceDisplayName(s)}: ${CUSTOMER_SERVICE_STATUS_LABELS[e.target.value as CustomerService['status']]}`)}
          >
            {CUSTOMER_SERVICE_STATUSES.map((st) => (
              <option key={st} value={st}>
                {CUSTOMER_SERVICE_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button--ghost button--sm" onClick={onEdit}>
          <Pencil size={14} aria-hidden="true" /> Düzenle
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function ServiceForm({ customerId, service, onDone }: { customerId: string; service?: CustomerService; onDone: () => void }) {
  const { busy, error, setError, act } = useAction();
  const [v, setV] = useState<CustomerServiceInput>(service ? toInput(service) : emptyService());
  const [amount, setAmount] = useState(v.amountMinor !== null ? minorToInput(v.amountMinor) : '');
  const [start, setStart] = useState(toDateInputValue(v.startDate));
  const [end, setEnd] = useState(toDateInputValue(v.endDate));
  const patch = (p: Partial<CustomerServiceInput>) => setV((x) => ({ ...x, ...p }));

  const save = async () => {
    const amountMinor = amount.trim() ? parseAmountToMinor(amount) : null;
    if (amount.trim() && amountMinor === null) return setError('Tutar geçersiz (ör. 25.000 veya 25000,50).');
    if (containsSecret(v.notes) || containsSecret(v.label)) return setError(`Notlarda şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`);
    const input: CustomerServiceInput = { ...v, label: v.label.trim(), notes: v.notes.trim(), amountMinor, currency: amountMinor !== null ? (v.currency ?? 'TRY') : v.currency, startDate: fromDateInputValue(start), endDate: fromDateInputValue(end) };
    const r = await act((api) => (service ? api.updateService(service.id, input) : api.addService(customerId, input)), service ? 'Hizmet güncellendi' : 'Hizmet eklendi');
    if (r) onDone();
  };

  return (
    <div className="sales-form sales-form--inline" aria-label={service ? 'Hizmeti düzenle' : 'Yeni hizmet'}>
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Hizmet</span>
          <select className="input" value={v.service} onChange={(e) => patch({ service: e.target.value as ServiceKey })}>
            {SERVICE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SERVICES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Kapsam (isteğe bağlı)</span>
          <input className="input" maxLength={120} value={v.label} placeholder="ör. Türkiye, Gulf" onChange={(e) => patch({ label: e.target.value })} />
        </label>
        <label className="field">
          <span className="field__label">Ücret tipi</span>
          <select className="input" value={v.billingType ?? ''} onChange={(e) => patch({ billingType: (e.target.value || null) as BillingType | null })}>
            <option value="">—</option>
            {BILLING_TYPES.map((b) => (
              <option key={b} value={b}>
                {BILLING_TYPE_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Tutar (referans)</span>
          <span className="customer-amount">
            <input className="input" inputMode="decimal" value={amount} placeholder="25.000" onChange={(e) => setAmount(e.target.value)} />
            <select className="input" aria-label="Para birimi" value={v.currency ?? 'TRY'} onChange={(e) => patch({ currency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="field">
          <span className="field__label">Başlangıç</span>
          <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Bitiş</span>
          <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Notlar</span>
        <textarea className="input textarea" rows={2} maxLength={2000} value={v.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </label>
      {!service && <p className="sales-hint">Yeni hizmet “Hazırlanıyor” olarak eklenir; aktifleştirmeyi sen yaparsın.</p>}
      <ErrorLine error={error} />
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={() => void save()} disabled={busy}>
          Kaydet
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onDone} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ---------- Onboarding checklist ----------

function Onboarding({ customer }: { customer: Customer }) {
  const { busy, error, act } = useAction();
  const [label, setLabel] = useState('');
  const progress = onboardingProgress(customer.onboarding);
  const present = new Set(customer.onboarding.map((i) => i.templateKey).filter(Boolean));
  const missing = suggestedOnboarding(customer.services.map((s) => s.service)).filter((t) => !present.has(t.key));

  return (
    <div className="customer-panel">
      <p className="customer-progress-line">
        <ProgressBar done={progress.done} total={progress.total} /> <span className="sales-hint">“Gerekli Değil” adımlar ilerlemeye sayılmaz.</span>
      </p>
      <ol className="onb-list">
        {customer.onboarding.map((i) => (
          <OnboardingRow key={i.id} item={i} />
        ))}
      </ol>
      {customer.onboarding.length === 0 && <p className="sales-hint">Henüz onboarding adımı yok.</p>}
      <div className="start-onb__add">
        <input className="input" aria-label="Yeni onboarding adımı" placeholder="Yeni adım" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button
          type="button"
          className="button button--secondary button--sm"
          disabled={busy || !label.trim()}
          onClick={async () => {
            if (await act((api) => api.addOnboarding(customer.id, [{ label: label.trim(), templateKey: null, dueDate: null, notes: '' }]), 'Adım eklendi')) setLabel('');
          }}
        >
          <Plus size={14} aria-hidden="true" /> Ekle
        </button>
        {missing.length > 0 && (
          <button type="button" className="button button--ghost button--sm" disabled={busy} onClick={() => void act((api) => api.addOnboarding(customer.id, missing.map((t) => ({ label: t.label, templateKey: t.key, dueDate: null, notes: '' }))), `${missing.length} önerilen adım eklendi`)}>
            Önerilen {missing.length} adımı ekle
          </button>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function OnboardingRow({ item }: { item: OnboardingItem }) {
  const { busy, error, setError, act } = useAction();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [due, setDue] = useState(toDateInputValue(item.dueDate));
  const [notes, setNotes] = useState(item.notes);
  const overdue = (item.status === 'pending' || item.status === 'in_progress') && item.dueDate && item.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);

  if (editing)
    return (
      <li className="onb-item onb-item--editing">
        <div className="sales-form__grid">
          <label className="field">
            <span className="field__label">Adım</span>
            <input className="input" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Son tarih</span>
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">Not</span>
          <textarea className="input textarea" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <ErrorLine error={error} />
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={busy || !label.trim()}
            onClick={async () => {
              if (containsSecret(notes) || containsSecret(label)) return setError(`Notlarda şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`);
              if (await act((api) => api.updateOnboarding(item.id, { label: label.trim(), notes: notes.trim(), dueDate: fromDateInputValue(due) }))) setEditing(false);
            }}
          >
            Kaydet
          </button>
          <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(false)} disabled={busy}>
            Vazgeç
          </button>
        </div>
      </li>
    );

  return (
    <li className={`onb-item onb-item--${item.status}`}>
      <span className="onb-item__main">
        <span className="onb-item__label">{item.label}</span>
        <span className="sales-card__meta">
          {item.dueDate && <span className={overdue ? 'onb-overdue' : undefined}>Son tarih {fmtDate(item.dueDate)}{overdue ? ' · gecikti' : ''}</span>}
          {item.completedAt && ` Tamamlandı ${fmtDate(item.completedAt)}`}
        </span>
        {item.notes && <span className="sales-card__text">{item.notes}</span>}
      </span>
      <Badge tone={ONBOARDING_TONE[item.status]}>{ONBOARDING_STATUS_LABELS[item.status]}</Badge>
      <span className="onb-item__actions">
        <label>
          <span className="visually-hidden">{item.label} durumu</span>
          <select className="input" value={item.status} disabled={busy} onChange={(e) => void act((api) => api.onboardingStatus(item.id, e.target.value as OnboardingItem['status']))}>
            {ONBOARDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ONBOARDING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button--ghost button--sm" aria-label={`${item.label} düzenle`} onClick={() => setEditing(true)}>
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button type="button" className="button button--ghost button--sm" aria-label={`${item.label} sil`} disabled={busy} onClick={() => window.confirm(`“${item.label}” adımı silinsin mi?`) && void act((api) => api.deleteOnboarding(item.id))}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </span>
      <ErrorLine error={error} />
    </li>
  );
}

// ---------- Access requirements ----------

function Access({ customer }: { customer: Customer }) {
  const { busy, error, setError, act } = useAction();
  const [kind, setKind] = useState<AccessKind>('meta_business');
  const [label, setLabel] = useState('');
  return (
    <div className="customer-panel">
      <NoSecretsNotice />
      <ul className="sales-list">
        {customer.access.map((a) => (
          <li key={a.id}>
            <AccessRow access={a} />
          </li>
        ))}
      </ul>
      {customer.access.length === 0 && <p className="sales-hint">Henüz erişim gereksinimi yok.</p>}
      <div className="start-onb__add">
        <select className="input" aria-label="Erişim türü" value={kind} onChange={(e) => setKind(e.target.value as AccessKind)}>
          {ACCESS_KINDS.map((k) => (
            <option key={k} value={k}>
              {ACCESS_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input className="input" aria-label="Erişim adı (isteğe bağlı)" placeholder="Ad (isteğe bağlı), ör. Meta BM — Lyxa" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button
          type="button"
          className="button button--secondary button--sm"
          disabled={busy}
          onClick={async () => {
            if (containsSecret(label)) return setError(NO_SECRETS_WARNING);
            if (await act((api) => api.addAccess(customer.id, [{ kind, label: label.trim(), notes: '' }]), 'Erişim gereksinimi eklendi')) setLabel('');
          }}
        >
          <Plus size={14} aria-hidden="true" /> Ekle
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function AccessRow({ access: a }: { access: AccessRequirement }) {
  const { busy, error, setError, act } = useAction();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(a.label);
  const [notes, setNotes] = useState(a.notes);
  return (
    <div className="sales-card">
      <header className="sales-card__head">
        <p className="sales-card__title">{a.label}</p>
        <Badge tone={ACCESS_TONE[a.status]}>{ACCESS_STATUS_LABELS[a.status]}</Badge>
      </header>
      <p className="sales-card__meta">
        {ACCESS_KIND_LABELS[a.kind]}
        {a.requestedAt && ` · istendi ${fmtDate(a.requestedAt)}`}
        {a.receivedAt && ` · alındı ${fmtDate(a.receivedAt)}`}
      </p>
      {editing ? (
        <div className="sales-form sales-form--inline">
          <label className="field">
            <span className="field__label">Ad</span>
            <input className="input" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Not (kimin eklendiği, hangi hesap vb.)</span>
            <textarea className="input textarea" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ör. berk@kitegrowth.com yönetici olarak eklendi" />
          </label>
          <p className="sales-hint sales-hint--warn">{NO_SECRETS_WARNING}</p>
          <ErrorLine error={error} />
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={busy}
              onClick={async () => {
                if (containsSecret(label) || containsSecret(notes)) return setError(`Notlarda şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`);
                if (await act((api) => api.updateAccess(a.id, { label: label.trim(), notes: notes.trim() }))) setEditing(false);
              }}
            >
              Kaydet
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(false)} disabled={busy}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <>
          {a.notes && <p className="sales-card__text">{a.notes}</p>}
          <div className="sales-card__actions">
            <label className="customer-inline-select">
              <span className="visually-hidden">{a.label} durumu</span>
              <select className="input" value={a.status} disabled={busy} onChange={(e) => void act((api) => api.accessStatus(a.id, e.target.value as AccessRequirement['status']), `${a.label}: ${ACCESS_STATUS_LABELS[e.target.value as AccessRequirement['status']]}`)}>
                {ACCESS_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ACCESS_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden="true" /> Düzenle
            </button>
            <button type="button" className="button button--ghost button--sm" aria-label={`${a.label} sil`} disabled={busy} onClick={() => window.confirm(`“${a.label}” silinsin mi?`) && void act((api) => api.deleteAccess(a.id))}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
          <ErrorLine error={error} />
        </>
      )}
    </div>
  );
}
