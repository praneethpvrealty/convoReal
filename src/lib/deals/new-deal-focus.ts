import type { SupabaseClient } from '@supabase/supabase-js';

import { placeJourneyCompartment } from '@/lib/journey/compartment-store';
import type { JourneyOverviewMode } from '@/lib/journey/overview-state';

export interface NewDealFocusSubject {
  mode: JourneyOverviewMode;
  subjectId: string;
}

export function newDealFocusSubject(deal: {
  contact_id: string | null;
  property_id: string | null;
}): NewDealFocusSubject | null {
  if (deal.contact_id) return { mode: 'buyer', subjectId: deal.contact_id };
  if (deal.property_id) {
    return { mode: 'property', subjectId: deal.property_id };
  }
  return null;
}

export async function focusNewDealJourney(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    userId: string;
    deal: { contact_id: string | null; property_id: string | null };
  }
): Promise<NewDealFocusSubject | null> {
  const subject = newDealFocusSubject(input.deal);
  if (!subject) return null;
  const { data, error } = await supabase
    .from(subject.mode === 'buyer' ? 'contacts' : 'properties')
    .select('id')
    .eq('id', subject.subjectId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await placeJourneyCompartment(supabase, {
    accountId: input.accountId,
    userId: input.userId,
    mode: subject.mode,
    subjectId: subject.subjectId,
    compartment: 'focus',
  });
  return subject;
}
