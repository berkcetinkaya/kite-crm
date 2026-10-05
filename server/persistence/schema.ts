// Small validation combinators for persistence payloads. Every value from the browser goes through
// one of these before it reaches a repository: types, enums, lengths and nesting are checked, and
// unknown keys are dropped. Errors carry the path (for logs) and a Turkish message (for the UI).

export class DataError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'not_found' | 'conflict',
    /** Turkish, user-facing. */
    public readonly userMessage: string,
    detail = userMessage,
  ) {
    super(detail);
    this.name = 'DataError';
  }
}

export type Validator<T> = (value: unknown, path: string) => T;

const fail = (path: string, what: string): never => {
  throw new DataError('invalid_request', 'Gönderilen bilgiler geçersiz.', `${path}: ${what}`);
};

export const str =
  (max: number, opts: { min?: number; trim?: boolean } = {}): Validator<string> =>
  (v, p) => {
    if (typeof v !== 'string') return fail(p, 'must be a string');
    const s = opts.trim === false ? v : v.trim();
    if (s.length < (opts.min ?? 0)) return fail(p, 'is required');
    if (s.length > max) return fail(p, `longer than ${max}`);
    return s;
  };

export const nullable =
  <T,>(inner: Validator<T>): Validator<T | null> =>
  (v, p) =>
    v === null || v === undefined ? null : inner(v, p);

export const optional =
  <T,>(inner: Validator<T>): Validator<T | undefined> =>
  (v, p) =>
    v === undefined ? undefined : inner(v, p);

export const bool: Validator<boolean> = (v, p) => (typeof v === 'boolean' ? v : fail(p, 'must be a boolean'));

export const num =
  (min: number, max: number, opts: { int?: boolean } = {}): Validator<number> =>
  (v, p) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(p, 'must be a number');
    if (opts.int && !Number.isInteger(v)) return fail(p, 'must be an integer');
    if (v < min || v > max) return fail(p, `out of range ${min}..${max}`);
    return v;
  };

export const oneOf =
  <T extends string>(values: readonly T[]): Validator<T> =>
  (v, p) =>
    (values as readonly unknown[]).includes(v) ? (v as T) : fail(p, `must be one of ${values.join(', ')}`);

export const arr =
  <T,>(item: Validator<T>, max: number): Validator<T[]> =>
  (v, p) => {
    if (!Array.isArray(v)) return fail(p, 'must be an array');
    if (v.length > max) return fail(p, `more than ${max} items`);
    return v.map((x, i) => item(x, `${p}[${i}]`));
  };

/** Object with a known shape; keys not in the shape are dropped, undefined results are omitted. */
export const obj =
  <S extends Record<string, Validator<unknown>>>(shape: S): Validator<{ [K in keyof S]: ReturnType<S[K]> }> =>
  (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'must be an object');
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, check] of Object.entries(shape)) {
      const value = check(src[k], `${p}.${k}`);
      if (value !== undefined) out[k] = value;
    }
    return out as { [K in keyof S]: ReturnType<S[K]> };
  };

/** Stable ids issued by KITE ("cmp_…", "res_…"); never arbitrary strings. */
export const id: Validator<string> = (v, p) =>
  typeof v === 'string' && /^[a-z]{2,8}_[a-z0-9_]{1,60}$/i.test(v) ? v : fail(p, 'invalid id');

/** ISO 8601 timestamp. */
export const isoDate: Validator<string> = (v, p) =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : fail(p, 'invalid date');

/** http(s) URL (stored, never fetched from here). */
export const httpUrl: Validator<string> = (v, p) => {
  const s = str(500, { min: 1 })(v, p);
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail(p, 'must be http(s)');
  } catch {
    return fail(p, 'invalid url');
  }
  return s;
};

/** Parses a JSON body field with a validator; the root path is "body". */
export function parse<T>(validator: Validator<T>, value: unknown): T {
  return validator(value, 'body');
}
