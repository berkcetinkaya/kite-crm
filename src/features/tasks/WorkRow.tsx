// One İşler row (Phase 11). Inline actions only where the owning record allows it, always through
// its own endpoint: manual tasks (/api/tasks), company next action (company details), onboarding and
// access status (Phase 9 endpoints). Meetings, follow-ups and proposals only open their pages.
import { useState } from 'react';
import { Check, ChevronRight, Pencil, X } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import { tasksApi } from '../../api/tasksApi';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { ACCESS_STATUS_LABELS, ACCESS_STATUSES, ONBOARDING_STATUS_LABELS, ONBOARDING_STATUSES, type AccessStatus, type OnboardingStatus } from '../../domain/customers';
import { SEVERITY_LABELS } from '../../domain/dashboard';
import { TASK_PRIORITY_LABELS } from '../../domain/tasks';
import { WORK_SOURCE_LABELS, type WorkItem } from '../../domain/work';
import { formatShortDate, formatTime, fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useCustomers } from '../../state/customers/CustomersProvider';
import { linkHref } from '../home/dashboardView';

const TONE: Record<1 | 2 | 3, BadgeTone> = { 1: 'danger', 2: 'warning', 3: 'neutral' };

/** "3 gün gecikti", "bugün 14:00", "24 Eki (3 gün sonra)", "5 gündür bekleniyor", "Tarihsiz". */
export function dueLabel(w: WorkItem): string {
  const time = w.dueAt && w.dueHasTime ? ` ${formatTime(new Date(w.dueAt))}` : '';
  if (w.kind === 'meeting_no_outcome') return w.ageDays ? `${w.ageDays} gün önce` : 'bugün';
  if (w.kind === 'proposal_waiting') return `${w.ageDays ?? 0} gündür bekliyor`;
  switch (w.bucket) {
    case 'overdue':
      return w.ageDays ? `${w.ageDays} gün gecikti` : 'gecikti';
    case 'today':
      return `bugün${time}`;
    case 'upcoming':
    case 'later':
      return `${formatShortDate(new Date(w.dueAt!))}${time}`;
    case 'undated':
      if (w.kind === 'access_problem') return w.ageDays ? `${w.ageDays} gündür` : 'bugün';
      if (w.kind === 'access_requested') return w.ageDays ? `${w.ageDays} gündür bekleniyor` : 'bugün istendi';
      return 'Tarihsiz';
  }
}

interface WorkRowProps {
  item: WorkItem;
  onOpenCompany: (companyId: string) => void;
  onEditTask: (taskId: string) => void;
  onChanged: () => void;
}

