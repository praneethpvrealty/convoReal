/**
 * Translate raw Postgres/Supabase/API error strings into copy a
 * field agent can act on. Backend messages like "new row violates
 * row-level security policy" should never reach the screen verbatim.
 */
export function friendlyError(message: string): string {
  if (/row-level security|violates.*policy|permission denied/i.test(message)) {
    return "You don't have permission for this — ask your workspace owner.";
  }
  if (/duplicate key|already exists/i.test(message)) {
    return 'This already exists — check for a duplicate entry.';
  }
  if (/network request failed|fetch failed|timeout|abort/i.test(message)) {
    return 'Network problem — check your connection and try again.';
  }
  if (/jwt|token.*expired|not signed in/i.test(message)) {
    return 'Your session expired — sign in again.';
  }
  return message;
}
