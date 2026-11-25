import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';

import { useAppDialog } from '@/components/app-dialog';
import { TextField } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import {
  CALL_FOLLOW_UP_EVENT_TYPE,
  SCHEDULED_CALL_EVENT_TYPE,
  callFollowUpTitle,
  callLogPayload,
  scheduledCallTitle,
  type QuickCallOutcome,
} from '@shared/lib/contacts/call-follow-up';

interface DialedContact {
  id: string;
  name?: string | null;
  phone: string;
}

interface DialOptions {
  onLogged?: (outcome: QuickCallOutcome) => void;
}

/**
 * Call now or schedule the call, and after a dial ask how it went.
 *
 * Schedule call opens a new Call event for the contact, so a call can
 * be planned for later straight from the call button.
 * The OS gives the app nothing back from the dialer — no connected
 * flag, no duration — so the outcome comes from the agent: the prompt
 * is raised at dial time and waits for their return to the app.
 * Connected opens a second step for notes and an optional follow-up
 * event; the fuller vocabulary (voicemail, wrong number, callback)
 * stays on the web Calls tab. Logging server-side also bumps Last
 * Contacted.
 *
 * Render `<AppDialog {...callLogProps} />` alongside the caller's own
 * dialog, if it has one — only one is ever visible at a time.
 */
export function useCallLog() {
  const { show, close, dialogProps } = useAppDialog();
  const [connected, setConnected] = useState<{
    contact: DialedContact;
    dialedAt: string;
    options: DialOptions;
  } | null>(null);
  const [notes, setNotes] = useState('');

  async function save(
    contactId: string,
    outcome: QuickCallOutcome,
    calledAt: string,
    callNotes = '',
    options: DialOptions = {}
  ): Promise<boolean> {
    close();
    setConnected(null);
    setNotes('');
    try {
      await apiFetch(`/api/contacts/${contactId}/calls`, {
        method: 'POST',
        body: JSON.stringify(
          callLogPayload({ outcome, calledAt, notes: callNotes })
        ),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      options.onLogged?.(outcome);
      return true;
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not log call',
        message: friendlyError(
          err instanceof Error ? err.message : 'Try again.'
        ),
      });
      return false;
    }
  }

  function openEvent(contact: DialedContact, eventType: string, title: string) {
    router.push({
      pathname: '/(app)/appointment-new',
      params: {
        contactId: contact.id,
        contactName: contact.name ?? '',
        contactPhone: contact.phone,
        eventType,
        title,
      },
    });
  }

  async function saveConnected(addEvent: boolean) {
    if (!connected) return;
    const { contact, dialedAt, options } = connected;
    const ok = await save(contact.id, 'connected', dialedAt, notes, options);
    if (!ok || !addEvent) return;
    openEvent(contact, CALL_FOLLOW_UP_EVENT_TYPE, callFollowUpTitle(contact));
  }

  function startCall(contact: DialedContact) {
    haptic.tap();
    show({
      title: `Call ${contact.name || contact.phone}?`,
      message: contact.phone,
      actions: [
        {
          label: 'Schedule call',
          onPress: () => {
            close();
            openEvent(
              contact,
              SCHEDULED_CALL_EVENT_TYPE,
              scheduledCallTitle(contact)
            );
          },
        },
        {
          label: 'Call now',
          variant: 'primary',
          onPress: () => dial(contact),
        },
      ],
    });
  }

  function dial(contact: DialedContact, options: DialOptions = {}) {
    const dialedAt = new Date().toISOString();
    haptic.tap();
    Linking.openURL(`tel:${contact.phone}`);
    show({
      title: 'Log this call?',
      message: `${contact.name || contact.phone} · ${contact.phone}`,
      actions: [
        {
          label: 'Connected',
          variant: 'primary',
          onPress: () => {
            close();
            setNotes('');
            setConnected({ contact, dialedAt, options });
          },
        },
        {
          label: 'No answer',
          onPress: () => save(contact.id, 'no_answer', dialedAt, '', options),
        },
        {
          label: 'Busy',
          onPress: () => save(contact.id, 'busy', dialedAt, '', options),
        },
        { label: 'Skip', variant: 'muted', onPress: close },
      ],
    });
  }

  const callLogProps = connected
    ? {
        visible: true,
        onClose: () => saveConnected(false),
        title: 'Call connected',
        message: `${connected.contact.name || connected.contact.phone} · Add notes or plan the next step.`,
        actions: [
          { label: 'Add event', onPress: () => saveConnected(true) },
          {
            label: 'Save',
            variant: 'primary' as const,
            onPress: () => saveConnected(false),
          },
        ],
        children: (
          <TextField
            placeholder="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            autoFocus
          />
        ),
      }
    : dialogProps;

  return { startCall, dial, callLogProps };
}
