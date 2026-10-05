import { useId, useState, type FormEvent } from 'react';
import { StickyNote } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import type { Company } from '../../../domain/company';
import { formatDateTime } from '../../../lib/date';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { useSaveAction } from '../../../state/useSaveAction';

export function NotesSection({ company }: { company: Company }) {
  const { addNote } = useCompanies();
  const { run, saving } = useSaveAction();
  const [draft, setDraft] = useState('');
  const id = useId();
  const notes = [...company.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    void run(
      () => addNote(company.id, content),
      () => setDraft(''),
    );
  };

  return (
    <div className="detail-section">
      <form className="note-form" onSubmit={onSubmit}>
        <label htmlFor={id} className="field__label">
          Yeni not
        </label>
        <textarea
          id={id}
          className="input textarea"
          rows={3}
          value={draft}
          placeholder="ör. Kasım ayında tekrar iletişime geçilebilir."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="form-actions">
          <button type="submit" className="button button--primary" disabled={!draft.trim() || saving}>
            Not Ekle
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="Henüz not yok" description="Görüşme izlenimlerini ve hatırlatmaları buraya yaz." />
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <p className="note__content">{n.content}</p>
              <p className="note__meta">
                {n.author} · <time dateTime={n.createdAt}>{formatDateTime(new Date(n.createdAt))}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
