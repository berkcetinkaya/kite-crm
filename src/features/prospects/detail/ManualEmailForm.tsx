// "E-posta ekle": saves an address the user found by hand as a normal company contact (the same
// contact endpoint and rules as "İletişim Kişisi Ekle"). Used in the drawer's İletişim section and in
// Mail & Takip › Hazırlık. Nothing else happens: no draft, no send, no follow up.
import { useState, type FormEvent } from 'react';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { useToast } from '../../../components/ui/Toast';
import type { Company, Contact } from '../../../domain/company';
import { contactWithEmail, planManualEmail } from '../../../domain/manualContact';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import { useSaveAction } from '../../../state/useSaveAction';

type Field = 'email' | 'fullName' | 'role';

interface Props {
  company: Company;
  /** Called with the contact that now holds the address (new, filled in, or already there). */
  onDone: (contact: Contact | null) => void;
  idPrefix: string;
}

export function ManualEmailForm({ company, onDone, idPrefix }: Props) {
  const { addContact, updateContact } = useCompanies();
  const showToast = useToast();
  const { run, saving } = useSaveAction();
  const [form, setForm] = useState({ email: '', fullName: '', role: '' });
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const idp = `${idPrefix}-${company.id}`;

  const set = (key: Field, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (error?.field === key) setError(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const plan = planManualEmail(company, form);
    if (plan.kind === 'invalid') {
      setError({ field: plan.field, message: plan.message });
      document.getElementById(`${idp}-${plan.field}`)?.focus();
      return;
    }
    if (plan.kind === 'existing') {
      showToast({ title: 'Bu e-posta zaten kayıtlı', description: `${plan.contact.fullName} · ${plan.contact.email}. Yeni kişi eklenmedi.` });
      onDone(plan.contact);
      return;
    }
    let saved: Contact | null = null;
    void run(
      async () => {
        const next = plan.kind === 'update' ? await updateContact(company.id, plan.contact) : await addContact(company.id, plan.contact);
        saved = contactWithEmail(next, plan.contact.email ?? '');
      },
      () => {
        showToast({ title: 'E-posta eklendi', description: `${saved?.fullName ?? plan.contact.fullName} · ${plan.contact.email}` });
        onDone(saved);
      },
    );
  };

  const err = (f: Field) => (error?.field === f ? error.message : undefined);

  return (
    <form className="inline-form manual-email" onSubmit={onSubmit} noValidate aria-label="E-posta ekle">
      <p className="inline-form__title">E-posta ekle</p>
      <div className="form-grid">
        <FormField id={`${idp}-email`} label="E-posta" required error={err('email')} className="form-grid__full">
          <input
            {...fieldA11y(`${idp}-email`, err('email'))}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="info@sirket.com"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField id={`${idp}-fullName`} label="Ad Soyad (isteğe bağlı)" error={err('fullName')} hint="Boş bırakırsan “Genel iletişim” olarak kaydedilir (info@, hello@ gibi).">
          <input {...fieldA11y(`${idp}-fullName`, err('fullName'))} className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-role`} label="Pozisyon (isteğe bağlı)" error={err('role')}>
          <input {...fieldA11y(`${idp}-role`, err('role'))} className="input" value={form.role} onChange={(e) => set('role', e.target.value)} />
        </FormField>
      </div>
      <p className="field__hint">Elle eklenen iletişim kişisi olarak kaydedilir. Taslak hazırlanmaz, mail gönderilmez.</p>
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={() => onDone(null)} disabled={saving}>
          Vazgeç
        </button>
        <button type="submit" className="button button--primary" disabled={saving}>
          Kaydet
        </button>
      </div>
    </form>
  );
}