export function WorkRow({ item: w, onOpenCompany, onEditTask, onChanged }: WorkRowProps) {
  const { updateDetails, upsertCompanies } = useCompanies();
  const { run } = useCustomers();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNext, setEditingNext] = useState(false);
  const has = (t: WorkItem['actions'][number]['type']) => w.actions.some((a) => a.type === t);

  const act = async (call: () => Promise<unknown>, toast: string) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      showToast({ title: toast, description: w.companyName ?? w.title });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  const href = w.link.type === 'task' ? null : linkHref(w.link);
  const open = () => (w.link.type === 'task' ? onEditTask(w.link.taskId) : w.link.type === 'company' ? onOpenCompany(w.link.companyId) : undefined);

  return (
    <li className={`work-row work-row--${w.bucket}${w.severity === 1 ? ' work-row--critical' : ''}`}>
      <div className="work-row__head">
        <span className={`source-chip source-chip--${w.group}`}>{WORK_SOURCE_LABELS[w.source]}</span>
        {w.severity !== null && <Badge tone={TONE[w.severity]}>{SEVERITY_LABELS[w.severity]}</Badge>}
        {w.priority === 'high' && <Badge tone="danger">{TASK_PRIORITY_LABELS.high}</Badge>}
        <span className={w.bucket === 'overdue' || w.severity === 1 ? 'work-row__due work-row__due--late' : 'work-row__due'}>{dueLabel(w)}</span>
      </div>
      <div className="work-row__body">
        <div className="work-row__main">
          <p className="work-row__title">{w.title}</p>
          <p className="work-row__meta">
            {w.companyId && w.companyName ? (
              <button type="button" className="link-cell" onClick={() => onOpenCompany(w.companyId!)}>
                {w.companyName}
              </button>
            ) : (
              <span className="text-subtle">Şirketsiz</span>
            )}
            {w.description && w.description !== w.title && <span> · {w.description}</span>}
            {w.owner && <span className="work-row__owner"> · {w.owner}</span>}
          </p>
        </div>
        <div className="work-row__actions">
          {w.source === 'task' && w.ref.taskId && (
            <>
              <button type="button" className="button button--secondary button--sm" disabled={busy} onClick={() => void act(async () => upsert(await tasksApi.changeStatus(w.ref.taskId!, 'done')), 'Görev tamamlandı')}>
                <Check size={14} aria-hidden="true" /> Tamamla
              </button>
              <button type="button" className="button button--ghost button--sm" aria-label={`${w.title} düzenle`} onClick={() => onEditTask(w.ref.taskId!)}>
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button type="button" className="button button--ghost button--sm" aria-label={`${w.title} iptal et`} disabled={busy} onClick={() => window.confirm('Görev iptal edilsin mi?') && void act(() => tasksApi.changeStatus(w.ref.taskId!, 'cancelled'), 'Görev iptal edildi')}>
                <X size={14} aria-hidden="true" />
              </button>
            </>
          )}
          {has('next_action_clear') && w.companyId && (
            <button type="button" className="button button--secondary button--sm" disabled={busy} onClick={() => window.confirm(`“${w.title}” tamamlandı olarak işaretlensin ve sonraki adım temizlensin mi?`) && void act(() => updateDetails(w.companyId!, { nextAction: null }), 'Sonraki adım tamamlandı')}>
              <Check size={14} aria-hidden="true" /> Tamamlandı
            </button>
          )}
          {(has('next_action_edit') || has('next_action_set')) && w.companyId && (
            <button type="button" className="button button--ghost button--sm" onClick={() => setEditingNext((v) => !v)}>
              {has('next_action_set') ? 'Sonraki adım belirle' : 'Değiştir / ertele'}
            </button>
          )}
          {has('onboarding_status') && w.ref.onboardingItemId && (
            <label>
              <span className="visually-hidden">{w.title} durumu</span>
              <select className="input input--sm" value={w.ref.status} disabled={busy} onChange={(e) => void act(() => run((api) => api.onboardingStatus(w.ref.onboardingItemId!, e.target.value as OnboardingStatus)), `${w.title}: ${ONBOARDING_STATUS_LABELS[e.target.value as OnboardingStatus]}`)}>
                {ONBOARDING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ONBOARDING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has('access_status') && w.ref.accessId && (
            <label>
              <span className="visually-hidden">{w.title} durumu</span>
              <select className="input input--sm" value={w.ref.status} disabled={busy} onChange={(e) => void act(() => run((api) => api.accessStatus(w.ref.accessId!, e.target.value as AccessStatus)), `${w.title}: ${ACCESS_STATUS_LABELS[e.target.value as AccessStatus]}`)}>
                {ACCESS_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ACCESS_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {href ? (
            <a className="button button--ghost button--sm" href={href} aria-label={`${w.title}: aç`}>
              Aç <ChevronRight size={14} aria-hidden="true" />
            </a>
          ) : (
            w.link.type !== 'task' && (
              <button type="button" className="button button--ghost button--sm" onClick={open} aria-label={`${w.title}: aç`}>
                Aç <ChevronRight size={14} aria-hidden="true" />
              </button>
            )
          )}
        </div>
      </div>
      {editingNext && w.companyId && <NextActionForm item={w} onDone={() => setEditingNext(false)} onSaved={onChanged} />}
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
    </li>
  );

  function upsert(r: Awaited<ReturnType<typeof tasksApi.changeStatus>>) {
    if (r.company) upsertCompanies([r.company]);
  }
}

/** Replace / postpone the company's single next action (same endpoint and history as the drawer). */
function NextActionForm({ item, onDone, onSaved }: { item: WorkItem; onDone: () => void; onSaved: () => void }) {
  const { companies, updateDetails } = useCompanies();
  const company = companies.find((c) => c.id === item.companyId);
  const [label, setLabel] = useState(company?.nextAction?.label ?? '');
  const [date, setDate] = useState(toDateInputValue(company?.nextAction?.dueAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!label.trim()) return setError('Sonraki adımı yaz.');
    setBusy(true);
    try {
      const current = company?.nextAction?.dueAt ?? null;
      const dueAt = current && toDateInputValue(current) === date ? current : fromDateInputValue(date);
      await updateDetails(item.companyId!, { nextAction: { label: label.trim(), dueAt } });
      onDone();
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="sales-form sales-form--inline work-row__form">
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Sonraki adım</span>
          <input className="input" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Tarih</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
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
