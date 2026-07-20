import { router } from 'expo-router';

import { SuccessSheet, type SuccessAction } from '@/components/success-sheet';
import type { ApproveOutcome } from '@/lib/approve-contact';
import { openContactChat } from '@/lib/open-chat';
import type { Contact } from '@/lib/types';

export interface ApproveCelebrationState {
  contact: Contact;
  outcome: ApproveOutcome;
}

/**
 * Celebration for a just-approved contact, shared by the contacts
 * list and the contact detail screen: same copy, same next-action
 * funnel (chat inbox / more properties), template fallback when the
 * 24-hour window has closed.
 */
export function ApproveCelebration({
  celebration,
  onClose,
}: {
  celebration: ApproveCelebrationState | null;
  onClose: () => void;
}) {
  const contact = celebration?.contact;
  const outcome = celebration?.outcome;
  const name = contact ? contact.name || contact.phone : '';
  const reengageId = outcome?.reengageConversationId;

  const message = reengageId
    ? `${name} is in your active contacts. Their 24-hour WhatsApp window has closed — open the thread to send the property details as a template, then follow up on their reply in the chat inbox.`
    : outcome?.error
      ? `${name} is in your active contacts, but auto-sending the property details failed — check the WhatsApp configuration, then follow up from the chat inbox.`
      : `You can now follow up on ${name}'s response in the chat inbox, or engage them with more matching properties.`;

  const actions: SuccessAction[] = reengageId
    ? [
        {
          icon: 'chatbubbles',
          label: 'Open thread',
          onPress: () => {
            onClose();
            router.push(`/(app)/conversation/${reengageId}`);
          },
        },
      ]
    : contact
      ? [
          {
            icon: 'chatbubbles',
            label: 'Follow up in inbox',
            onPress: () => {
              onClose();
              openContactChat(contact);
            },
          },
          {
            icon: 'business-outline',
            label: 'Share more properties',
            onPress: () => {
              onClose();
              router.push('/(app)/(tabs)/properties');
            },
          },
        ]
      : [];

  return (
    <SuccessSheet
      visible={celebration !== null}
      onClose={onClose}
      title={`${name} is now active`}
      message={message}
      confetti={!outcome?.error}
      actions={actions}
    />
  );
}
