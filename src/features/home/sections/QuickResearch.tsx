import { useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import {
  researchCompanyCounts,
  researchLocations,
  researchSectors,
  researchServices,
} from '../../../data/mock/research';
import { SERVICES, type ServiceKey } from '../../../domain/services';
import { DEFAULT_COUNTRY } from '../../../domain/company';
import { discoverHref } from '../../discover/prefill';

export function QuickResearch() {
  const [service, setService] = useState<ServiceKey>(researchServices[0]);
  const [sector, setSector] = useState<string>(researchSectors[0]);
  const [location, setLocation] = useState<string>(researchLocations[0]);
  const [count, setCount] = useState<number>(20);

  // Opens Yeni Müşteri Bul with these values filled in; research starts there after review.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const city = location === 'Türkiye geneli' ? '' : location.replace(/\s*\(.*\)$/, '');
    window.location.hash = discoverHref({ service, sector, country: DEFAULT_COUNTRY, city, companyCount: count });
  };

  return (
    <Card
      title="Hızlı Araştırma Başlat"
      subtitle="Hedef kitleyi seç, araştırma motoru uygun şirketleri bulsun."
      action={<Badge tone="accent">Önizleme</Badge>}
    >
      <form className="research-form" onSubmit={onSubmit}>
        <label className="field">
          <span className="field__label">Hizmet</span>
          <select className="input" value={service} onChange={(e) => setService(e.target.value as ServiceKey)}>
            {researchServices.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Sektör</span>
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}>
            {researchSectors.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Lokasyon</span>
          <select className="input" value={location} onChange={(e) => setLocation(e.target.value)}>
            {researchLocations.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Şirket Sayısı</span>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {researchCompanyCounts.map((n) => (
              <option key={n} value={n}>
                {n} şirket
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button--primary research-form__submit">
          <Sparkles size={16} aria-hidden="true" />
          Araştırmayı Başlat
        </button>
      </form>
    </Card>
  );
}
