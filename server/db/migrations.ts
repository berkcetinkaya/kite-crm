// Versioned schema migrations. Each migration runs once, in order, inside a transaction, and is
// recorded in schema_migrations. Never edit a migration that has shipped: add a new one.
// Enumerations are written out literally so a migration never changes meaning later; a test checks
// they still match the domain constants (a new status needs a new migration).
import { transaction, type Db } from './sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const SALES_STATUSES = `'found','researched','first_contact','replied','meeting','proposal','awaiting_decision','client','disqualified','not_interested','later','lost'`;
const COMPANY_SOURCES = `'manual','research','referral','google_maps','linkedin','instagram','inbound','event'`;
const COMPANY_SIZES = `'1-10','11-50','51-200','201-500','500+'`;
const SERVICES = `'crm','website','google_ads','meta_ads','social_media','creative','seo'`;
const LEVELS = `'high','medium','low'`;
const RESEARCH_STATUSES = `'draft','ready','running','completed','failed'`;
const RESULT_STATUSES = `'demo','discovered','analyzed','failed','existing','excluded'`;
const DRAFT_STATUSES = `'review','draft','approved'`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
-- ---------- Companies (Potansiyel Müşteriler) ----------
CREATE TABLE companies (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  website            TEXT,
  website_host       TEXT,                 -- normalized host for duplicate matching
  name_key           TEXT NOT NULL,        -- folded name for duplicate matching
  sector             TEXT NOT NULL,        -- Turkish label or custom text
  sector_id          TEXT,                 -- catalogue sector id, NULL for custom sectors
  city               TEXT NOT NULL DEFAULT '',
  country            TEXT NOT NULL,
  country_key        TEXT NOT NULL,        -- canonical country (ISO code when known)
  company_size       TEXT CHECK (company_size IS NULL OR company_size IN (${COMPANY_SIZES})),
  source             TEXT NOT NULL CHECK (source IN (${COMPANY_SOURCES})),
  owner              TEXT,
  status             TEXT NOT NULL CHECK (status IN (${SALES_STATUSES})),
  opportunity_score  INTEGER CHECK (opportunity_score IS NULL OR opportunity_score BETWEEN 0 AND 100),
  last_contact_at    TEXT,
  next_action_label  TEXT,
  next_action_due_at TEXT,
  research_job_id    TEXT,                 -- research job that created the company (provenance)
  research_ref_json  TEXT CHECK (research_ref_json IS NULL OR json_valid(research_ref_json)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX companies_website_host ON companies(website_host);
CREATE INDEX companies_status ON companies(status);
CREATE INDEX companies_country_key ON companies(country_key);
CREATE INDEX companies_sector_id ON companies(sector_id);
CREATE INDEX companies_name_country ON companies(name_key, country_key);

CREATE TABLE company_contacts (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  full_name         TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT '',
  email             TEXT,
  phone             TEXT,
  linkedin          TEXT,
  is_decision_maker INTEGER NOT NULL DEFAULT 0 CHECK (is_decision_maker IN (0, 1)),
  confidence        TEXT NOT NULL CHECK (confidence IN (${LEVELS}))
);
CREATE INDEX company_contacts_company ON company_contacts(company_id);

CREATE TABLE company_notes (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  content    TEXT NOT NULL,
  author     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX company_notes_company ON company_notes(company_id);

CREATE TABLE company_history (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL,
  description TEXT NOT NULL,
  author      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX company_history_company ON company_history(company_id);

CREATE TABLE company_opportunities (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  service    TEXT NOT NULL CHECK (service IN (${SERVICES})),
  score      INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  potential  TEXT CHECK (potential IS NULL OR potential IN (${LEVELS})),
  reason     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, service)
);

-- ---------- Research (Yeni Müşteri Bul) ----------
CREATE TABLE research_jobs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('demo','real')),
  provider      TEXT CHECK (provider IS NULL OR provider IN ('anthropic','fixture')),
  status        TEXT NOT NULL CHECK (status IN (${RESEARCH_STATUSES})),
  service       TEXT NOT NULL CHECK (service IN (${SERVICES})),
  sector        TEXT NOT NULL,
  sector_id     TEXT,
  country       TEXT NOT NULL,
  country_code  TEXT,
  city          TEXT,
  company_count INTEGER NOT NULL CHECK (company_count BETWEEN 1 AND 100),
  criteria      TEXT NOT NULL DEFAULT '',
  exclusions    TEXT NOT NULL DEFAULT '',
  result_count  INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT CHECK (progress_json IS NULL OR json_valid(progress_json)),
  error_message TEXT,
  cancelled     INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT
);
CREATE INDEX research_jobs_created_at ON research_jobs(created_at);

CREATE TABLE research_results (
  id                      TEXT PRIMARY KEY,
  job_id                  TEXT NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  position                INTEGER NOT NULL,
  company_name            TEXT NOT NULL,
  website                 TEXT,
  website_host            TEXT,
  sector                  TEXT NOT NULL,
  city                    TEXT,
  country                 TEXT NOT NULL,
  source                  TEXT NOT NULL CHECK (source IN ('demo','web')),
  service                 TEXT NOT NULL CHECK (service IN (${SERVICES})),
  opportunity_score       INTEGER CHECK (opportunity_score IS NULL OR opportunity_score BETWEEN 0 AND 100),
  reason                  TEXT NOT NULL DEFAULT '',
  company_size            TEXT CHECK (company_size IS NULL OR company_size IN (${COMPANY_SIZES})),
  confidence              TEXT NOT NULL CHECK (confidence IN (${LEVELS})),
  selected                INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  already_in_prospects    INTEGER NOT NULL DEFAULT 0 CHECK (already_in_prospects IN (0, 1)),
  transferred_company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
  research_status         TEXT NOT NULL CHECK (research_status IN (${RESULT_STATUSES})),
  verification_status     TEXT CHECK (verification_status IS NULL OR verification_status IN ('verified','partial','unverified')),
  verification_confidence TEXT CHECK (verification_confidence IS NULL OR verification_confidence IN (${LEVELS})),
  rank_score              REAL,
  analysis_error          TEXT,
  -- Evidence-based research snapshot: discovery, verification, evidence, analysis,
  -- serviceOpportunities (all services and signals), contactHints, technical.
  snapshot_json           TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at              TEXT NOT NULL
);
CREATE INDEX research_results_job ON research_results(job_id, position);
CREATE INDEX research_results_transferred ON research_results(transferred_company_id);

-- ---------- Mail drafts (Mail & Takip) ----------
CREATE TABLE mail_drafts (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE, -- one active draft per company
  contact_id              TEXT,
  service                 TEXT NOT NULL CHECK (service IN (${SERVICES})),
  language                TEXT NOT NULL CHECK (language IN ('tr','en')),
  subject_options_json    TEXT NOT NULL CHECK (json_valid(subject_options_json)),
  selected_subject        TEXT NOT NULL,
  body                    TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN (${DRAFT_STATUSES})),
  research_job_id         TEXT,
  evidence_refs_json      TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
  sector_context_json     TEXT NOT NULL CHECK (json_valid(sector_context_json)),
  generation_notes_json   TEXT NOT NULL CHECK (json_valid(generation_notes_json)),
  edited_since_generation INTEGER NOT NULL DEFAULT 0 CHECK (edited_since_generation IN (0, 1)),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  generated_at            TEXT NOT NULL,
  approved_at             TEXT
);

CREATE TABLE mail_draft_versions (
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,          -- 0 = newest
  subject  TEXT NOT NULL,
  body     TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  reason   TEXT NOT NULL CHECK (reason IN ('before_regeneration')),
  PRIMARY KEY (draft_id, position)
);
`,
  },
];

/** Applies every pending migration. Safe to call on every start (idempotent). */
export function runMigrations(db: Db, migrations: readonly Migration[] = MIGRATIONS): { applied: number[]; version: number } {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const done = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    });
    applied.push(m.version);
  }
  const version = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  return { applied, version };
}
