import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { phoneMatchKey, emailMatchKey } from '@/lib/contacts/duplicate-key';

// GET /api/contacts/duplicates
// Returns groups of contacts that share a phone or email, compared on the
// match keys in @/lib/contacts/duplicate-key rather than the stored text.
// Each group has a `reason` ('phone' | 'email') and ≥2 contacts.
// Only non-merged contacts are considered.

export interface DuplicateContact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string | null;
  classification: string | null;
  created_at: string;
  conversation_count: number;
  name_tag?: string | null;
}

export interface DuplicateGroup {
  reason: 'phone' | 'email';
  key: string;   // normalised phone or email
  contacts: DuplicateContact[];
}

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    // Pull all non-merged contacts with phone + email
    const { data: contacts, error } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone, email, source, classification, created_at, name_tag')
      .eq('account_id', ctx.accountId)
      .eq('is_merged', false)
      .not('phone', 'is', null)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    // Build a map: normalised-phone → rows, email → rows
    const phoneMap = new Map<string, typeof contacts>();
    const emailMap = new Map<string, typeof contacts>();

    for (const c of contacts) {
      const phoneKey = phoneMatchKey(c.phone);
      if (phoneKey) {
        const existing = phoneMap.get(phoneKey) ?? [];
        existing.push(c);
        phoneMap.set(phoneKey, existing);
      }
      const emailKey = emailMatchKey(c.email);
      if (emailKey) {
        const existing = emailMap.get(emailKey) ?? [];
        existing.push(c);
        emailMap.set(emailKey, existing);
      }
    }

    // Collect contact IDs already in a phone group to avoid double-listing in email groups
    const inPhoneGroup = new Set<string>();
    const groups: DuplicateGroup[] = [];

    for (const [key, rows] of phoneMap.entries()) {
      if (rows.length < 2) continue;
      rows.forEach((r) => inPhoneGroup.add(r.id));
      groups.push({
        reason: 'phone',
        key,
        contacts: rows.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          source: r.source,
          classification: r.classification,
          created_at: r.created_at,
          conversation_count: 0,
          name_tag: r.name_tag,
        })),
      });
    }

    for (const [key, rows] of emailMap.entries()) {
      if (rows.length < 2) continue;
      // Skip if all contacts are already surfaced in a phone group
      const newRows = rows.filter((r) => !inPhoneGroup.has(r.id));
      if (newRows.length < 2) continue;
      groups.push({
        reason: 'email',
        key,
        contacts: newRows.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          email: r.email,
          source: r.source,
          classification: r.classification,
          created_at: r.created_at,
          conversation_count: 0,
          name_tag: r.name_tag,
        })),
      });
    }

    return NextResponse.json({ groups });
  } catch (err) {
    return toErrorResponse(err);
  }
}
