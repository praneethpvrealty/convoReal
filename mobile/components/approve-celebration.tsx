import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { SuccessSheet, type SuccessAction } from '@/components/success-sheet';
import { buildPropertyDetailsMessage, type ApproveOutcome } from '@/lib/approve-contact';
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
  const property = outcome?.property;
  const propertyName = property?.title;

  // On re-engage, carry the inquired property into the thread so its
  // details land in the composer ready to send (web opens the property
  // share dialog here; mobile pre-drafts the same message).
  const reengageHref = reengageId
    ? property
      ? `/(app)/conversation/${reengageId}?draftPropertyId=${encodeURIComponent(property.id)}`
      : `/(app)/conversation/${reengageId}`
    : null;

  const message = reengageId
    ? `${name} is in your active contacts. Their 24-hour CRM window has closed — send ${
        propertyName ? `the details for "${propertyName}"` : 'the property details'
      } on WhatsApp, or open the CRM thread to send a template.`
    : outcome?.sent
      ? `The details for ${
          propertyName ? `"${propertyName}"` : 'the property they inquired about'
        } were sent to ${name} on WhatsApp. Follow up on their reply in the chat inbox.`
      : outcome?.error
        ? `${name} is in your active contacts, but auto-sending the property details failed — check the WhatsApp configuration, then follow up from the chat inbox.`
        : `You can now follow up on ${name}'s response in the chat inbox, or engage them with more matching properties.`;

  const actions: SuccessAction[] = reengageId
    ? [
        // Guaranteed delivery: the native deep link opens WhatsApp to
        // the lead with the details pre-filled — no 24h window limit
        // (the CRM free-text send would be rejected here).
        ...(contact && property
          ? [
              {
                icon: 'logo-whatsapp' as const,
                label: 'Send on WhatsApp',
                onPress: () => {
                  onClose();
                  const phone = contact.phone.replace(/\D/g, '');
                  const text = encodeURIComponent(buildPropertyDetailsMessage(property));
                  Linking.openURL(`https://wa.me/${phone}?text=${text}`);
                },
              },
            ]
          : []),
        {
          icon: 'chatbubbles' as const,
          label: 'Open CRM thread',
          onPress: () => {
            onClose();
            if (reengageHref) router.push(reengageHref);
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
