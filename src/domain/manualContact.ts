// "E-posta ekle": an email address the user found themselves (website, call, business card) saved as a
// normal company contact. The contacts list stays the only home of recipient addresses; this only
// decides whether the address becomes a new contact, fills an existing contact that has no address,
// or is already there.
import { isValidEmail } from '../lib/email';
import { containsSecret, NO_SECRETS_WARNING } from './customers';
import { GENERAL_CONTACT_NAME, GENERAL_CONTACT_ROLE, isGeneralContact, type Company, type Contact } from './company';

export interface ManualEmailInput {
  email: string;
  /** Empty = the company's general address ("Genel iletişim"), e.g. info@ or hello@. */
  fullName: string;
  role: string;
}

/** Contact fields without the id (same shape as the contact endpoint's input). */
export type ManualContactFields = Omit<Contact, 'id'>;

export type ManualEmailPlan =
  | { kind: 'invalid'; field: 'email' | 'fullName' | 'role'; message: string }
  /** The company already has this address: reuse that contact, save nothing. */
  | { kind: 'existing'; contact: Contact }
  /** A contact with the same name (or the general contact) has no address yet: fill it in. */
  | { kind: 'update'; contact: Contact }
  | { kind: 'add'; contact: ManualContactFields };

export const sameEmail = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export const contactWithEmail = (company: Pick<Company, 'contacts'>, email: string): Contact | null =>
  company.contacts.find((c) => sameEmail(c.email, email)) ?? null;

export const hasValidEmailContact = (company: Pick<Company, 'contacts'>): boolean => company.contacts.some((c) => isValidEmail(c.email));

export function planManualEmail(company: Pick<Company, 'contacts'>, input: ManualEmailInput): ManualEmailPlan {
  const email = input.email.trim();
  const fullName = input.fullName.trim();
  const role = input.role.trim();
  if (!email) return { kind: 'invalid', field: 'email', message: 'E-posta adresi zorunlu.' };
  if (containsSecret(email) || !isValidEmail(email)) return { kind: 'invalid', field: 'email', message: 'Geçerli bir e-posta adresi gir.' };
  if (containsSecret(fullName)) return { kind: 'invalid', field: 'fullName', message: NO_SECRETS_WARNING };
  if (containsSecret(role)) return { kind: 'invalid', field: 'role', message: NO_SECRETS_WARNING };
  if (fullName.length > 120) return { kind: 'invalid', field: 'fullName', message: 'Ad soyad en fazla 120 karakter olabilir.' };
  if (role.length > 120) return { kind: 'invalid', field: 'role', message: 'Pozisyon en fazla 120 karakter olabilir.' };

  const existing = contactWithEmail(company, email);
  if (existing) return { kind: 'existing', contact: existing };

  const general = !fullName || fullName.toLocaleLowerCase('tr') === GENERAL_CONTACT_NAME.toLocaleLowerCase('tr');
  const name = general ? GENERAL_CONTACT_NAME : fullName;
  const blank = company.contacts.find(
    (c) => !c.email?.trim() && (general ? isGeneralContact(c) : c.fullName.trim().toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')),
  );
  if (blank) return { kind: 'update', contact: { ...blank, email, role: role || blank.role } };

  return {
    kind: 'add',
    contact: {
      fullName: name,
      role: role || (general ? GENERAL_CONTACT_ROLE : ''),
      email,
      phone: null,
      linkedin: null,
      isDecisionMaker: false,
      // Same levels the app already uses: a company's own general address is 'high' (as when a
      // company is created with one), a person entered by hand is 'medium' (the contact form default).
      confidence: general ? 'high' : 'medium',
    },
  };
}
