import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  phoneMatchKey,
  emailMatchKey,
  nameMatchKey,
  namesAreSimilar,
} from '@/lib/contacts/duplicate-key';
import { pairKey, isGroupDismissed } from '@/lib/contacts/duplicate-dismissal';

// GET /api/contacts/duplicates
// Returns groups of contacts that share a phone, an email, or a name,
// compared on the match keys in @/lib/contacts/duplicate-key rather than
// the stored text. Each group has a `reason` ('phone' | 'email' | 'name')
// and ≥2 contacts. Name groups are the weakest signal and are only
// reported for contacts no stronger signal already covers.
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
  // Carried so the panel can show what actually differs between two
  // records. Deciding a merge on name and source alone is how an Owner
  // gets merged into a Buyer who only shares their name.
  status?: string | null;
  company?: string | null;
  second_name?: string | null;
  requirements?: string | null;
  min_budget?: number | null;
  max_budget?: number | null;
  areas_of_interest?: string[] | null;
  property_interests?: string[] | null;
  last_contacted_at?: string | null;
}

export interface DuplicateGroup {
  reason: 'phone' | 'email' | 'name';
  key: string;   // match key, or the representative name for a name group
  contacts: DuplicateContact[];
}

type ContactRow = {
  id: string; name: string | null; phone: string; email: string | null;
  source: string | null; classification: string | null; created_at: string;
  name_tag: string | null; status: string | null; company: string | null;
  second_name: string | null; requirements: string | null;
  min_budget: number | null; max_budget: number | null;
  areas_of_interest: string[] | null; property_interests: string[] | null;
  last_contacted_at: string | null;
};

function toDuplicateContact(r: ContactRow): DuplicateContact {
  return { ...r, conversation_count: 0 };
}

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    // Pull all non-merged contacts with phone + email
    const { data: contacts, error } = await ctx.supabase
      .from('contacts')
      // One literal, not a concatenation: the client infers the row type
      // from the select string, and joining it loses that.
      // prettier-ignore
      .select('id, name, phone, email, source, classification, created_at, name_tag, status, company, second_name, requirements, min_budget, max_budget, areas_of_interest, property_interests, last_contacted_at')
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
        contacts: rows.map(toDuplicateContact),
      });
    }

    const surfaced = new Set(inPhoneGroup);

    for (const [key, rows] of emailMap.entries()) {
      if (rows.length < 2) continue;
      // Skip if all contacts are already surfaced in a phone group
      const newRows = rows.filter((r) => !inPhoneGroup.has(r.id));
      if (newRows.length < 2) continue;
      newRows.forEach((r) => surfaced.add(r.id));
      groups.push({
        reason: 'email',
        key,
        contacts: newRows.map(toDuplicateContact),
      });
    }

    // Same person, different number. Only for contacts no stronger signal
    // has already accounted for — a pair that shares a phone is a better
    // find, and listing it twice would just cost the reader a second look.
    const nameMap = new Map<string, typeof contacts>();
    for (const c of contacts) {
      if (surfaced.has(c.id)) continue;
      const key = nameMatchKey(c.name);
      if (!key) continue;
      const existing = nameMap.get(key) ?? [];
      existing.push(c);
      nameMap.set(key, existing);
    }

    // Fold near-identical keys together so a typo does not split a pair.
    // Clustering the distinct keys rather than the contacts keeps this off
    // the quadratic path an account with thousands of contacts would feel.
    const clusters: { keys: string[]; rows: typeof contacts }[] = [];
    for (const [key, rows] of nameMap.entries()) {
      const match = clusters.find((cl) => cl.keys.some((k) => namesAreSimilar(k, key)));
      if (match) {
        match.keys.push(key);
        match.rows.push(...rows);
      } else {
        clusters.push({ keys: [key], rows: [...rows] });
      }
    }

    for (const cluster of clusters) {
      if (cluster.rows.length < 2) continue;
      groups.push({
        reason: 'name',
        key: cluster.rows[0].name ?? cluster.keys[0],
        contacts: cluster.rows.map(toDuplicateContact),
      });
    }

    // Drop anything already ruled on. Filtered here rather than in the
    // grouping so a dismissed pair still counts as "surfaced" — it must
    // not fall through and be offered again under a weaker reason.
    const { data: dismissals } = await ctx.supabase
      .from('contact_duplicate_dismissals')
      .select('contact_a_id, contact_b_id')
      .eq('account_id', ctx.accountId);

    const dismissed = new Set(
      (dismissals ?? []).map((d) => pairKey(d.contact_a_id, d.contact_b_id)),
    );

    return NextResponse.json({
      groups: groups.filter(
        (g) => !isGroupDismissed(g.contacts.map((c) => c.id), dismissed),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
