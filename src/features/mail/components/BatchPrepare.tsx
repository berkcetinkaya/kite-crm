// Toplu taslak hazırlığı (Phase 13): at most 5 Hazır companies without a draft, prepared one after
// another on the server. Each company is isolated; the result lists what happened to each. Never
// approves, sends or starts a follow up.
import { useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { errorMessage } from '../../../api/dataApi';
import { outreachPrepApi } from '../../../api/outreachPrepApi';
import { MAX_BATCH_PREPARE, type BatchItemResult, type PreparationOverviewItem } from '../../../domain/outreachPrep';
import { useMailDrafts } from '../../../state/mail/MailDraftsProvider';

interface Props {
  items: readonly PreparationOverviewItem[];
  realGenerations: { today: number; limit: number } | null;
  provider: 'anthropic' | 'fixture' | null;
  onDone: () => void;
}

export function BatchPrepare({ items, realGenerations, provider, onDone }: Props) {
  const { upsert } = useMailDrafts();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = items.filter((i) => i.readiness.state === 'ready' && !i.draftId);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_BATCH_PREPARE ? [...s, id] : s));

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const { results: out } = await outreachPrepApi.batch(selected);
      setResults(out);
      // Bring the new drafts into the list (the batch response only carries the per-company outcome).
      for (const r of out.filter((x) => x.status === 'generated')) {
        const d = await outreachPrepApi.detail(r.companyId);
        if (d.draft) upsert(d.draft);
      }
      setSelected([]);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="card batch-prep" aria-labelledby="batch-prep-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="batch-prep-title" className="card__title">
            <Layers size={16} aria-hidden="true" /> Toplu taslak hazırla
          </h2>
          <p className="card__subtitle">
            Hazır ve taslağı olmayan {candidates.length} şirket · en fazla {MAX_BATCH_PREPARE} şirket, sırayla
          </p>
        </div>
        <div className="card__action">
          <button type="button" className="button button--ghost button--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Kapat' : 'Aç'}
          </button>
        </div>
      </header>
      {open && (
        <div className="card__body">
          {candidates.length === 0 ? (
            <p className="text-subtle">Şu anda Hazır durumda ve taslağı olmayan şirket yok.</p>
          ) : (
            <ul className="batch-prep__list">
              {candidates.map((c) => (
                <li key={c.companyId}>
                  <label className="stage-move__check">
                    <input type="checkbox" checked={selected.includes(c.companyId)} disabled={running || (!selected.includes(c.companyId) && selected.length >= MAX_BATCH_PREPARE)} onChange={() => toggle(c.companyId)} />
                    <span>
                      {c.companyName} <span className="text-subtle">· {c.readiness.angleLabel ?? '—'} · {c.readiness.contactEmail ?? '—'}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mail-editor__actions">
            <button type="button" className="button button--primary button--sm" disabled={running || selected.length === 0} onClick={() => void run()}>
              {running ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
              {running ? 'Hazırlanıyor…' : `Seçilenler için taslak hazırla (${selected.length})`}
            </button>
            {provider === 'fixture' && <Badge tone="warning">Test sağlayıcı (fixture, ücretsiz)</Badge>}
            {provider === 'anthropic' && realGenerations && (
              <span className="text-subtle">
                Bugünkü gerçek üretim: {realGenerations.today} / {realGenerations.limit}
              </span>
            )}
          </div>
          <p className="field__hint">Toplu hazırlık taslakları yalnızca İncelenecek olarak kaydeder; onaylamaz, göndermez ve takip planı başlatmaz.</p>
          {error && (
            <p className="research-alert research-alert--error" role="alert">
              {error}
            </p>
          )}
          {results && (
            <ul className="convert-results" aria-label="Toplu hazırlık sonucu">
              {results.map((r) => (
                <li key={r.companyId} className={r.status === 'generated' ? 'convert-results__ok' : 'convert-results__fail'}>
                  <strong>{r.companyName}</strong>: {r.status === 'generated' ? 'Taslak hazırlandı (İncelenecek).' : `${r.status === 'skipped' ? 'Atlandı' : 'Hazırlanamadı'}: ${r.message ?? ''}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
