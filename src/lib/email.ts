// Email address and phone helpers shared by the browser forms and the server validators.

/** Plain, conservative address check. KITE never guesses or builds addresses. */
export function isValidEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  return v.length <= 254 && /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(v) && !v.includes('..');
}

/** Free-form phone: trimmed, inner whitespace collapsed to single spaces; empty → null. */
export function normalizePhone(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
}
