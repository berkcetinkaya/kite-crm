// Versioned schema migrations. Each migration runs once, in order, inside a transaction, and is
// recorded in schema_migrations. Never edit a migration that has shipped: add a new one.
// Enumerations are written out literally so a migration never changes meaning later; a test checks
// they still match the domain constants (a new status needs a new migration).
import { transaction, type Db } from './sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /**
   * Table rebuilds (SQLite cannot drop a constraint in place) run with foreign key enforcement off,
   * as SQLite's documented ALTER TABLE procedure requires; integrity is verified with
   * PRAGMA foreign_key_check before the migration commits.
   */
  foreignKeysOff?: boolean;
}

const SALES_STATUSES = `'found','researched','first_contact','replied','meeting','proposal','awaiting_decision','client','disqualified','not_interested','later','lost'`;
const COMPANY_SOURCES = `'manual','research','referral','google_maps','linkedin','instagram','inbound','event'`;
const COMPANY_SIZES = `'1-10','11-50','51-200','201-500','500+'`;
const SERVICES = `'crm','website','google_ads','meta_ads','social_media','creative','seo'`;
const LEVELS = `'high','medium','low'`;
const RESEARCH_STATUSES = `'draft','ready','running','completed','failed'`;
const RESULT_STATUSES = `'demo','discovered','analyzed','failed','existing','excluded'`;
const DRAFT_STATUSES = `'review','draft','approved'`;
const OUTBOUND_STATUSES = `'sending','sent','failed','ambiguous'`;
const FOLLOW_UP_SEQUENCE_STATUSES = `'active','paused','completed_replied','completed_no_reply','stopped'`;
const FOLLOW_UP_STEP_STATUSES = `'pending','scheduled','prepared','approved','sent','skipped','cancelled'`;
const FOLLOW_UP_CANCEL_REASONS = `'reply','stopped','status'`;
const FOLLOW_UP_PAUSE_REASONS = `'settings_disabled','status_later'`;

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
  {
    version: 2,
    name: 'gmail_outreach',
    // Operational mail history only. OAuth credentials are NEVER stored in this database (they live
    // in the encrypted credential store, see server/gmail/credentialStore.ts).
    sql: `
-- One row per send attempt. subject/body are the immutable snapshot of what was submitted.
CREATE TABLE outbound_messages (
  id               TEXT PRIMARY KEY,
  idempotency_key  TEXT NOT NULL UNIQUE,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  draft_id         TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  contact_id       TEXT,                  -- contacts are rewritten on save; the address is snapshotted below
  revision_key     TEXT NOT NULL,
  recipient_email  TEXT NOT NULL,
  recipient_name   TEXT,
  from_email       TEXT,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  service          TEXT NOT NULL CHECK (service IN (${SERVICES})),
  language         TEXT NOT NULL CHECK (language IN ('tr','en')),
  provider         TEXT NOT NULL CHECK (provider IN ('gmail','fixture')),
  status           TEXT NOT NULL CHECK (status IN (${OUTBOUND_STATUSES})),
  gmail_message_id TEXT,
  gmail_thread_id  TEXT,
  rfc_message_id   TEXT,
  error_code       TEXT,
  error_message    TEXT,
  resolution       TEXT CHECK (resolution IS NULL OR resolution IN ('reconciled','marked_not_sent','interrupted')),
  attempted_at     TEXT NOT NULL,
  sent_at          TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (status <> 'sent' OR (gmail_message_id IS NOT NULL AND gmail_thread_id IS NOT NULL AND sent_at IS NOT NULL))
);
-- Duplicate protection at the storage level: a draft can have at most one send that is in flight,
-- confirmed or unresolved. Only a confirmed failure frees the draft for another attempt.
CREATE UNIQUE INDEX outbound_one_active_per_draft ON outbound_messages(draft_id) WHERE status IN ('sending','sent','ambiguous');
CREATE UNIQUE INDEX outbound_gmail_message ON outbound_messages(gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX outbound_company ON outbound_messages(company_id);
CREATE INDEX outbound_thread ON outbound_messages(gmail_thread_id);

-- Messages of KITE Gmail threads: KITE's own send and the replies found by synchronization.
CREATE TABLE mail_messages (
  id               TEXT PRIMARY KEY,
  outbound_id      TEXT NOT NULL REFERENCES outbound_messages(id) ON DELETE CASCADE,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  gmail_thread_id  TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL UNIQUE,  -- de-duplication key for synchronization
  rfc_message_id   TEXT,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_email       TEXT NOT NULL,
  from_name        TEXT,
  to_json          TEXT NOT NULL CHECK (json_valid(to_json)),
  cc_json          TEXT NOT NULL CHECK (json_valid(cc_json)),
  subject          TEXT NOT NULL,
  body_text        TEXT NOT NULL,
  snippet          TEXT NOT NULL,
  message_at       TEXT NOT NULL,
  synced_at        TEXT NOT NULL,
  attachments_json TEXT NOT NULL CHECK (json_valid(attachments_json))
);
CREATE INDEX mail_messages_company ON mail_messages(company_id, message_at);
CREATE INDEX mail_messages_thread ON mail_messages(gmail_thread_id);

CREATE TABLE mail_sync_runs (
  id              TEXT PRIMARY KEY,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('running','ok','partial','failed')),
  threads_checked INTEGER NOT NULL DEFAULT 0,
  new_replies     INTEGER NOT NULL DEFAULT 0,
  error_code      TEXT,
  error_message   TEXT
);
CREATE INDEX mail_sync_runs_started ON mail_sync_runs(started_at);
`,
  },
  {
    version: 3,
    name: 'follow_ups',
    // Additive for existing data: no sequence is created for historical sends (Berk creates those
    // explicitly with "Takip Planı Oluştur"). mail_drafts is rebuilt because its UNIQUE(company_id)
    // allowed only one draft per company; first contact drafts keep that rule through a partial
    // unique index, and each follow up step gets its own draft row.
    foreignKeysOff: true,
    sql: `
-- Operational configuration (not secrets). Follow up cadence lives under key 'follow_up'.
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE follow_up_sequences (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  initial_outbound_id TEXT NOT NULL UNIQUE REFERENCES outbound_messages(id) ON DELETE RESTRICT, -- one sequence per first contact send
  original_draft_id   TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  contact_id          TEXT,
  recipient_email     TEXT NOT NULL,       -- snapshot of the original confirmed send
  recipient_name      TEXT,
  subject             TEXT NOT NULL,       -- the conversation's subject, continued by every follow up
  service             TEXT NOT NULL CHECK (service IN (${SERVICES})),
  language            TEXT NOT NULL CHECK (language IN ('tr','en')),
  gmail_thread_id     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (${FOLLOW_UP_SEQUENCE_STATUSES})),
  current_step        INTEGER CHECK (current_step IS NULL OR current_step BETWEEN 1 AND 3),
  max_steps           INTEGER NOT NULL CHECK (max_steps BETWEEN 1 AND 3),
  origin              TEXT NOT NULL CHECK (origin IN ('automatic','manual')),
  pause_reason        TEXT CHECK (pause_reason IS NULL OR pause_reason IN (${FOLLOW_UP_PAUSE_REASONS})),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT,
  stopped_at          TEXT,
  stop_reason         TEXT,
  stopped_by          TEXT CHECK (stopped_by IS NULL OR stopped_by IN ('berk','system')),
  CHECK (status <> 'paused' OR pause_reason IS NOT NULL),
  CHECK (status <> 'stopped' OR stopped_at IS NOT NULL)
);
CREATE INDEX follow_up_sequences_company ON follow_up_sequences(company_id);
CREATE INDEX follow_up_sequences_thread ON follow_up_sequences(gmail_thread_id);

-- Every step of a sequence is created with the sequence; only the next step after a confirmed
-- event gets a due date. Due dates are UTC timestamps.
CREATE TABLE follow_up_steps (
  id                  TEXT PRIMARY KEY,
  sequence_id         TEXT NOT NULL REFERENCES follow_up_sequences(id) ON DELETE CASCADE,
  step_number         INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 3),
  delay_days          INTEGER NOT NULL CHECK (delay_days BETWEEN 1 AND 365),
  due_at              TEXT,
  original_due_at     TEXT,
  status              TEXT NOT NULL CHECK (status IN (${FOLLOW_UP_STEP_STATUSES})),
  draft_id            TEXT UNIQUE REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  outbound_message_id TEXT UNIQUE REFERENCES outbound_messages(id) ON DELETE RESTRICT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  prepared_at         TEXT,
  approved_at         TEXT,
  sent_at             TEXT,
  skipped_at          TEXT,
  postponed_at        TEXT,
  cancelled_at        TEXT,
  cancel_reason       TEXT CHECK (cancel_reason IS NULL OR cancel_reason IN (${FOLLOW_UP_CANCEL_REASONS})),
  UNIQUE (sequence_id, step_number),
  CHECK (status <> 'sent' OR (outbound_message_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status NOT IN ('scheduled','prepared','approved') OR due_at IS NOT NULL),
  CHECK (status NOT IN ('prepared','approved') OR draft_id IS NOT NULL)
);
-- Never two current steps in one sequence.
CREATE UNIQUE INDEX follow_up_one_current_step ON follow_up_steps(sequence_id) WHERE status IN ('scheduled','prepared','approved');

-- mail_drafts rebuild (same columns + follow up link).
CREATE TABLE mail_drafts_v3 (
  id                      TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL DEFAULT 'first_contact' CHECK (kind IN ('first_contact','follow_up')),
  follow_up_sequence_id   TEXT REFERENCES follow_up_sequences(id) ON DELETE RESTRICT,
  follow_up_step_number   INTEGER CHECK (follow_up_step_number IS NULL OR follow_up_step_number BETWEEN 1 AND 3),
  follows_outbound_id     TEXT REFERENCES outbound_messages(id) ON DELETE RESTRICT,
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
  approved_at             TEXT,
  CHECK (
    (kind = 'first_contact' AND follow_up_sequence_id IS NULL AND follow_up_step_number IS NULL AND follows_outbound_id IS NULL)
    OR (kind = 'follow_up' AND follow_up_sequence_id IS NOT NULL AND follow_up_step_number IS NOT NULL AND follows_outbound_id IS NOT NULL)
  )
);
INSERT INTO mail_drafts_v3 (id, company_id, kind, contact_id, service, language, subject_options_json, selected_subject, body, status, research_job_id,
  evidence_refs_json, sector_context_json, generation_notes_json, edited_since_generation, created_at, updated_at, generated_at, approved_at)
  SELECT id, company_id, 'first_contact', contact_id, service, language, subject_options_json, selected_subject, body, status, research_job_id,
  evidence_refs_json, sector_context_json, generation_notes_json, edited_since_generation, created_at, updated_at, generated_at, approved_at FROM mail_drafts;
DROP TABLE mail_drafts;
ALTER TABLE mail_drafts_v3 RENAME TO mail_drafts;
-- One first contact draft per company (the Phase 5 rule), one draft per follow up step.
CREATE UNIQUE INDEX mail_drafts_first_contact_company ON mail_drafts(company_id) WHERE kind = 'first_contact';
CREATE UNIQUE INDEX mail_drafts_follow_up_step ON mail_drafts(follow_up_sequence_id, follow_up_step_number) WHERE kind = 'follow_up';
CREATE INDEX mail_drafts_company ON mail_drafts(company_id);
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
    // PRAGMA foreign_keys has no effect inside a transaction, so it is switched around it.
    if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(m.sql);
        if (m.foreignKeysOff) {
          const broken = db.prepare('PRAGMA foreign_key_check').all();
          if (broken.length) throw new Error(`migration ${m.version} left ${broken.length} broken foreign key reference(s)`);
        }
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
      });
    } finally {
      if (m.foreignKeysOff) db.exec('PRAGMA foreign_keys = ON');
    }
    applied.push(m.version);
  }
  const version = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  return { applied, version };
}
