import { CircleAlert, Loader2 } from 'lucide-react';
import { EmptyState } from './EmptyState';

/** Shown instead of an empty list while data loads from the KITE server, or when loading failed. */
export function DataLoadNotice({ state, error, onRetry, what }: { state: 'loading' | 'error'; error: string | null; onRetry?: () => void; what: string }) {
  if (state === 'loading') {
    return (
      <div className="data-load" role="status" aria-busy="true">
        <Loader2 size={16} className="spin" aria-hidden="true" />
        {what} yükleniyor…
      </div>
    );
  }
  return (
    <EmptyState
      icon={CircleAlert}
      title={`${what} yüklenemedi`}
      description={error ?? 'KITE sunucusuna ulaşılamıyor.'}
      action={
        onRetry && (
          <button type="button" className="button button--secondary" onClick={onRetry}>
            Tekrar dene
          </button>
        )
      }
    />
  );
}
