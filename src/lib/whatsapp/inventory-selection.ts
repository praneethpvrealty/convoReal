import type { SupabaseClient } from '@supabase/supabase-js';

import { categoryForType } from '@/lib/inventory-summary-builder';

export type InventorySelectionCategory =
  | 'Residential'
  | 'Commercial'
  | 'Agricultural';

export interface InventorySelectionCommand {
  category: InventorySelectionCategory;
  ordinals: number[];
}

export const MAX_INVENTORY_SELECTIONS = 3;

const CATEGORY_ALIASES: Array<{
  pattern: RegExp;
  category: InventorySelectionCategory;
}> = [
  { pattern: /\bcommercial\b/i, category: 'Commercial' },
  { pattern: /\bresidential\b/i, category: 'Residential' },
  {
    pattern:
      /\b(?:agricultural|agriculture|agri|farm(?:\s*&?\s*land)?|farmland)\b/i,
    category: 'Agricultural',
  },
];

const COMMAND_PREFIX =
  /^(?:(?:please|send|share|show|open|give|get|need|want|me|the|full|complete|details?|links?|showcase|for|of|from|looking)\s*)*$/i;
const NUMBER_PREFIX =
  /^(?:(?:properties|listings|options?|items?|numbers?|nos?\.?)\s*)*/i;
const NUMBER_RUN = /^\d{1,2}(?:\s*(?:,|&|\+|\/|and)\s*\d{1,2})*\s*[.!]?$/i;

export function parseInventorySelectionCommand(
  text?: string | null
): InventorySelectionCommand | null {
  const value = (text || '').trim();
  if (!value) return null;

  for (const alias of CATEGORY_ALIASES) {
    const match = alias.pattern.exec(value);
    if (!match) continue;

    const prefix = value.slice(0, match.index).trim();
    if (prefix && !COMMAND_PREFIX.test(prefix)) return null;

    const suffix = value
      .slice(match.index + match[0].length)
      .trim()
      .replace(NUMBER_PREFIX, '')
      .trim();
    if (!NUMBER_RUN.test(suffix)) return null;

    const ordinals = [...new Set((suffix.match(/\d{1,2}/g) || []).map(Number))];
    if (ordinals.length === 0 || ordinals.some((ordinal) => ordinal < 1)) {
      return null;
    }
    return { category: alias.category, ordinals };
  }

  return null;
}

interface InventorySummaryEntry {
  category: InventorySelectionCategory;
  ordinal: number;
  title: string;
}

const CATEGORY_HEADER = /^\*(RESIDENTIAL|COMMERCIAL|AGRICULTURAL)\*$/i;
const ENTRY = /^\s*(\d{1,2})\.\s+\*([^*]+)\*/;

export function parseInventorySummaryEntries(
  text?: string | null
): InventorySummaryEntry[] {
  const entries: InventorySummaryEntry[] = [];
  let category: InventorySelectionCategory | null = null;

  for (const line of (text || '').split('\n')) {
    const header = line.trim().match(CATEGORY_HEADER);
    if (header) {
      const label = `${header[1][0].toUpperCase()}${header[1].slice(1).toLowerCase()}`;
      category = label as InventorySelectionCategory;
      continue;
    }
    if (!category) continue;
    const entry = line.match(ENTRY);
    if (!entry) continue;
    entries.push({
      category,
      ordinal: Number(entry[1]),
      title: entry[2].trim(),
    });
  }

  return entries;
}

export async function resolveInventorySelectionReference(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  command: InventorySelectionCommand
): Promise<string[]> {
  const { data: recentMessages } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['bot', 'agent'])
    .not('content_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(12);

  let entries: InventorySummaryEntry[] = [];
  for (const row of recentMessages || []) {
    const parsed = parseInventorySummaryEntries(row.content_text as string);
    if (parsed.some((entry) => entry.category === command.category)) {
      entries = parsed;
      break;
    }
  }

  const wanted = command.ordinals
    .map((ordinal) =>
      entries.find(
        (entry) =>
          entry.category === command.category && entry.ordinal === ordinal
      )
    )
    .filter((entry): entry is InventorySummaryEntry => Boolean(entry));
  if (wanted.length !== command.ordinals.length) return [];

  const titles = wanted.map((entry) => entry.title);
  const { data: candidates } = await db
    .from('properties')
    .select('id, title, type')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available')
    .in('title', titles);

  const byTitle = new Map<string, string[]>();
  for (const row of candidates || []) {
    if (categoryForType(row.type as string | null) !== command.category) {
      continue;
    }
    const title = row.title as string;
    byTitle.set(title, [...(byTitle.get(title) || []), row.id as string]);
  }

  const ids = wanted.map((entry) => {
    const matches = byTitle.get(entry.title) || [];
    return matches.length === 1 ? matches[0] : null;
  });
  return ids.every((id): id is string => Boolean(id)) ? ids : [];
}
