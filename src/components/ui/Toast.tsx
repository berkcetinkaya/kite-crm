import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
}

type ShowToast = (toast: Omit<ToastMessage, 'id'>) => void;

const ToastContext = createContext<ShowToast | null>(null);

const TOAST_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (toast) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...toast, id }]);
      window.setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <Info size={18} className="toast__icon" aria-hidden="true" />
            <div className="toast__content">
              <p className="toast__title">{t.title}</p>
              {t.description && <p className="toast__description">{t.description}</p>}
            </div>
            <button type="button" className="icon-button" onClick={() => dismiss(t.id)} aria-label="Bildirimi kapat">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
