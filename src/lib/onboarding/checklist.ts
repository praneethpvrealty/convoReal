export interface OnboardingStatus {
  hasWhatsApp: boolean;
  hasProperties: boolean;
  hasContacts: boolean;
  hasEmailLeadSync: boolean;
}

export type SetupStepId = 'whatsapp' | 'property' | 'contact' | 'email-leads';

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
}

export function setupSteps(
  status: OnboardingStatus,
  emailLeadsSkipped: boolean
): SetupStep[] {
  return [
    { id: 'whatsapp', done: status.hasWhatsApp },
    { id: 'property', done: status.hasProperties },
    { id: 'contact', done: status.hasContacts },
    { id: 'email-leads', done: status.hasEmailLeadSync || emailLeadsSkipped },
  ];
}

export function setupAllDone(
  status: OnboardingStatus,
  emailLeadsSkipped: boolean
): boolean {
  return setupSteps(status, emailLeadsSkipped).every((step) => step.done);
}

export function onboardingDismissedKey(accountId: string): string {
  return `onboarding_dismissed_${accountId}`;
}

export function emailLeadsSkippedKey(accountId: string): string {
  return `onboarding_email_leads_skipped_${accountId}`;
}
