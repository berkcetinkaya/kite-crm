import { describe, expect, it } from 'vitest';
import { GENERAL_CONTACT_NAME, GENERAL_CONTACT_ROLE, type Contact } from './company';
import { hasValidEmailContact, planManualEmail } from './manualContact';
import { describe as historyText } from '../state/companies/events';

const contact = (over: Partial<Contact> = {}): Contact => ({ id: 'ct_1', fullName: 'Dr. Ece Aydın', role: 'Klinik Müdürü', email: null, phone: '0232 000 00 00', linkedin: null, isDecisionMaker: true, confidence: 'high', ...over });
const plan = (contacts: Contact[], email: string, fullName = '', role = '') => planManualEmail({ contacts }, { email, fullName, role });

describe('E-posta ekle (manual email → contact)', () => {
  it('a generic address without a person becomes the general contact', () => {
    expect(plan([], ' info@akmclinic.com ')).toEqual({
      kind: 'add',
      contact: { fullName: GENERAL_CONTACT_NAME, role: GENERAL_CONTACT_ROLE, email: 'info@akmclinic.com', phone: null, linkedin: null, isDecisionMaker: false, confidence: 'high' },
    });
  });

  it('a named person with an address becomes a normal contact', () => {
    expect(plan([], 'ece@akmclinic.com', ' Ece Aydın ', 'Klinik Müdürü')).toMatchObject({ kind: 'add', contact: { fullName: 'Ece Aydın', role: 'Klinik Müdürü', email: 'ece@akmclinic.com', confidence: 'medium', isDecisionMaker: false } });
  });

  it('an address the company already has is reused, never duplicated (case and spaces ignored)', () => {
    const existing = contact({ email: 'Info@AkmClinic.com' });
    expect(plan([existing], 'info@akmclinic.com ', 'Başka İsim')).toEqual({ kind: 'existing', contact: existing });
  });

  it('fills in a contact that has no address yet instead of adding a second one', () => {
    const general = contact({ id: 'ct_g', fullName: GENERAL_CONTACT_NAME, role: GENERAL_CONTACT_ROLE, isDecisionMaker: false });
    expect(plan([general], 'info@akmclinic.com')).toEqual({ kind: 'update', contact: { ...general, email: 'info@akmclinic.com' } });
    const ece = contact();
    expect(plan([ece], 'ece@akmclinic.com', 'dr. ece aydın')).toEqual({ kind: 'update', contact: { ...ece, email: 'ece@akmclinic.com' } });
  });

  it('refuses missing, invalid and credential-like input', () => {
    expect(plan([], '  ')).toMatchObject({ kind: 'invalid', field: 'email' });
    for (const bad of ['info@', 'info akm@clinic.com', 'info@@akm.com', 'a..b@akm.com', 'info@akm', 'password=hunter2'])
      expect(plan([], bad), bad).toMatchObject({ kind: 'invalid', field: 'email' });
    expect(plan([], 'info@akm.com', 'api_key: sk-123')).toMatchObject({ kind: 'invalid', field: 'fullName' });
    expect(plan([], 'info@akm.com', '', 'token=abc')).toMatchObject({ kind: 'invalid', field: 'role' });
  });

  it('knows when a company still needs an address', () => {
    expect(hasValidEmailContact({ contacts: [contact()] })).toBe(false);
    expect(hasValidEmailContact({ contacts: [contact({ email: 'not-an-email' })] })).toBe(false);
    expect(hasValidEmailContact({ contacts: [contact({ email: 'ece@akm.com' })] })).toBe(true);
  });

  it('history marks contacts entered by hand', () => {
    expect(historyText.contactAdded('Genel iletişim', true)).toBe('İletişim kişisi eklendi (manuel): Genel iletişim');
    expect(historyText.contactAdded('Ece')).toBe('İletişim kişisi eklendi: Ece');
  });
});
