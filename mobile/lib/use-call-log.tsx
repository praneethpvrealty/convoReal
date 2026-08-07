import * as Linking from 'expo-linking';

import { useAppDialog } from '@/components/app-dialog';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';

/** The outcomes worth one tap. The fuller vocabulary (voicemail, wrong
 *  number, callback) stays on the web Calls tab. */
type QuickOutcome = 'connected' | 'no_answer' | 'busy';

/**
 * Dial, then ask how it went.
 *
 * The OS gives the app nothing back from the dialer — no connected
 * flag, no duration — so the outcome comes from the agent: the prompt
 * is raised at dial time and waits for their return to the app.
 * Logging server-side also bumps Last Contacted.
 *
 * Lifted out of the contact detail screen, which had it inline, so
 * every place that dials logs the same way rather than some calls
 * landing on the contact's record and others vanishing.
 *
 * Render `<AppDialog {...callLogProps} />` alongside the caller's own
 * dialog, if it has one — only one is ever visible at a time.
 */
export function useCallLog() {
  const { show, close, dialogProps } = useAppDialog();

  async function save(
    contactId: string,
    outcome: QuickOutcome,
    calledAt: string,
  ) {
    close();
    try {
      await apiFetch(`/api/contacts/${contactId}/calls`, {
        method: 'POST',
        body: JSON.stringify({
          direction: 'outbound',
          outcome,
          called_at: calledAt,
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not log call',
        message: friendlyError(err instanceof Error ? err.message : 'Try again.'),
      });
    }
  }

  function startCall(contact: {
    id: string;
    name?: string | null;
    phone: string;
  }) {
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
          onPress: () => save(contact.id, 'connected', dialedAt),
        },
        {
          label: 'No answer',
          onPress: () => save(contact.id, 'no_answer', dialedAt),
        },
        { label: 'Busy', onPress: () => save(contact.id, 'busy', dialedAt) },
        { label: 'Skip', variant: 'muted', onPress: close },
      ],
    });
  }

  return { startCall, callLogProps: dialogProps };
}
