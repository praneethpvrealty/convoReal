import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260919143000_merge_contact_conversations.sql'
  ),
  'utf8'
);

describe('contact conversation merge', () => {
  it('[CTM-001] moves both message histories before deleting the old thread', () => {
    const moveMessages = migration.indexOf('UPDATE messages');
    const moveReactions = migration.indexOf('UPDATE message_reactions');
    const deleteConversation = migration.indexOf(
      'DELETE FROM conversations WHERE id = v_source.id'
    );

    expect(moveMessages).toBeGreaterThan(-1);
    expect(moveReactions).toBeGreaterThan(moveMessages);
    expect(deleteConversation).toBeGreaterThan(moveReactions);
    expect(migration).toContain(
      'last_customer_message_at = v_last_customer_at'
    );
    expect(migration).toContain('target_contact_id = p_target_contact_id');
  });
});
