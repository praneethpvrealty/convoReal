import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appointmentsKey,
  calendarKey,
  todosKey,
} from '@/lib/calendar/calendar-fetch';
import { isPersistedQueryKey } from './cache-persistence';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('[ACC-011] the persisted prefixes are the keys the screens use', () => {
  it('covers the calendar reads', () => {
    expect(isPersistedQueryKey(calendarKey('acct-1'))).toBe(true);
    expect(isPersistedQueryKey(appointmentsKey('acct-1'))).toBe(true);
    expect(isPersistedQueryKey(todosKey('acct-1'))).toBe(true);
  });

  it('covers the inventory list, overview and match counts, and not the buyer list', () => {
    const inventory = read(
      'src/app/(dashboard)/inventory/inventory-content.tsx'
    );
    for (const key of [
      "['inventory', 'list',",
      "['inventory', 'overview',",
      "['inventory', 'match-counts',",
    ]) {
      expect(inventory).toContain(key);
    }
    expect(isPersistedQueryKey(['inventory', 'list', 'page=0'])).toBe(true);
    expect(isPersistedQueryKey(['inventory', 'overview', 'acct-1'])).toBe(true);
    expect(isPersistedQueryKey(['inventory', 'match-counts', 'acct-1'])).toBe(
      true
    );
    expect(isPersistedQueryKey(['inventory', 'match-contacts', 'acct-1'])).toBe(
      false
    );
    expect(isPersistedQueryKey(['inventory', 'map', 'page=0'])).toBe(false);
  });

  it('covers the contacts list and tags', () => {
    const contacts = read('src/app/(dashboard)/contacts/contacts-content.tsx');
    expect(contacts).toContain("['contacts', 'list', listParams]");
    expect(contacts).toContain("['contacts', 'tags']");
    expect(isPersistedQueryKey(['contacts', 'list', {}])).toBe(true);
    expect(isPersistedQueryKey(['contacts', 'tags'])).toBe(true);
  });
});
