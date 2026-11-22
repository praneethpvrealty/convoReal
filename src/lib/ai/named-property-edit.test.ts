import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  formatNamedEditPrompt,
  parseNamedPropertyEdit,
  pendingNamedEditTarget,
  NAMED_EDIT_PROMPT,
} from './named-property-edit';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

const property = {
  id: 'p1',
  title: 'Shop on 100 Feet Road',
  property_code: 'PROP-2680',
  listing_type: 'Rent',
  status: 'Available',
  price: 45000,
  rental_income: null,
  maintenance: null,
  advance: 300000,
  gst: 18,
  floor_tenancies: [],
};

function clientFor(
  latest: {
    message_id: string;
    content_text: string;
    created_at: string;
  } | null,
  target: { entity_type: string; entity_id: string } | null
) {
  return {
    from: (table: string) => {
      const result =
        table === 'messages'
          ? { data: latest, error: null }
          : { data: target, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit']) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => result;
      return chain;
    },
  } as never;
}

describe('[INB-053] an edit that names its listing by code', () => {
  it('reads the code from an edit instruction however it is phrased', () => {
    for (const text of [
      'Need to update the rental details of PROP-2680.',
      'update PROP-2680 rent to 45k',
      'Change the price of property PROP 2680 to 1.2 cr',
      'Please edit the listing prop2680',
      'mark PROP-2680 as rented',
      'correct the maintenance and advance for PROP-2680',
    ]) {
      expect(parseNamedPropertyEdit(text)).toBe('PROP-2680');
    }
  });

  it('leaves a message that only mentions a code to the other readers', () => {
    for (const text of [
      'Surya will speak to the chairman on PROP-1138',
      'Update: Surya visited PROP-1138 and liked it',
      'He wants to change his budget after seeing PROP-1138',
      'Site visit tomorrow 4pm for PROP-2680',
      'update the rent of PROP-2680 and PROP-2681',
      'update the rental details',
      '',
    ]) {
      expect(parseNamedPropertyEdit(text)).toBeNull();
    }
  });

  it('asks what should change and shows the rental figures on file', () => {
    const prompt = formatNamedEditPrompt(property);
    expect(prompt).toMatch(NAMED_EDIT_PROMPT);
    expect(prompt).toContain('PROP-2680');
    expect(prompt).toContain('• Rent: ₹45,000/month');
    expect(prompt).toContain('• Advance: ₹3,00,000');
    expect(prompt).toContain('• Maintenance: _Not set_');
    expect(prompt).toContain('• GST: 18%');
    expect(prompt).not.toContain('Rental income');
    expect(
      formatNamedEditPrompt({ ...property, listing_type: 'Sale' })
    ).toContain('• Rental income: _Not set_');
  });

  it('reads the next short message as the answer to its own question only', async () => {
    const now = Date.parse('2026-11-22T07:10:00Z');
    const asked = {
      message_id: 'wamid.prompt',
      content_text: formatNamedEditPrompt(property),
      created_at: '2026-11-22T07:05:00Z',
    };
    const target = { entity_type: 'property', entity_id: 'p1' };
    const ask = (
      latest: typeof asked | null,
      text = 'rent 50,000 and advance 5 lakh'
    ) =>
      pendingNamedEditTarget({
        accountId: 'acc',
        conversationId: 'c1',
        text,
        now,
        client: clientFor(latest, target),
      });

    await expect(ask(asked)).resolves.toEqual({
      entityType: 'property',
      entityId: 'p1',
    });
    await expect(
      ask({ ...asked, created_at: '2026-11-22T06:40:00Z' })
    ).resolves.toBeNull();
    await expect(
      ask({ ...asked, content_text: '📝 *Draft Property Listing Created!*' })
    ).resolves.toBeNull();
    await expect(ask(asked, 'x'.repeat(501))).resolves.toBeNull();
    await expect(ask(asked, 'PROP-2681 rent 50,000')).resolves.toBeNull();
    await expect(
      ask(asked, 'rent of PROP-2680 and PROP-2682 is 50,000')
    ).resolves.toBeNull();
    await expect(ask(asked, 'PROP-2680 rent 50,000')).resolves.toEqual({
      entityType: 'property',
      entityId: 'p1',
    });
    await expect(ask(null)).resolves.toBeNull();
  });

  it('is resolved before the intake, never falls through to it on a failed lookup, and never answers its own question with "no changes"', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/ai/chatbot-engine.ts'),
      'utf8'
    );
    const named = source.indexOf('parseNamedPropertyEdit(cleanedText)');
    expect(named).toBeGreaterThan(-1);
    expect(named).toBeLessThan(
      source.indexOf('// 4. Start New Session Flow (No Session Exists)')
    );
    expect(named).toBeLessThan(
      source.indexOf('// 2. Active Property Session Exists Flow')
    );
    expect(source).toContain("if (result === 'unchanged' && namedEdit) {");
    expect(source).toContain(
      "if (result === null || (result === 'stale' && namedEdit)) {"
    );
    const lookup = source.slice(named, named + 900);
    expect(lookup).toContain('if (!found) {');
    expect(lookup).toContain("formatRecordUpdateFailureReply('property')");
    expect(lookup).toContain('return true;');
    expect(source).toContain(
      "if (result === 'unchanged' && !answersNamedEditPrompt) {"
    );
  });
});
