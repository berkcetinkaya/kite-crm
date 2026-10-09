// "Harici temas kaydet" (Phase 14): records a sales interaction that happened outside KITE (WhatsApp,
// phone, in person). One history entry; it counts as meaningful activity for the sales intelligence
// and never changes the stage, the next action or any other record.
import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { errorMessage } from '../../api/dataApi';
import { useToast } from '../../components/ui/Toast';
import { dayKey } from '../../domain/businessDay';
import type { Company } from '../../domain/company';
import { EXTERNAL_CONTACT_CHANNELS, EXTERNAL_CONTACT_LABELS, MAX_EXTERNAL_NOTE, type ExternalContactChannel } from '../../domain/externalContact';
import { formatDateTime, formatTime } from '../../lib/date';
import { useCompanies } from '../../state/companies/CompaniesProvider';

/** "bugün 14:20", "dün 09:05", or the full date. */
export function contactTimeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const k = dayKey(iso);
  return k === today ? `bugün ${formatTime(d)}` : k === yesterday ? `dün ${formatTime(d)}` : formatDateTime(d);
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ExternalContactForm({ company }: { company: Company }) {
  const { recordExternalContact } = useCompanies();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ExternalContactChannel>('whatsapp');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  // Left at its default, the time is "now" to the second (the server stamps it), not the minute shown.
  const [whenEdited, setWhenEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setChannel('whatsapp');
    setNote('');
    setWhen(localInput(new Date()));
    setWhenEdited(false);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const occurredAt = whenEdited && when ? new Date(when).toISOString() : null;
      await recordExternalContact(company.id, { channel, note: note.trim(), occurredAt });
      showToast({ title: 'Harici temas kaydedildi', description: `${company.name} · ${EXTERNAL_CONTACT_LABELS[channel]}. Aşama ve sonraki adım değişmedi.` });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" className="button button--ghost button--sm si-external__open" onClick={start}>
        <PhoneCall size={14} aria-hidden="true" /> Harici temas kaydet
      </button>
    );

  return (
    <form
      className="si-external"
      aria-label="Harici temas kaydet"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="si-external__channels">
        <legend className="field__label">KITE dışında nasıl görüştün?</legend>
        <div className="chip-row">
          {EXTERNAL_CONTACT_CHANNELS.map((c) => (
            <button key={c} type="button" aria-pressed={channel === c} className={channel === c ? 'filter-chip filter-chip--on' : 'filter-chip'} onClick={() => setChannel(c)}>
              {EXTERNAL_CONTACT_LABELS[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="si-external__row">
        <label className="field">
          <span className="field__label">Kısa not (isteğe bağlı)</span>
          <input className="input" maxLength={MAX_EXTERNAL_NOTE} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. Fiyat listesini istedi" />
        </label>
        <label className="field">
          <span className="field__label">Ne zaman</span>
          <input className="input" type="datetime-local" value={when} max={localInput(new Date())} onChange={(e) => {
              setWhen(e.target.value);
              setWhenEdited(true);
            }} />
        </label>
      </div>
      <p className="si-planned">Bu kayıt yalnızca geçmişe eklenir; aşama, sonraki adım, mail veya takip planı değişmez.</p>
      {error && (
        <p className="research-alert research-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="si-external__actions">
        <button type="submit" className="button button--primary button--sm" disabled={busy}>
          Kaydet
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={() => setOpen(false)} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}
