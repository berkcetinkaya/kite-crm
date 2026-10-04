import { scoreBand } from '../../domain/score';

/** Restrained 0–100 score: number plus a thin bar. Only strong scores use the accent colour. */
export function OpportunityScore({ score, size = 'md' }: { score: number | null; size?: 'md' | 'lg' }) {
  if (score === null) {
    return <span className="opp-score opp-score--none">Puanlanmadı</span>;
  }
  const band = scoreBand(score);
  return (
    <span className={`opp-score opp-score--${band} opp-score--${size}`} title={`Fırsat skoru: ${score}/100`}>
      <span className="opp-score__value">{score}</span>
      <span className="opp-score__track" aria-hidden="true">
        <span style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}
