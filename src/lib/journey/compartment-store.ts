import type { SupabaseClient } from '@supabase/supabase-js';

import {
  journeyCompartmentOwner,
  journeyCompartmentScopeOf,
  type JourneyCompartment,
  type JourneyCompartmentScope,
} from './compartments';
import type { JourneyOverviewMode } from './overview-state';

export async function accountJourneyCompartmentScope(
  supabase: SupabaseClient,
  accountId: string
): Promise<JourneyCompartmentScope> {
  const { data, error } = await supabase
    .from('accounts')
    .select('journey_compartment_scope')
    .eq('id', accountId)
    .single();
  if (error) throw error;
  return journeyCompartmentScopeOf(data?.journey_compartment_scope);
}

export async function placeJourneyCompartment(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    userId: string;
    mode: JourneyOverviewMode;
    subjectId: string;
    compartment: JourneyCompartment;
  }
): Promise<JourneyCompartmentScope> {
  const scope = await accountJourneyCompartmentScope(supabase, input.accountId);
  const { error } = await supabase.from('journey_compartments').upsert(
    {
      account_id: input.accountId,
      mode: input.mode,
      subject_id: input.subjectId,
      user_id: journeyCompartmentOwner(scope, input.userId),
      compartment: input.compartment,
      created_by: input.userId,
    },
    { onConflict: 'account_id,mode,subject_id,user_id' }
  );
  if (error) throw error;
  return scope;
}
