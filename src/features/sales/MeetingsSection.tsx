// Görüşmeler (Phase 8): lightweight meeting records for one company. Planning or completing a
// meeting never changes the sales stage unless Berk ticks the explicit stage choice.
import { useState, type FormEvent } from 'react';
import { CalendarCheck, CalendarPlus, Check, Pencil, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../api/dataApi';
import { isGeneralContact, type Company } from '../../domain/company';
import { MEETING_STATUS_LABELS, MEETING_TYPE_LABELS, MEETING_TYPES, type Meeting, type MeetingInput, type MeetingType } from '../../domain/sales';
import type { SalesStatus } from '../../domain/salesStatus';
import { formatDateTime, formatShortDate, fromDateInputValue, toDateInputValue } from '../../lib/date';
import { useSales } from '../../state/sales/SalesProvider';
import { fromDateTimeInputValue, MEETING_TONE, StageMoveChoice, toDateTimeInputValue } from './salesView';

interface Form {
  when: string;
  type: MeetingType;
  contactId: string;
  notes: string;
}

const emptyForm = (): Form => ({ when: toDateTimeInputValue(new Date(Date.now() + 86_400_000).toISOString()).replace(/T\d\d:\d\d$/, 'T10:00'), type: 'online', contactId: '', notes: '' });
const fromMeeting = (m: Meeting): Form => ({ when: toDateTimeInputValue(m.scheduledAt), type: m.type, contactId: m.contactId ?? '', notes: m.notes });

export function MeetingsSection({ company }: { company: Company }) {
  const { meetingsFor, createMeeting, updateMeeting, cancelMeeting } = useSales();
  const showToast = useToast();
  const meetings = meetingsFor(company.id);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [move, setMove] = useState<SalesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = company.contacts.filter((c) => !isGeneralContact(c));
  const before = (s: SalesStatus) => ['found', 'researched', 'first_contact', 'replied'].includes(s);

  const run = async (fn: () => Promise<unknown>, toast: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      showToast({ title: toast, description: company.name });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const scheduledAt = fromDateTimeInputValue(form.when);
    if (!scheduledAt) return setError('Görüşme tarih ve saatini seç.');
    const current = editing && editing !== 'new' ? meetings.find((m) => m.id === editing) : undefined;
    const input: MeetingInput = {
      scheduledAt,
      type: form.type,
      contactId: form.contactId || null,
      notes: form.notes.trim(),
      outcome: current?.outcome ?? '',
      nextActionLabel: current?.nextActionLabel ?? null,
      nextActionDueAt: current?.nextActionDueAt ?? null,
    };
    const ok = await run(() => (current ? updateMeeting(current.id, input) : createMeeting(company.id, input, move)), current ? 'Görüşme güncellendi' : 'Görüşme eklendi');
    if (ok) {
      setEditing(null);
      setMove(null);
    }
  };

  const open = (target: 'new' | Meeting) => {
    setError(null);
    setCompleting(null);
    setMove(null);
    setForm(target === 'new' ? emptyForm() : fromMeeting(target));
    setEditing(target === 'new' ? 'new' : target.id);
  };

  return (
    <div className="detail-section">
      <div className="sales-toolbar">
        <p className="sales-hint">Görüşme kaydı şirketin satış aşamasını kendiliğinden değiştirmez.</p>
        {editing === null && (
          <button type="button" className="button button--primary button--sm" onClick={() => open('new')}>
            <CalendarPlus size={14} aria-hidden="true" /> Görüşme Ekle
          </button>
        )}
      </div>

      {editing !== null && (
        <form className="sales-form" onSubmit={(e) => void onSubmit(e)} aria-label={editing === 'new' ? 'Yeni görüşme' : 'Görüşmeyi düzenle'}>
          <div className="sales-form__grid">
            <label className="field">
              <span className="field__label">Tarih ve saat</span>
              <input type="datetime-local" className="input" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} required />
            </label>
            <label className="field">
              <span className="field__label">Görüşme türü</span>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MeetingType })}>
                {MEETING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MEETING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Kişi</span>
              <select className="input" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}>
                <option value="">Belirtilmedi</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.role ? ` · ${p.role}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Notlar</span>
            <textarea className="input textarea" rows={3} value={form.notes} maxLength={4000} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Gündem, katılanlar…" />
          </label>
          {editing === 'new' && before(company.status) && <StageMoveChoice company={company} suggested="meeting" value={move} onChange={setMove} />}
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {editing === 'new' ? 'Görüşmeyi Kaydet' : 'Değişiklikleri Kaydet'}
            </button>
            <button type="button" className="button button--ghost" onClick={() => setEditing(null)} disabled={busy}>
              Vazgeç
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}

      {meetings.length === 0 && editing === null ? (
        <EmptyState icon={CalendarCheck} title="Henüz görüşme yok" description="Yanıt veren şirketle yaptığın veya planladığın görüşmeleri buraya ekle." />
      ) : (
        <ul className="sales-list">
          {meetings.map((m) => (
            <li key={m.id} className="sales-card">
              <div className="sales-card__head">
                <p className="sales-card__title">
                  {formatDateTime(new Date(m.scheduledAt))} · {MEETING_TYPE_LABELS[m.type]}
                </p>
                <Badge tone={MEETING_TONE[m.status]}>{MEETING_STATUS_LABELS[m.status]}</Badge>
              </div>
              {m.contactName && <p className="sales-card__meta">Kişi: {m.contactName}{m.contactEmail ? ` <${m.contactEmail}>` : ''}</p>}
              {m.notes && <p className="sales-card__text">{m.notes}</p>}
              {m.status === 'completed' && (
                <p className="sales-card__text">
                  <strong>Sonuç:</strong> {m.outcome || '—'}
                </p>
              )}
              {m.nextActionLabel && (
                <p className="sales-card__meta">
                  Sonraki adım: {m.nextActionLabel}
                  {m.nextActionDueAt ? ` · ${formatShortDate(new Date(m.nextActionDueAt))}` : ''}
                </p>
              )}
              {completing === m.id ? (
                <CompleteForm company={company} meeting={m} onDone={() => setCompleting(null)} />
              ) : (
                m.status !== 'cancelled' && (
                  <div className="sales-card__actions">
                    {m.status === 'planned' && (
                      <button type="button" className="button button--secondary button--sm" onClick={() => { setEditing(null); setCompleting(m.id); }} disabled={busy}>
                        <Check size={14} aria-hidden="true" /> Tamamlandı
                      </button>
                    )}
                    <button type="button" className="button button--ghost button--sm" onClick={() => open(m)} disabled={busy}>
                      <Pencil size={14} aria-hidden="true" /> Düzenle
                    </button>
                    {m.status === 'planned' && (
                      <button type="button" className="button button--ghost button--sm" onClick={() => void run(() => cancelMeeting(m.id), 'Görüşme iptal edildi')} disabled={busy}>
                        <X size={14} aria-hidden="true" /> İptal Et
                      </button>
                    )}
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompleteForm({ company, meeting, onDone }: { company: Company; meeting: Meeting; onDone: () => void }) {
  const { completeMeeting } = useSales();
  const showToast = useToast();
  const [outcome, setOutcome] = useState(meeting.outcome);
  const [notes, setNotes] = useState(meeting.notes);
  const [nextLabel, setNextLabel] = useState(meeting.nextActionLabel ?? '');
  const [nextDue, setNextDue] = useState(toDateInputValue(meeting.nextActionDueAt));
  const [setCompanyNext, setSetCompanyNext] = useState(true);
  const [move, setMove] = useState<SalesStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (nextDue && !nextLabel.trim()) return setError('Tarih için bir sonraki adım da yaz.');
    setBusy(true);
    setError(null);
    try {
      await completeMeeting(meeting.id, {
        outcome: outcome.trim(),
        notes: notes.trim(),
        nextActionLabel: nextLabel.trim() || null,
        nextActionDueAt: fromDateInputValue(nextDue),
        setCompanyNextAction: setCompanyNext && !!nextLabel.trim(),
        moveCompanyTo: move,
      });
      showToast({ title: 'Görüşme tamamlandı', description: company.name });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <form className="sales-form sales-form--inline" onSubmit={(e) => void onSubmit(e)} aria-label="Görüşmeyi tamamla">
      <label className="field">
        <span className="field__label">Sonuç</span>
        <textarea className="input textarea" rows={2} value={outcome} maxLength={4000} onChange={(e) => setOutcome(e.target.value)} placeholder="ör. Website ve reklam için teklif istediler." />
      </label>
      <label className="field">
        <span className="field__label">Notlar</span>
        <textarea className="input textarea" rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="sales-form__grid">
        <label className="field">
          <span className="field__label">Sonraki adım</span>
          <input className="input" value={nextLabel} maxLength={200} onChange={(e) => setNextLabel(e.target.value)} placeholder="ör. Teklif hazırla" />
        </label>
        <label className="field">
          <span className="field__label">Tarih</span>
          <input type="date" className="input" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
        </label>
      </div>
      {nextLabel.trim() && (
        <label className="stage-move__check">
          <input type="checkbox" checked={setCompanyNext} onChange={(e) => setSetCompanyNext(e.target.checked)} />
          <span>Şirketin “Sonraki Adım” alanına da kaydet</span>
        </label>
      )}
      <StageMoveChoice company={company} suggested="proposal" value={move} onChange={setMove} />
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button button--primary button--sm" disabled={busy}>
          Görüşmeyi Tamamla
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={onDone} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}
