// Server-side credential store for the Gmail OAuth grant. Credentials NEVER go into the operational
// SQLite database, browser storage or logs. The single-user KITE setup keeps one encrypted file
// (AES-256-GCM, authenticated) under the git-ignored data/ directory; the 32-byte key comes from
// KITE_CREDENTIALS_KEY and is never written anywhere. A deployed version can replace this module
// with a secret manager behind the same interface.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredGmailCredential {
  provider: 'gmail' | 'fixture';
  /** Connected Google account address (shown in Ayarlar). */
  email: string;
  /** Long-lived grant. Only ever held in server memory and in the encrypted file. */
  refreshToken: string;
  scope: string;
  connectedAt: string;
}

export interface CredentialStore {
  read(): Promise<StoredGmailCredential | null>;
  write(credential: StoredGmailCredential): Promise<void>;
  delete(): Promise<void>;
}

export type CredentialErrorCode = 'key_missing' | 'unreadable';

export class CredentialError extends Error {
  constructor(public readonly code: CredentialErrorCode) {
    super(code === 'key_missing' ? 'credential encryption key missing or invalid' : 'stored credential cannot be decrypted');
    this.name = 'CredentialError';
  }
}

const AAD = Buffer.from('kite-os/gmail-credential/v1');

/** Accepts a 32-byte key as base64 (44 chars) or hex (64 chars). Anything else is rejected. */
export function parseCredentialsKey(raw: string | null | undefined): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) {
    const buf = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return buf.length === 32 ? buf : null;
  }
  return null;
}

interface Envelope {
  v: 1;
  alg: 'A256GCM';
  iv: string;
  tag: string;
  ct: string;
}

export function encryptCredential(key: Buffer, credential: StoredGmailCredential): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(JSON.stringify(credential), 'utf8'), cipher.final()]);
  const envelope: Envelope = { v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  return JSON.stringify(envelope);
}

export function decryptCredential(key: Buffer, text: string): StoredGmailCredential {
  try {
    const e = JSON.parse(text) as Envelope;
    if (e.v !== 1 || e.alg !== 'A256GCM') throw new Error('format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(e.ct, 'base64')), decipher.final()]).toString('utf8');
    const c = JSON.parse(plain) as StoredGmailCredential;
    if (typeof c.refreshToken !== 'string' || typeof c.email !== 'string') throw new Error('shape');
    return c;
  } catch {
    // Wrong key, tampered file or unknown format: fail safely, never return partial data.
    throw new CredentialError('unreadable');
  }
}

/** Encrypted single-file store. `rawKey` is KITE_CREDENTIALS_KEY; a missing/invalid key fails safely. */
export function createFileCredentialStore(file: string, rawKey: string | null): CredentialStore {
  const key = parseCredentialsKey(rawKey);
  const requireKey = () => {
    if (!key) throw new CredentialError('key_missing');
    return key;
  };
  return {
    async read() {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
      return decryptCredential(requireKey(), text);
    },
    async write(credential) {
      const k = requireKey();
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, encryptCredential(k, credential), { mode: 0o600 });
      await rename(tmp, file);
    },
    async delete() {
      await rm(file, { force: true });
    },
  };
}

/** In-memory store for tests. */
export function createMemoryCredentialStore(initial: StoredGmailCredential | null = null): CredentialStore & { peek(): StoredGmailCredential | null } {
  let value = initial;
  return {
    read: async () => value,
    write: async (c) => {
      value = c;
    },
    delete: async () => {
      value = null;
    },
    peek: () => value,
  };
}
