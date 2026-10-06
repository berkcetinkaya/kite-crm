import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../api/dataApi';
import { customersApi, type CustomerResult, type CustomersApi } from '../../api/customersApi';
import type { Customer } from '../../domain/customers';
import { useCompanies, type LoadState } from '../companies/CompaniesProvider';

export interface CustomersState {
  customers: Customer[];
  loadState: LoadState;
  loadError: string | null;
  customerFor: (companyId: string) => Customer | undefined;
  reload: () => Promise<void>;
  /** Runs one customer API call and applies the confirmed customer and company. */
  run: (call: (api: CustomersApi) => Promise<CustomerResult>) => Promise<Customer>;
}

const CustomersContext = createContext<CustomersState | null>(null);

/**
 * Customers in the browser (Phase 9). Every change is confirmed by the server first; the updated
 * company (history, stage, owner) is applied from its response. Nothing changes on its own.
 */
export function CustomersProvider({ children, api = customersApi }: { children: ReactNode; api?: CustomersApi }) {
  const { upsertCompanies } = useCompanies();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.list();
      setCustomers(r.customers);
      setLoadState('ready');
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
      setLoadState('error');
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<CustomersState>(
    () => ({
      customers,
      loadState,
      loadError,
      customerFor: (companyId) => customers.find((c) => c.companyId === companyId),
      reload,
      run: async (call) => {
        const r = await call(api);
        setCustomers((list) => (list.some((c) => c.id === r.customer.id) ? list.map((c) => (c.id === r.customer.id ? r.customer : c)) : [r.customer, ...list]));
        upsertCompanies([r.company]);
        return r.customer;
      },
    }),
    [customers, loadState, loadError, reload, api, upsertCompanies],
  );

  return <CustomersContext.Provider value={value}>{children}</CustomersContext.Provider>;
}

export function useCustomers(): CustomersState {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error('useCustomers must be used inside CustomersProvider');
  return ctx;
}
