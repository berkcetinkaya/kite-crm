// Opens the KITE database, applies migrations and wires the repositories.
import { runMigrations } from './migrations';
import { createCompanyRepository } from './repositories/companies';
import { createMailDraftRepository } from './repositories/mailDrafts';
import { createResearchRepository } from './repositories/research';
import type { Store } from './repositories/types';
import { openDatabase, transaction, type Db } from './sqlite';

export type { Store } from './repositories/types';

export interface OpenedStore extends Store {
  db: Db;
  schemaVersion: number;
  close(): void;
}

export function createStore(db: Db): Store {
  return {
    companies: createCompanyRepository(db),
    research: createResearchRepository(db),
    mail: createMailDraftRepository(db),
    transaction: (fn) => transaction(db, fn),
  };
}

/** Opens the file (":memory:" for tests), migrates it and returns the repositories. */
export function openStore(file: string): OpenedStore {
  const db = openDatabase(file);
  const { version } = runMigrations(db);
  return { ...createStore(db), db, schemaVersion: version, close: () => db.close() };
}
