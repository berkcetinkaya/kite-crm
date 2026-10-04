import { useId } from 'react';
import { SalesStatusOptions } from '../../../components/sales/SalesStatusOptions';
import type { Company } from '../../../domain/company';
import { SALES_STATUS, type SalesStatus } from '../../../domain/salesStatus';
import { useToast } from '../../../components/ui/Toast';
import { useCompanies } from '../../../state/companies/CompaniesProvider';

/** Changes the sales status immediately; history, counts and the list badge follow from state. */
export function StatusSelect({ company }: { company: Company }) {
  const { changeStatus } = useCompanies();
  const showToast = useToast();
  const id = useId();

  const onChange = (status: SalesStatus) => {
    changeStatus(company.id, status);
    showToast({ title: 'Durum güncellendi', description: `${company.name}: ${SALES_STATUS[status].label}` });
  };

  return (
    <div className="status-select">
      <label htmlFor={id} className="field__label">
        Durumu değiştir
      </label>
      <select id={id} className="input" value={company.status} onChange={(e) => onChange(e.target.value as SalesStatus)}>
        <SalesStatusOptions />
      </select>
    </div>
  );
}
