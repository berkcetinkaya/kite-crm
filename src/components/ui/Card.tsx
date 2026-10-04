import type { ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Removes inner padding so tables/lists can run edge to edge. */
  flush?: boolean;
  children: ReactNode;
}

export function Card({ title, subtitle, action, className, flush, children }: CardProps) {
  const hasHeader = title || subtitle || action;
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {hasHeader && (
        <header className="card__header">
          <div className="card__heading">
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card__action">{action}</div>}
        </header>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  );
}
