// SQLite connection for the KITE server, using Node's built-in node:sqlite (no native add-on to
// compile). This is the only module that touches the driver; everything else uses `Db`, so moving
// to another SQLite driver (or a hosted database behind the repositories) stays a local change.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/**
 * Opens (and creates if needed) the database file with integrity settings:
 * foreign keys enforced, WAL journal for safe concurrent reads, a busy timeout instead of
 * immediate "database is locked" errors, and NORMAL sync (safe with WAL).
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}

const depth = new WeakMap<Db, number>();

/**
 * Runs `fn` in one transaction: everything is committed together or nothing is. Nested calls join
 * the outer transaction (repositories call each other inside service-level transactions).
 */
export function transaction<T>(db: Db, fn: () => T): T {
  if ((depth.get(db) ?? 0) > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth.set(db, 0);
  }
}

let savepoints = 0;

/**
 * Runs `fn` inside a SAVEPOINT of the current transaction. If `fn` throws, only its own writes are
 * rolled back and the error is returned instead of thrown, so the surrounding transaction can still
 * commit (e.g. a confirmed Gmail send is recorded even if its follow up plan cannot be created).
 */
export function savepoint<T>(db: Db, fn: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  const name = `sp_${++savepoints}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const value = fn();
    db.exec(`RELEASE ${name}`);
    return { ok: true, value };
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    return { ok: false, error };
  }
}

/** JSON column helpers: snapshots are stored as validated JSON text. */
export const toJson = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
export function fromJson<T>(v: unknown): T | undefined {
  return typeof v === 'string' ? (JSON.parse(v) as T) : undefined;
}
