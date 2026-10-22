import { describe, expect, it } from 'vitest';
import {
  emailLeadsSkippedKey,
  onboardingDismissedKey,
  setupAllDone,
  setupSteps,
} from './checklist';

const fresh = {
  hasWhatsApp: false,
  hasProperties: false,
  hasContacts: false,
  hasEmailLeadSync: false,
};

describe('setup checklist [ONB-001]', () => {
  it('lists the four setup steps in order with their completion', () => {
    expect(setupSteps({ ...fresh, hasContacts: true }, false)).toEqual([
      { id: 'whatsapp', done: false },
      { id: 'property', done: false },
      { id: 'contact', done: true },
      { id: 'email-leads', done: false },
    ]);
  });

  it('treats skipped portal leads as done', () => {
    expect(setupSteps(fresh, true)[3]).toEqual({
      id: 'email-leads',
      done: true,
    });
    expect(
      setupAllDone(
        {
          hasWhatsApp: true,
          hasProperties: true,
          hasContacts: true,
          hasEmailLeadSync: false,
        },
        true
      )
    ).toBe(true);
    expect(
      setupAllDone(
        {
          hasWhatsApp: true,
          hasProperties: true,
          hasContacts: true,
          hasEmailLeadSync: false,
        },
        false
      )
    ).toBe(false);
  });

  it('keys dismissal per account', () => {
    expect(onboardingDismissedKey('acc-1')).toBe('onboarding_dismissed_acc-1');
    expect(emailLeadsSkippedKey('acc-1')).toBe(
      'onboarding_email_leads_skipped_acc-1'
    );
  });
});
