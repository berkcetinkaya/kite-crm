// Manual task form (Phase 11): create or edit one small reminder. A due date is the reminder; KITE
// never sends notifications. Linking to a customer fills in its company.
import { useState } from 'react';
import { errorMessage } from '../../api/dataApi';
import { tasksApi } from '../../api/tasksApi';
import { useToast } from '../../components/ui/Toast';
import { CURRENT_USER, TEAM_MEMBERS } from '../../domain/company';
import { containsSecret, NO_SECRETS_WARNING } from '../../domain/customers';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_NOTES_MAX, TASK_TITLE_MAX, type Task, type TaskInput, type TaskStatus } from '../../domain/tasks';
import { fromDateInputValue, toDateInputValue } from '../../lib/date';
import { compareTr } from '../../lib/text';
import { useCompanies } from '../../state/companies/CompaniesProvider';
import { useCustomers } from '../../state/customers/CustomersProvider';

const pad = (n: number) => String(n).padStart(2, '0');
const toTimeValue = (iso: string | null) => (iso ? `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}` : '');

/** Local date ("YYYY-MM-DD") + optional time ("HH:mm") → ISO; date-only = local noon. */
function dueFrom(date: string, time: string): string | null {
  if (!date) return null;
  if (!time) return fromDateInputValue(date);
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export function TaskForm({ task, defaultCompanyId, onSaved, onCancel }: { task?: Task; defaultCompanyId?: string | null; onSaved: () => void; onCancel: () => void }) {
  const { companies, upsertCompanies } = useCompanies();
  const { customers } = useCustomers();
  const showToast = useToast();
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'normal');
  const [date, setDate] = useState(toDateInputValue(task?.dueAt ?? null));
  const [withTime, setWithTime] = useState(task?.dueHasTime ?? false);
  const [time, setTime] = useState(task?.dueHasTime ? toTimeValue(task.dueAt) : '');
  const [owner, setOwner] = useState<string>(task ? (task.owner ?? '') : CURRENT_USER);
  const [companyId, setCompanyId] = useState<string>(task?.companyId ?? defaultCompanyId ?? '');
  const [customerId, setCustomerId] = useState<string>(task?.customerId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const companyCustomers = customers.filter((c) => !companyId || c.companyId === companyId);
  const owners = [...new Set([...TEAM_MEMBERS, ...(task?.owner ? [task.owner] : [])])];

  const input = (): TaskInput | null => {
    if (!title.trim()) return (setError('Görev başlığını yaz.'), null);
    if (containsSecret(title) || containsSecret(notes)) return (setError(`Görevde şifre veya anahtar görünüyor. ${NO_SECRETS_WARNING}`), null);
    if (withTime && date && !time) return (setError('Saati seç ya da "Saat ekle" işaretini kaldır.'), null);
    const dueAt = dueFrom(date, withTime ? time : '');
    return { title: title.trim(), notes: notes.trim(), priority, dueAt, dueHasTime: !!dueAt && withTime, owner: owner || null, companyId: companyId || null, customerId: customerId || null };
  };

  const run = async (call: () => ReturnType<typeof tasksApi.create>, toast: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (r.company) upsertCompanies([r.company]);
      showToast({ title: toast, description: r.task.title });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const save = () => {
    const v = input();
    if (v) void run(() => (task ? tasksApi.update(task.id, v) : tasksApi.create(v)), task ? 'Görev güncellendi' : 'Görev eklendi');
  };
  const status = (to: TaskStatus) => void run(() => tasksApi.changeStatus(task!.id, to), `Görev: ${TASK_STATUS_LABELS[to]}`);

  return (
    <div className="sales-form task-form" aria-label={task ? 'Görevi düzenle' : 'Yeni görev'}>
      <label className="field">
        <span className="field__label">Görev</span>
        <input className="input" maxLength={TASK_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ör. Ece'ye case study gönder" autoFocus />
      </label>
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Son tarih</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="field">
          <label className="stage-move__check task-form__time">
            <input type="checkbox" checked={withTime} disabled={!date} onChange={(e) => setWithTime(e.target.checked)} />
            <span>Saat ekle</span>
          </label>
          {withTime && date && <input type="time" className="input" aria-label="Saat" value={time} onChange={(e) => setTime(e.target.value)} />}
        </div>
        <label className="field">
          <span className="field__label">Öncelik</span>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Sorumlu</span>
          <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Atanmadı</option>
            {owners.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Şirket (isteğe bağlı)</span>
          <select
            className="input"
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              if (customerId && !customers.some((c) => c.id === customerId && c.companyId === e.target.value)) setCustomerId('');
            }}
          >
            <option value="">Şirketsiz</option>
            {[...companies].sort((a, b) => compareTr(a.name, b.name)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Müşteri kaydı (isteğe bağlı)</span>
          <select
            className="input"
            value={customerId}
            disabled={companyCustomers.length === 0}
            onChange={(e) => {
              setCustomerId(e.target.value);
              const c = customers.find((x) => x.id === e.target.value);
              if (c) setCompanyId(c.companyId);
            }}
          >
            <option value="">Yok</option>
            {companyCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {companies.find((x) => x.id === c.companyId)?.name ?? 'Müşteri'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field__label">Not</span>
        <textarea className="input textarea" rows={3} maxLength={TASK_NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="sales-hint">{NO_SECRETS_WARNING} Son tarih KITE içinde hatırlatma olarak görünür; e-posta veya bildirim gönderilmez.</p>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button--primary button--sm" onClick={save} disabled={busy}>
          {task ? 'Kaydet' : 'Görev ekle'}
        </button>
        {task?.status === 'open' && (
          <>
            <button type="button" className="button button--secondary button--sm" onClick={() => status('done')} disabled={busy}>
              Tamamlandı
            </button>
            <button type="button" className="button button--ghost button--sm" onClick={() => window.confirm('Görev iptal edilsin mi?') && status('cancelled')} disabled={busy}>
              İptal et
            </button>
          </>
        )}
        {task && task.status !== 'open' && (
          <button type="button" className="button button--secondary button--sm" onClick={() => status('open')} disabled={busy}>
            Yeniden aç
          </button>
        )}
        <button type="button" className="button button--ghost button--sm" onClick={onCancel} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
