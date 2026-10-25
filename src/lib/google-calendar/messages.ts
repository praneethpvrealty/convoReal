export const GOOGLE_CALENDAR_ERROR_MESSAGES: Record<string, string> = {
  not_configured: 'Google Calendar sync is not set up on this server yet.',
  consent_denied: 'Google sign-in was cancelled.',
  no_refresh_token:
    'Google did not grant offline access. Try connecting again.',
  scope_denied:
    'Allow ConvoReal to manage its own calendar to turn on syncing.',
  account_mismatch:
    'That Google sign-in was started from a different ConvoReal account.',
  state_mismatch: 'That sign-in link is not valid for your account. Try again.',
  state_expired: 'The Google sign-in took too long. Try again.',
  connection_failed: 'Could not connect Google Calendar. Try again.',
};

export function googleCalendarErrorMessage(code: string): string {
  return (
    GOOGLE_CALENDAR_ERROR_MESSAGES[code] ??
    GOOGLE_CALENDAR_ERROR_MESSAGES.connection_failed
  );
}
