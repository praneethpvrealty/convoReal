import { useCallback, useState } from 'react';

import { PropertyPicker } from '@/components/agent-detail';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import type { Contact } from '@/lib/types';
import { approveListingPrompt } from '@shared/lib/contacts/approve-listing-prompt';

/**
 * Approving a lead with no linked listing sends them nothing, so the
 * agent is asked which listing it was first. `approve` receives the
 * listing they picked, or none when they approve without one.
 */
export function useApproveListingPrompt(
  approve: (contact: Contact, propertyId?: string) => void
) {
  const { show, close, dialogProps } = useAppDialog();
  const [picking, setPicking] = useState<Contact | null>(null);

  const requestApprove = useCallback(
    (contact: Contact) => {
      const prompt = approveListingPrompt(contact);
      if (!prompt) {
        approve(contact);
        return;
      }
      show({
        title: prompt.title,
        message: prompt.message,
        actions: [
          { label: 'Cancel', variant: 'muted', onPress: close },
          {
            label: prompt.skipLabel,
            onPress: () => {
              close();
              approve(contact);
            },
          },
          {
            label: prompt.pickLabel,
            variant: 'primary',
            onPress: () => {
              close();
              setPicking(contact);
            },
          },
        ],
      });
    },
    [approve, show, close]
  );

  const element = (
    <>
      <AppDialog {...dialogProps} />
      <PropertyPicker
        visible={picking !== null}
        excludeIds={[]}
        onClose={() => setPicking(null)}
        onSelect={(propertyId) => {
          const contact = picking;
          setPicking(null);
          if (contact) approve(contact, propertyId);
        }}
        title="Which listing did they enquire about?"
        actionLabel="Approve"
      />
    </>
  );

  return { requestApprove, element };
}
