import { useState, type FormEvent } from 'react';
import { SalesStatusOptions } from '../../../components/sales/SalesStatusOptions';
import { Drawer } from '../../../components/ui/Drawer';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { useToast } from '../../../components/ui/Toast';
import {
  COMPANY_SOURCES,
  COMPANY_SOURCE_ORDER,
  DEFAULT_COUNTRY,
  TEAM_MEMBERS,
  CURRENT_USER,
  type CompanySource,
} from '../../../domain/company';
import type { SalesStatus } from '../../../domain/salesStatus';
import { isValidScore } from '../../../domain/score';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { isPlausibleDomain, normalizeWebsite } from '../../../lib/url';
import { useCompanies, type NewCompanyInput } from '../../../state/companies/CompaniesProvider';
import { contactsFromForm, type AddCompanyContactFields } from '../../../state/companies/companyCommands';
import { isValidEmail } from '../../../lib/email';
import { useSaveAction } from '../../../state/useSaveAction';

const FORM_ID = 'add-company-form';
const UNASSIGNED = '';

interface FormState extends AddCompanyContactFields {
  name: string;
  website: string;
  sector: string;
  city: string;
  country: string;
  source: CompanySource;
  services: ServiceKey[];
  score: string;
  status: SalesStatus;
  owner: string;
  note: string;
}

const INITIAL: FormState = {
  name: '',
  website: '',
  sector: '',
  city: '',
  country: DEFAULT_COUNTRY,
  source: 'manual',
  services: [],
  score: '',
  status: 'found',
  owner: CURRENT_USER,
  note: '',
  generalEmail: '',
  generalPhone: '',
  contactName: '',
  contactRole: '',
  contactEmail: '',
  contactPhone: '',
};

type ErrorKey = 'name' | 'website' | 'sector' | 'generalEmail' | 'contactName' | 'contactEmail' | 'score';
type Errors = Partial<Record<ErrorKey, string>>;
const ERROR_ORDER: readonly ErrorKey[] = ['name', 'website', 'sector', 'generalEmail', 'contactName', 'contactEmail', 'score'];
const INVALID_EMAIL = 'Geçerli bir e-posta adresi gir.';

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = 'Şirket adı zorunlu.';
  if (!form.sector.trim()) errors.sector = 'Sektör zorunlu.';
  const website = normalizeWebsite(form.website);
  if (website && !isPlausibleDomain(website)) errors.website = 'Geçerli bir alan adı gir (ör. ornek.com).';
  if (form.generalEmail.trim() && !isValidEmail(form.generalEmail)) errors.generalEmail = INVALID_EMAIL;
  if (form.contactEmail.trim() && !isValidEmail(form.contactEmail)) errors.contactEmail = INVALID_EMAIL;
  if (!form.contactName.trim() && (form.contactRole.trim() || form.contactEmail.trim() || form.contactPhone.trim())) {
    errors.contactName = 'Kişinin adını gir. Kişi yoksa adresi Genel Email alanına yaz.';
  }
  if (form.score.trim() && !isValidScore(Number(form.score))) errors.score = '0 ile 100 arasında tam sayı gir.';
  return errors;
}

interface AddCompanyDrawerProps {
  open: boolean;
  onClose: () => void;
  sectors: string[];
  cities: string[];
}

export function AddCompanyDrawer({ open, onClose, sectors, cities }: AddCompanyDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Şirket Ekle"
      width="md"
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" form={FORM_ID} className="button button--primary">
            Şirketi Ekle
          </button>
        </>
      }
    >
      <AddCompanyForm onDone={onClose} sectors={sectors} cities={cities} />
    </Drawer>
  );
}

