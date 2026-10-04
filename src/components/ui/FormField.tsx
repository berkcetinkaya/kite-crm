import type { ReactNode } from 'react';

interface FormFieldProps {
  /** Id of the control inside; the error gets `${id}-error` for aria-describedby. */
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function errorId(id: string): string {
  return `${id}-error`;
}

/** Label + control + inline error, on the existing .field styles. */
export function FormField({ id, label, required, error, hint, className, children }: FormFieldProps) {
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={errorId(id)} className="field__error">
          {error}
        </p>
      ) : (
        hint && <p className="field__hint">{hint}</p>
      )}
    </div>
  );
}

/** Props that wire a control to its FormField error. */
export function fieldA11y(id: string, error?: string) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId(id) : undefined,
  } as const;
}
