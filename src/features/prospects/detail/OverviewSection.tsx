import { useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { useToast } from '../../../components/ui/Toast';
import { OpportunityScore } from '../../../components/sales/OpportunityScore';
import { SalesStatusBadge } from '../../../components/sales/SalesStatusBadge';
import { SalesStatusOptions } from '../../../components/sales/SalesStatusOptions';
import {
  COMPANY_SIZES,
  COMPANY_SIZE_ORDER,
  COMPANY_SOURCES,
  COMPANY_SOURCE_ORDER,
  DEFAULT_COUNTRY,
  generalContact,
  primaryContact,
  TEAM_MEMBERS,
  type Company,
  type CompanySize,
  type CompanySource,
} from '../../../domain/company';
import type { SalesStatus } from '../../../domain/salesStatus';
import { isValidScore } from '../../../domain/score';
import { formatDue, formatShortDate, fromDateInputValue, toDateInputValue } from '../../../lib/date';
import { isPlausibleDomain, normalizeWebsite, toExternalUrl } from '../../../lib/url';
import { useCompanies } from '../../../state/companies/CompaniesProvider';
import type { CompanyDetailsPatch } from '../../../state/companies/companiesReducer';
import { ResearchSourcesSection } from './ResearchSourcesSection';
import { SECTOR_LABELS, sectorLabel } from '../../../domain/sectorTaxonomy';
import { useSaveAction } from '../../../state/useSaveAction';

interface Draft {
  name: string;
  website: string;
  sector: string;
  city: string;
  country: string;
  companySize: CompanySize | '';
  source: CompanySource;
  owner: string;
  status: SalesStatus;
  score: string;
  lastContact: string;
  nextActionLabel: string;
  nextActionDue: string;
}

type Errors = Partial<Record<'name' | 'sector' | 'website' | 'score' | 'nextActionLabel', string>>;

function toDraft(c: Company): Draft {
  return {
    name: c.name,
    website: c.website ?? '',
    sector: sectorLabel(c.sector, c.sectorId),
    city: c.city,
    country: c.country,
    companySize: c.companySize ?? '',
    source: c.source,
    owner: c.owner ?? '',
    status: c.status,
    score: c.opportunityScore === null ? '' : String(c.opportunityScore),
    lastContact: toDateInputValue(c.lastContactAt),
    nextActionLabel: c.nextAction?.label ?? '',
    nextActionDue: toDateInputValue(c.nextAction?.dueAt ?? null),
  };
}

function validate(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = 'Şirket adı zorunlu.';
  if (!d.sector.trim()) errors.sector = 'Sektör zorunlu.';
  const website = normalizeWebsite(d.website);
  if (website && !isPlausibleDomain(website)) errors.website = 'Geçerli bir alan adı gir (ör. ornek.com).';
  if (d.score.trim() && !isValidScore(Number(d.score))) errors.score = '0 ile 100 arasında tam sayı gir.';
  if (d.nextActionDue && !d.nextActionLabel.trim()) errors.nextActionLabel = 'Tarih için bir adım da yaz.';
  return errors;
}

/** Keeps an existing due time when only the date is unchanged, so editing other fields doesn't move it. */
function nextDueAt(c: Company, dateValue: string): string | null {
  const current = c.nextAction?.dueAt ?? null;
  if (current && toDateInputValue(current) === dateValue) return current;
  return fromDateInputValue(dateValue);
}

function toPatch(c: Company, d: Draft): CompanyDetailsPatch {
  const lastContactAt =
    c.lastContactAt && toDateInputValue(c.lastContactAt) === d.lastContact ? c.lastContactAt : fromDateInputValue(d.lastContact);
  return {
    name: d.name.trim(),
    website: normalizeWebsite(d.website),
    sector: d.sector.trim(),
    city: d.city.trim(),
    country: d.country.trim() || DEFAULT_COUNTRY,
    companySize: d.companySize || null,
    source: d.source,
    owner: d.owner || null,
    status: d.status,
    opportunityScore: d.score.trim() ? Number(d.score) : null,
    lastContactAt,
    nextAction: d.nextActionLabel.trim()
      ? { label: d.nextActionLabel.trim(), dueAt: nextDueAt(c, d.nextActionDue) }
      : null,
  };
}

export function OverviewSection({ company }: { company: Company }) {
  const [editing, setEditing] = useState(false);
  return editing ? (
    <OverviewForm company={company} onDone={() => setEditing(false)} />
  ) : (
    <>
      <OverviewView company={company} onEdit={() => setEditing(true)} />
      <ResearchSourcesSection company={company} />
    </>
  );
}

function OverviewView({ company: c, onEdit }: { company: Company; onEdit: () => void }) {
  const primary = primaryContact(c);
  const general = generalContact(c);
  const rows: [string, ReactNode][] = [
    ['Şirket', c.name],
    [
      'Website',
      c.website ? (
        <a className="link" href={toExternalUrl(c.website)} target="_blank" rel="noopener noreferrer">
          {c.website}
        </a>
      ) : null,
    ],
    ['Sektör', sectorLabel(c.sector, c.sectorId)],
    ['Şehir', c.city || null],
    ['Ülke', c.country],
    ['Genel Email', general?.email ?? null],
    ['Genel Telefon', general?.phone ?? null],
    [
      'Birincil İletişim',
      primary ? (
        <span className="overview-contact">
          <span>
            {primary.fullName}
            {primary.role && <span className="text-subtle"> · {primary.role}</span>}
          </span>
          <span>{primary.email ?? <span className="text-subtle">E-posta yok</span>}</span>
          <span>{primary.phone ?? <span className="text-subtle">Telefon yok</span>}</span>
        </span>
      ) : null,
    ],
    ['Çalışan Sayısı', c.companySize ? COMPANY_SIZES[c.companySize] : null],
    ['Kaynak', COMPANY_SOURCES[c.source]],
    ['Sorumlu', c.owner],
    ['Durum', <SalesStatusBadge status={c.status} />],
    ['Genel Fırsat Skoru', <OpportunityScore score={c.opportunityScore} />],
    ['Son Temas', c.lastContactAt ? formatShortDate(new Date(c.lastContactAt)) : null],
    [
      'Sonraki Adım',
      c.nextAction
        ? `${c.nextAction.label}${c.nextAction.dueAt ? ` · ${formatDue(new Date(c.nextAction.dueAt))}` : ''}`
        : null,
    ],
    ['Eklenme', formatShortDate(new Date(c.createdAt))],
    ['Son Güncelleme', formatShortDate(new Date(c.updatedAt))],
  ];

  return (
    <div className="detail-section">
      <div className="detail-section__header">
        <h3 className="detail-section__title">Şirket Bilgileri</h3>
        <button type="button" className="button button--secondary button--sm" onClick={onEdit}>
          <Pencil size={14} aria-hidden="true" />
          Düzenle
        </button>
      </div>
      <dl className="detail-grid">
        {rows.map(([label, value]) => (
          <div key={label} className="detail-grid__row">
            <dt>{label}</dt>
            <dd>{value ?? <span className="text-subtle">—</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OverviewForm({ company, onDone }: { company: Company; onDone: () => void }) {
  const { updateDetails } = useCompanies();
  const { run, saving } = useSaveAction();
  const showToast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(company));
  const [errors, setErrors] = useState<Errors>({});
  const idp = `edit-${company.id}`;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(draft);
    setErrors(found);
    const first = (['name', 'website', 'sector', 'score', 'nextActionLabel'] as const).find((k) => found[k]);
    if (first) {
      document.getElementById(`${idp}-${first}`)?.focus();
      return;
    }
    void run(
      () => updateDetails(company.id, toPatch(company, draft)),
      () => {
        showToast({ title: 'Değişiklikler kaydedildi', description: draft.name.trim() });
        onDone();
      },
    );
  };

  return (
    <form className="detail-section" onSubmit={onSubmit} noValidate>
      <div className="detail-section__header">
        <h3 className="detail-section__title">Şirket Bilgilerini Düzenle</h3>
      </div>
      <div className="form-grid">
        <FormField id={`${idp}-name`} label="Şirket" required error={errors.name} className="form-grid__full">
          <input {...fieldA11y(`${idp}-name`, errors.name)} className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-website`} label="Website" error={errors.website}>
          <input
            {...fieldA11y(`${idp}-website`, errors.website)}
            className="input"
            value={draft.website}
            placeholder="ornek.com"
            onChange={(e) => set('website', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-sector`} label="Sektör" required error={errors.sector}>
          <input
            {...fieldA11y(`${idp}-sector`, errors.sector)}
            className="input"
            list={`${idp}-sector-options`}
            value={draft.sector}
            onChange={(e) => set('sector', e.target.value)}
            autoComplete="off"
          />
          <datalist id={`${idp}-sector-options`}>
            {SECTOR_LABELS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </FormField>
        <FormField id={`${idp}-city`} label="Şehir">
          <input id={`${idp}-city`} className="input" value={draft.city} onChange={(e) => set('city', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-country`} label="Ülke">
          <input id={`${idp}-country`} className="input" value={draft.country} onChange={(e) => set('country', e.target.value)} />
        </FormField>
        <FormField id={`${idp}-size`} label="Çalışan Sayısı">
          <select
            id={`${idp}-size`}
            className="input"
            value={draft.companySize}
            onChange={(e) => set('companySize', e.target.value as CompanySize | '')}
          >
            <option value="">Bilinmiyor</option>
            {COMPANY_SIZE_ORDER.map((s) => (
              <option key={s} value={s}>
                {COMPANY_SIZES[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id={`${idp}-source`} label="Kaynak">
          <select id={`${idp}-source`} className="input" value={draft.source} onChange={(e) => set('source', e.target.value as CompanySource)}>
            {COMPANY_SOURCE_ORDER.map((s) => (
              <option key={s} value={s}>
                {COMPANY_SOURCES[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id={`${idp}-owner`} label="Sorumlu">
          <select id={`${idp}-owner`} className="input" value={draft.owner} onChange={(e) => set('owner', e.target.value)}>
            {TEAM_MEMBERS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="">Atanmadı</option>
          </select>
        </FormField>
        <FormField id={`${idp}-status`} label="Durum">
          <select id={`${idp}-status`} className="input" value={draft.status} onChange={(e) => set('status', e.target.value as SalesStatus)}>
            <SalesStatusOptions />
          </select>
        </FormField>
        <FormField id={`${idp}-score`} label="Genel Fırsat Skoru" error={errors.score} hint="0–100, boş bırakılabilir.">
          <input
            {...fieldA11y(`${idp}-score`, errors.score)}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={draft.score}
            onChange={(e) => set('score', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-last-contact`} label="Son Temas">
          <input
            id={`${idp}-last-contact`}
            className="input"
            type="date"
            value={draft.lastContact}
            onChange={(e) => set('lastContact', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-nextActionLabel`} label="Sonraki Adım" error={errors.nextActionLabel}>
          <input
            {...fieldA11y(`${idp}-nextActionLabel`, errors.nextActionLabel)}
            className="input"
            value={draft.nextActionLabel}
            placeholder="ör. Takip maili gönder"
            onChange={(e) => set('nextActionLabel', e.target.value)}
          />
        </FormField>
        <FormField id={`${idp}-next-due`} label="Sonraki Adım Tarihi">
          <input
            id={`${idp}-next-due`}
            className="input"
            type="date"
            value={draft.nextActionDue}
            onChange={(e) => set('nextActionDue', e.target.value)}
          />
        </FormField>
      </div>
      <div className="form-actions">
        <button type="button" className="button button--secondary" onClick={onDone}>
          Vazgeç
        </button>
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </form>
  );
}