function AddCompanyForm({
  onDone,
  sectors,
  cities,
}: {
  onDone: () => void;
  sectors: string[];
  cities: string[];
}) {
  const { addCompany } = useCompanies();
  const showToast = useToast();
  const { run } = useSaveAction();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Errors>({});

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleService = (service: ServiceKey) =>
    update(
      'services',
      form.services.includes(service) ? form.services.filter((s) => s !== service) : [...form.services, service],
    );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    const firstInvalid = ERROR_ORDER.find((k) => found[k]);
    if (firstInvalid) {
      document.getElementById(`new-company-${firstInvalid}`)?.focus();
      return;
    }

    const input: NewCompanyInput = {
      name: form.name.trim(),
      website: normalizeWebsite(form.website),
      sector: form.sector.trim(),
      city: form.city.trim(),
      country: form.country.trim() || DEFAULT_COUNTRY,
      source: form.source,
      // Per-service scores and reasons are filled in later from the company detail.
      opportunities: form.services.map((service) => ({ service, score: null, reason: '', potential: null })),
      opportunityScore: form.score.trim() ? Number(form.score) : null,
      status: form.status,
      owner: form.owner || null,
      note: form.note,
      // Saved with the company in one server transaction.
      contacts: contactsFromForm(form),
    };
    void run(
      () => addCompany(input),
      () => {
        showToast({ title: 'Şirket eklendi', description: `${input.name} potansiyel müşteriler listesine eklendi.` });
        onDone();
      },
    );
  };

  return (
    <form id={FORM_ID} className="form-grid" onSubmit={onSubmit} noValidate>
      <p className="form-note form-grid__full">
        <span aria-hidden="true">*</span> ile işaretli alanlar zorunlu.
      </p>
      <h3 className="form-section-title form-grid__full">Şirket Bilgileri</h3>
      <FormField id="new-company-name" label="Şirket Adı" required error={errors.name} className="form-grid__full">
        <input
          {...fieldA11y('new-company-name', errors.name)}
          className="input"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="new-company-website" label="Website" error={errors.website} className="form-grid__full">
        <input
          {...fieldA11y('new-company-website', errors.website)}
          className="input"
          value={form.website}
          placeholder="ornek.com"
          onChange={(e) => update('website', e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="new-company-sector" label="Sektör" required error={errors.sector} hint="Listeden seç ya da kendi sektörünü yaz.">
        <input
          {...fieldA11y('new-company-sector', errors.sector)}
          className="input"
          list="new-company-sector-options"
          value={form.sector}
          onChange={(e) => update('sector', e.target.value)}
          autoComplete="off"
        />
        <datalist id="new-company-sector-options">
          {sectors.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </FormField>
      <FormField id="new-company-city" label="Şehir">
        <input
          id="new-company-city"
          className="input"
          list="new-company-city-options"
          value={form.city}
          onChange={(e) => update('city', e.target.value)}
          autoComplete="off"
        />
        <datalist id="new-company-city-options">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </FormField>
      <FormField id="new-company-country" label="Ülke">
        <input
          id="new-company-country"
          className="input"
          value={form.country}
          onChange={(e) => update('country', e.target.value)}
        />
      </FormField>
      <FormField id="new-company-generalEmail" label="Genel Email" error={errors.generalEmail} hint="info@, hello@ gibi şirket adresi.">
        <input
          {...fieldA11y('new-company-generalEmail', errors.generalEmail)}
          className="input"
          type="email"
          value={form.generalEmail}
          onChange={(e) => update('generalEmail', e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="new-company-generalPhone" label="Genel Telefon">
        <input id="new-company-generalPhone" className="input" type="tel" value={form.generalPhone} onChange={(e) => update('generalPhone', e.target.value)} autoComplete="off" />
      </FormField>

      <h3 className="form-section-title form-grid__full">Birincil İletişim Kişisi</h3>
      <p className="field__hint form-grid__full">İsteğe bağlı. Mail gönderiminde önce bu kişi önerilir; KITE e-posta adresi tahmin etmez.</p>
      <FormField id="new-company-contactName" label="İletişim Kişisi" error={errors.contactName}>
        <input
          {...fieldA11y('new-company-contactName', errors.contactName)}
          className="input"
          value={form.contactName}
          placeholder="Ad Soyad"
          onChange={(e) => update('contactName', e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="new-company-contactRole" label="Rol / Ünvan">
        <input id="new-company-contactRole" className="input" value={form.contactRole} onChange={(e) => update('contactRole', e.target.value)} autoComplete="off" />
      </FormField>
      <FormField id="new-company-contactEmail" label="Email" error={errors.contactEmail}>
        <input
          {...fieldA11y('new-company-contactEmail', errors.contactEmail)}
          className="input"
          type="email"
          value={form.contactEmail}
          onChange={(e) => update('contactEmail', e.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="new-company-contactPhone" label="Telefon">
        <input id="new-company-contactPhone" className="input" type="tel" value={form.contactPhone} onChange={(e) => update('contactPhone', e.target.value)} autoComplete="off" />
      </FormField>

      <h3 className="form-section-title form-grid__full">Satış Bilgileri</h3>
      <FormField id="new-company-source" label="Kaynak">
        <select
          id="new-company-source"
          className="input"
          value={form.source}
          onChange={(e) => update('source', e.target.value as CompanySource)}
        >
          {COMPANY_SOURCE_ORDER.map((s) => (
            <option key={s} value={s}>
              {COMPANY_SOURCES[s]}
            </option>
          ))}
        </select>
      </FormField>

      <fieldset className="choice-group form-grid__full">
        <legend className="field__label">Hizmet Fırsatı</legend>
        <div className="choice-group__options">
          {SERVICE_KEYS.map((s) => (
            <label key={s} className="choice-chip">
              <input type="checkbox" checked={form.services.includes(s)} onChange={() => toggleService(s)} />
              <span>{SERVICES[s].label}</span>
            </label>
          ))}
        </div>
        <p className="field__hint">Birden fazla seçebilirsin. Hizmet bazında skor ve gerekçe şirket detayından eklenir.</p>
      </fieldset>

      <FormField id="new-company-score" label="Fırsat Skoru" error={errors.score} hint="0–100, boş bırakılabilir.">
        <input
          {...fieldA11y('new-company-score', errors.score)}
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={form.score}
          onChange={(e) => update('score', e.target.value)}
        />
      </FormField>
      <FormField id="new-company-status" label="Durum" required>
        <select
          id="new-company-status"
          className="input"
          value={form.status}
          onChange={(e) => update('status', e.target.value as SalesStatus)}
        >
          <SalesStatusOptions />
        </select>
      </FormField>
      <FormField id="new-company-owner" label="Sorumlu">
        <select id="new-company-owner" className="input" value={form.owner} onChange={(e) => update('owner', e.target.value)}>
          {TEAM_MEMBERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={UNASSIGNED}>Atanmadı</option>
        </select>
      </FormField>
      <FormField id="new-company-note" label="Not" className="form-grid__full">
        <textarea
          id="new-company-note"
          className="input textarea"
          rows={3}
          value={form.note}
          onChange={(e) => update('note', e.target.value)}
          placeholder="İlk izlenim, neden listeye eklendiği…"
        />
      </FormField>
    </form>
  );
}
