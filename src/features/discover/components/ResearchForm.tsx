import type { FormEvent } from 'react';
import { FormField, fieldA11y } from '../../../components/ui/FormField';
import { COUNTRIES, MARKET_REGIONS, MARKET_REGION_ORDER, citiesFor } from '../../../domain/locations';
import { SECTORS } from '../../../domain/sectors';
import { SERVICE_KEYS, SERVICES, type ServiceKey } from '../../../domain/services';
import { CUSTOM_COUNTRY, MAX_COMPANY_COUNT, draftCountry, type DraftErrors, type ResearchDraft } from '../draft';
import { RESEARCH_PRESETS, type ResearchPreset } from '../presets';

export const RESEARCH_FORM_ID = 'research-form';

interface ResearchFormProps {
  draft: ResearchDraft;
  errors: DraftErrors;
  onChange: (draft: ResearchDraft) => void;
  onPreset: (preset: ResearchPreset) => void;
  onSubmit: () => void;
}

const ALL_CITIES = [...new Set(COUNTRIES.flatMap((c) => c.cities))];

export function ResearchForm({ draft, errors, onChange, onPreset, onSubmit }: ResearchFormProps) {
  const set = <K extends keyof ResearchDraft>(key: K, value: ResearchDraft[K]) => onChange({ ...draft, [key]: value });
  const country = draftCountry(draft);
  const knownCities = citiesFor(country);
  const citySuggestions = draft.countryChoice && draft.countryChoice !== CUSTOM_COUNTRY ? knownCities : ALL_CITIES;

  const onCountryChange = (choice: string) => {
    // Drop a city that belonged to the previous country's list; keep custom city text.
    const previousCities = citiesFor(draftCountry(draft));
    const city = previousCities.includes(draft.city) ? '' : draft.city;
    onChange({ ...draft, countryChoice: choice, city });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <section className="card discover-form" aria-labelledby="research-form-title">
      <header className="card__header">
        <div className="card__heading">
          <h2 id="research-form-title" className="card__title">
            Araştırma Kriterleri
          </h2>
          <p className="card__subtitle">Hangi hizmeti, hangi pazarda, hangi şirketlere satmak istediğini tanımla.</p>
        </div>
      </header>
      <div className="card__body">
        <div className="presets">
          <p className="presets__label">Hızlı başlangıç</p>
          <ul className="presets__list">
            {RESEARCH_PRESETS.map((p) => (
              <li key={`${p.sector}-${p.city}-${p.service}`}>
                <button type="button" className="preset-chip" onClick={() => onPreset(p)}>
                  {p.sector} • {p.city} • {SERVICES[p.service].label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <form id={RESEARCH_FORM_ID} className="form-grid" onSubmit={submit} noValidate>
          <FormField id="research-service" label="Hizmet" required error={errors.service}>
            <select
              {...fieldA11y('research-service', errors.service)}
              className="input"
              value={draft.service}
              onChange={(e) => set('service', e.target.value as ServiceKey | '')}
            >
              <option value="">Hizmet seç</option>
              {SERVICE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {SERVICES[s].label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="research-sector"
            label="Sektör"
            required
            error={errors.sector}
            hint="Listeden seç ya da kendi sektörünü yaz."
          >
            <input
              {...fieldA11y('research-sector', errors.sector)}
              className="input"
              list="research-sector-options"
              value={draft.sector}
              placeholder="ör. Dental Klinik, Luxury Real Estate"
              onChange={(e) => set('sector', e.target.value)}
              autoComplete="off"
            />
            <datalist id="research-sector-options">
              {SECTORS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </FormField>

          <FormField id="research-country" label="Ülke" required error={errors.country}>
            <select
              {...fieldA11y('research-country', draft.countryChoice === CUSTOM_COUNTRY ? undefined : errors.country)}
              className="input"
              value={draft.countryChoice}
              onChange={(e) => onCountryChange(e.target.value)}
            >
              <option value="">Ülke seç</option>
              {MARKET_REGION_ORDER.map((region) => (
                <optgroup key={region} label={MARKET_REGIONS[region]}>
                  {COUNTRIES.filter((c) => c.region === region).map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={CUSTOM_COUNTRY}>Diğer (elle yaz)</option>
            </select>
            {draft.countryChoice === CUSTOM_COUNTRY && (
              <input
                {...fieldA11y('research-country-custom', errors.country)}
                className="input"
                aria-label="Ülke adı"
                value={draft.customCountry}
                placeholder="Ülke adı"
                onChange={(e) => set('customCountry', e.target.value)}
                autoFocus
              />
            )}
          </FormField>

          <FormField
            id="research-city"
            label="Şehir"
            hint={draft.city.trim() ? 'Listede yoksa kendin yazabilirsin.' : 'Boş bırakırsan ülke genelinde araştırılır.'}
          >
            <input
              id="research-city"
              className="input"
              list="research-city-options"
              value={draft.city}
              placeholder="Tüm şehirler"
              onChange={(e) => set('city', e.target.value)}
              autoComplete="off"
            />
            <datalist id="research-city-options">
              {citySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>

          <FormField id="research-count" label="Şirket Sayısı" required error={errors.companyCount}>
            <input
              {...fieldA11y('research-count', errors.companyCount)}
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COMPANY_COUNT}
              value={draft.companyCount}
              onChange={(e) => set('companyCount', e.target.value)}
            />
          </FormField>

          <FormField id="research-criteria" label="Aradığım Şirket Profili" className="form-grid__full">
            <textarea
              id="research-criteria"
              className="input textarea"
              rows={2}
              value={draft.criteria}
              placeholder="ör. Birden fazla şubesi olan, yabancı hasta alan, premium segment klinikler"
              onChange={(e) => set('criteria', e.target.value)}
            />
          </FormField>

          <FormField
            id="research-exclusions"
            label="Hariç Tutulacak Şirketler / Kriterler"
            className="form-grid__full"
            hint="Virgülle ayır. Demo modunda yalnızca şirket adı / website eşleşmeleri hariç tutulur."
          >
            <textarea
              id="research-exclusions"
              className="input textarea"
              rows={2}
              value={draft.exclusions}
              placeholder="ör. zincir klinikler, Mayfair Dental Group"
              onChange={(e) => set('exclusions', e.target.value)}
            />
          </FormField>
        </form>
      </div>
    </section>
  );
}
