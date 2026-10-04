import { useState, type FormEvent } from 'react';
import { ExternalLink, Mail, Pencil, Phone, UserPlus, Users } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { useToast } from '../../../components/ui/Toast';
import {
  CONTACT_CONFIDENCE,
  CONTACT_CONFIDENCE_ORDER,
  type Company,
  type Contact,
  type ContactConfidence,
} from '../../../domain/company';
import { toExternalUrl } from '../../../lib/url';
import { useCompanies, type ContactInput } from '../../../state/companies/CompaniesProvider';

const CONFIDENCE_TONE = { high: 'success', medium: 'neutral', low: 'warning' } as const;

/** null = closed, 'new' = adding, otherwise the id of the contact being edited. */
type FormTarget = null | 'new' | string;

export function ContactsSection({ company }: { company: Company }) {
  const [target, setTarget] = useState<FormTarget>(null);
  const editing = target && target !== 'new' ? company.contacts.find((c) => c.id === target) ?? null : null;

  return (
    <div className="detail-section">
      <div className="detail-section__header">
        <h3 className="detail-section__title">İletişim Kişileri</h3>
        {target === null && (
          <button type="button" className="button button--secondary button--sm" onClick={() => setTarget('new')}>
            <UserPlus size={14} aria-hidden="true" />
            İletişim Kişisi Ekle
          </button>
        )}
      </div>

      {target !== null && (
        <ContactForm
          key={target}
          company={company}
          contact={editing}
          onDone={() => setTarget(null)}
        />
      )}

      {company.contacts.length === 0 && target === null ? (
        <EmptyState
          icon={Users}
          title="Henüz iletişim kişisi yok"
          description="Karar vericiyi veya ilk temas kuracağın kişiyi ekle."
          action={
            <button type="button" className="button button--secondary button--sm" onClick={() => setTarget('new')}>
              <UserPlus size={14} aria-hidden="true" />
              İletişim Kişisi Ekle
            </button>
          }
        />
      ) : (
        <ul className="contact-list">
          {company.contacts
            .filter((c) => c.id !== target)
            .map((c) => (
              <li key={c.id} className="contact">
                <div className="contact__top">
                  <div>
                    <p className="contact__name">{c.fullName}</p>
                    <p className="contact__role">{c.role || 'Pozisyon belirtilmedi'}</p>
                  </div>
                  {target === null && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setTarget(c.id)}
                      aria-label={`${c.fullName} kişisini düzenle`}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
                <div className="contact__badges">
                  {c.isDecisionMaker && <Badge tone="accent">Karar Verici</Badge>}
                  <Badge tone={CONFIDENCE_TONE[c.confidence]}>Güven: {CONTACT_CONFIDENCE[c.confidence]}</Badge>
                </div>
                <ul className="contact__channels">
                  <li>
                    <Mail size={14} aria-hidden="true" />
                    <span className="visually-hidden">E-posta: </span>
                    {c.email ?? <span className="text-subtle">E-posta yok</span>}
                  </li>
                  <li>
                    <Phone size={14} aria-hidden="true" />
                    <span className="visually-hidden">Telefon: </span>
                    {c.phone ?? <span className="text-subtle">Telefon yok</span>}
                  </li>
                  {c.linkedin && (
                    <li>
                      <ExternalLink size={14} aria-hidden="true" />
                      <a className="link" href={toExternalUrl(c.linkedin)} target="_blank" rel="noopener noreferrer">
                        LinkedIn profili
                        <span className="visually-hidden"> (yeni sekmede açılır)</span>
                      </a>
                    </li>
                  )}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

type Errors = Partial<Record<'fullName' | 'email', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ContactForm({ company, contact, onDone }: { company: Company; contact: Contact | null; onDone: () => void }) {
  const { addContact, updateContact } = useCompanies();
  const showToast = useToast();
  const [form, setForm] = useState({
    fullName: contact?.fullName ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    linkedin: contact?.linkedin ?? '',
    isDecisionMaker: contact?.isDecisionMaker ?? false,
    confidence: contact?.confidence ?? ('medium' as ContactConfidence),
  });
  const [errors, setErrors] = useState<Errors>({});
  const idp = `contact-${company.id}-${contact?.id ?? 'new'}`;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (!form.fullName.trim()) found.fullName = 'Ad soyad zorunlu.';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) found.email = 'Geçerli bir e-posta adresi gir.';
    setErrors(found);
    const first = (['fullName', 'email'] as const).find((k) => found[k]);
    if (first) {
      document.getElementById(`${idp}-${first}`)?.focus();
      return;
    }
    const value: ContactInput = {
      fullName: form.fullName.trim(),
      role: form.role.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      linkedin: form.linkedin.trim() || null,
      isDecisionMaker: form.isDecisionMaker,
      confidence: form.confidence,
    };
    if (contact) {
      updateContact(company.id, { ...value, id: contact.id });
      showToast({ title: 'İletişim kişisi güncellendi', description: value.fullName });
    } else {
      addContact(company.id, value);
      showToast({ title: 'İletişim kişisi eklendi', description: `${value.fullName} · ${company.name}` });
    }
    onDone();
  };

  return (
    <form className="inline-form" onSubmit={onSubmit} noValidate aria-label={contact ? 'İletişim kişisini düzenle' : 'Yeni iletişim kişisi'}>
      <p className="inline-form__title">{contact ? 'İletişim Kişisini Düzenle' : 'Yeni İletişim Kişisi'}</p>
      <div className="form-grid">
        <FormField id={`${idp}-fullName`} label="Ad Soyad" required error={errors.fullName}>
          <input
            {...fieldA11y(`${idp}-fullName`, errors.fullName)}
            className="input"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField id={`${idp}-role`} label="Pozisyon">
          <input id={`${idp}-role`} className="input" value={form.role} onChange={(e) => set('role', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-email`} label="E-posta" error={errors.email}>
          <input
            {...fieldA11y(`${idp}-email`, errors.email)}
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-phone`} label="Telefon">
          <input id={`${idp}-phone`} className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-linkedin`} label="LinkedIn">
          <input
            id={`${idp}-linkedin`}
            className="input"
            value={form.linkedin}
            placeholder="linkedin.com/in/…"
            onChange={(e) => set('linkedin', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-confidence`} label="Güven Seviyesi">
          <select
            id={`${idp}-confidence`}
            className="input"
            value={form.confidence}
            onChange={(e) => set('confidence', e.target.value as ContactConfidence)}
          >
            {CONTACT_CONFIDENCE_ORDER.map((c) => (
              <option key={c} value={c}>
                {CONTACT_CONFIDENCE[c]}
              </option>
            ))}
          </select>
        </FormField>
        <label className="checkbox form-grid__full">
          <input type="checkbox" checked={form.isDecisionMaker} onChange={(e) => set('isDecisionMaker', e.target.checked)} />
          Karar verici
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onDone}>
          Vazgeç
        </button>
        <button type="submit" className="button button--primary">
          {contact ? 'Kaydet' : 'Kişiyi Ekle'}
        </button>
      </div>
    </form>
  );
}
