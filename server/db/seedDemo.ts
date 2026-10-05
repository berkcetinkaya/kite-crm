// Explicit demo seed: `npm run db:seed-demo`. Loads the Phase 2 demo prospects into the database
// configured by KITE_DB_PATH, ONLY when it has no companies yet, so it can never duplicate data or
// mix demo records into a database that already holds real work. Never runs automatically.
import { getMockCompanies } from '../../src/data/mock/companies';
import { migrateCompanySector } from '../../src/state/companies/companyCommands';
import { loadConfig } from '../config';
import { openStore } from './store';

const config = loadConfig();
const store = openStore(config.dbPath);
try {
  const existing = store.companies.list().length;
  if (existing > 0) {
    console.log(`[seed] ${config.dbPath} already has ${existing} companies; nothing was added.`);
  } else {
    const companies = getMockCompanies().map(migrateCompanySector);
    store.transaction(() => companies.forEach((c) => store.companies.insert(c)));
    console.log(`[seed] ${companies.length} demo companies added to ${config.dbPath}.`);
  }
} finally {
  store.close();
}
