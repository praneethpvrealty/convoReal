import { normalisePhone, normaliseEmail } from '@/lib/contacts/find-or-create';

// The last-10 rule: the same person saved once from a WhatsApp webhook and
// once by hand is usually +919876543210 against 9876543210, which are two
// different digit strings and so were never grouped. Indian mobile numbers
// are 10 digits, so the trailing 10 are what identify the subscriber and
// anything in front is a country or trunk prefix.
//
// This only decides what to *offer* for merging — a person still confirms
// each merge — so pairing too eagerly costs a dismissed suggestion, while
// pairing too strictly costs a duplicate nobody is told about.
const SUBSCRIBER_DIGITS = 10;
const MIN_DIGITS = 7;

export function phoneMatchKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = normalisePhone(phone);
  if (digits.length < MIN_DIGITS) return null;
  return digits.length > SUBSCRIBER_DIGITS ? digits.slice(-SUBSCRIBER_DIGITS) : digits;
}

export function emailMatchKey(email: string | null): string | null {
  if (!email) return null;
  const normalised = normaliseEmail(email);
  return normalised.length > 0 ? normalised : null;
}
