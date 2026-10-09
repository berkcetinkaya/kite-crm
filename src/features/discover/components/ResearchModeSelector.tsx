import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import type { ResearchMode } from '../../../domain/research';
import type { ConnectionState } from '../useResearchStatus';

interface ResearchModeSelectorProps {
  mode: ResearchMode;
  onChange: (mode: ResearchMode) => void;
  connection: ConnectionState;
  running: boolean;
  onRetryConnection: () => void;
}

export function connectionLabel(connection: ConnectionState, running: boolean): { text: string; tone: BadgeTone } {
  if (running) return { text: 'Araştırılıyor', tone: 'accent' };
  switch (connection.kind) {
    case 'checking':
      return { text: 'Bağlantı kontrol ediliyor', tone: 'neutral' };
    case 'ready':
      return connection.provider === 'fixture'
        ? { text: 'Hazır · Test sağlayıcı (fixture)', tone: 'warning' }
        : { text: 'Hazır', tone: 'success' };
    case 'not_configured':
      return { text: 'API bağlantısı gerekli', tone: 'warning' };
    case 'unreachable':
      return { text: 'Araştırma sunucusuna ulaşılamıyor', tone: 'neutral' };
  }
}

/** Native radio inputs: arrow keys switch modes, and the choice is announced without color. */
export function ResearchModeSelector({ mode, onChange, connection, running, onRetryConnection }: ResearchModeSelectorProps) {
  const status = connectionLabel(connection, running);
  return (
    <fieldset className="mode-selector">
      <legend className="field__label">Araştırma Modu</legend>
      <div className="mode-selector__row">
        <div className="segmented mode-selector__options">
          {(
            [
              ['demo', 'Demo / Kurgusal Veri'],
              ['real', 'Gerçek'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={mode === value ? 'segmented__item segmented__item--active' : 'segmented__item'}>
              <input
                type="radio"
                name="research-mode"
                value={value}
                checked={mode === value}
                onChange={() => onChange(value)}
                className="visually-hidden"
              />
              {label}
            </label>
          ))}
        </div>
        {mode === 'real' && (
          <span className="mode-selector__status" role="status">
            <Badge tone={status.tone} dot>
              {status.text}
            </Badge>
            {connection.kind === 'unreachable' && !running && (
              <button type="button" className="link mode-selector__retry" onClick={onRetryConnection}>
                Tekrar dene
              </button>
            )}
          </span>
        )}
      </div>
      <p className="field__hint">
        {mode === 'demo'
          ? "Demo: kurgusal şirketlerle akışı denemek için. İnternette araştırma yapılmaz. Demo sonuçları kurgusaldır ve CRM'e eklenemez."
          : 'Gerçek: herkese açık web aranır, şirket siteleri sınırlı şekilde incelenir ve fırsatlar kanıta göre puanlanır.'}
      </p>
    </fieldset>
  );
}
