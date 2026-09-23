import { Stack, useLocalSearchParams } from 'expo-router';

import { GuidanceValueScreen } from '@/components/guidance-value-screen';
import { useAppConfig } from '@/lib/use-app-config';

export default function GuidanceValueRoute() {
  const { propertyId, dealId } = useLocalSearchParams<{
    propertyId?: string;
    dealId?: string;
  }>();
  const cost = useAppConfig()?.ai_costs?.guidance_value_lookup;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Guidance value' }} />
      <GuidanceValueScreen
        creditCost={cost ?? null}
        propertyId={propertyId ?? null}
        dealId={dealId ?? null}
        canSave
      />
    </>
  );
}
