// ============================================================
// Whose name to show, and which part of it.
//
// The profile's display name is what the user actually set, so it wins
// everywhere. Falling straight to the email local part produced
// "Praneethpvrealty" for a user whose profile said "Praneeth" — the
// address is an account identifier, not a name, and is only a last
// resort.
// ============================================================

/** Full name for a profile card: the whole display name. */
export function resolveDisplayName(
  fullName?: string | null,
  email?: string | null
): string {
  const named = fullName?.trim();
  if (named) return named;
  const local = email?.split('@')[0]?.trim();
  return local ? capitalize(local) : 'Account';
}

/**
 * First name for a greeting ("Hi, Praneeth"). Takes the leading word of
 * the display name, or the leading segment of an email local part —
 * praneeth.kumar@ and praneeth_kumar@ both give "Praneeth".
 */
export function resolveGreetingName(
  fullName?: string | null,
  email?: string | null
): string {
  const named = fullName?.trim();
  if (named) {
    const first = named.split(/\s+/)[0];
    if (first) return capitalize(first);
  }
  const local = email?.split('@')[0]?.trim();
  if (local) {
    const first = local.split(/[._-]/)[0];
    if (first) return capitalize(first);
  }
  return 'there';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
