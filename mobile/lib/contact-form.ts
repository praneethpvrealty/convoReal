import { cleanPhoneInput } from './format';
import type { Classification } from './types';

export interface QuickAddInput {
  name: string;
  nameTag: string;
  phone: string;
  email: string;
  classification: Classification;
}

export interface QuickAddPayload {
  name: string;
  name_tag: string | null;
  phone: string | null;
  email: string | null;
  classification: Classification;
}

export function quickAddContactPayload(
  input: QuickAddInput
): { error: string } | { payload: QuickAddPayload } {
  const name = input.name.trim();
  if (!name) return { error: 'Enter the contact’s name' };
  const cleanPhone = input.phone.trim() ? cleanPhoneInput(input.phone) : null;
  const cleanEmail = input.email.trim().toLowerCase();
  if (input.phone.trim() && !cleanPhone) {
    return {
      error: 'Enter a valid phone number (e.g. 9900277111 or +919900277111)',
    };
  }
  if (!cleanPhone && !cleanEmail) {
    return { error: 'Add a phone number or an email' };
  }
  if (cleanEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { error: 'Enter a valid email address' };
  }
  return {
    payload: {
      name,
      name_tag: input.nameTag.trim() || null,
      phone: cleanPhone,
      email: cleanEmail || null,
      classification: input.classification,
    },
  };
}

export type NoteWrite =
  | { kind: 'none' }
  | { kind: 'insert'; text: string }
  | { kind: 'update'; id: string; text: string }
  | { kind: 'delete'; id: string };

export function noteWrite(
  recent: { id: string; note_text: string | null } | null,
  draft: string
): NoteWrite {
  const text = draft.trim();
  if (!recent) return text ? { kind: 'insert', text } : { kind: 'none' };
  if (text === (recent.note_text ?? '').trim()) return { kind: 'none' };
  return text
    ? { kind: 'update', id: recent.id, text }
    : { kind: 'delete', id: recent.id };
}

export function referrerFields(
  original: { referrer?: string | null; referrer_contact_id?: string | null },
  draft: string
): { referrer: string | null; referrer_contact_id: string | null } {
  const referrer = draft.trim() || null;
  const unchanged = referrer === ((original.referrer ?? '').trim() || null);
  return {
    referrer,
    referrer_contact_id: unchanged
      ? (original.referrer_contact_id ?? null)
      : null,
  };
}
