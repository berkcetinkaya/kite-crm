import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  /** Renders every panel and hides the inactive ones, so in-progress edits survive tab switches. */
  renderPanel: (id: T) => ReactNode;
}

/** WAI-ARIA tabs using the shared .tabs styles. Arrow keys move between tabs. */
export function Tabs<T extends string>({ items, active, onChange, label, renderPanel }: TabsProps<T>) {
  const baseId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = items[(index + delta + items.length) % items.length];
    onChange(next.id);
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label}>
        {items.map((t, i) => (
          <button
            key={t.id}
            id={`${baseId}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className={active === t.id ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.label}
            {t.count !== undefined && <span className="tabs__count">{t.count}</span>}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          id={`${baseId}-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={active !== t.id}
          className="tabs__panel"
        >
          {renderPanel(t.id)}
        </div>
      ))}
    </>
  );
}
