import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function mobileSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'mobile', relativePath), 'utf8');
}

function webSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

describe('[UIX-004] destructive actions ask first on both surfaces', () => {
  it('[UIX-004] confirms revoking a stakeholder share link on both', () => {
    expect(webSource('components/deals/deal-stakeholders-panel.tsx')).toContain(
      "window.confirm('Revoke this link? It stops working on the next open.')"
    );
    const mobile = mobileSource('app/(app)/deal/[id].tsx');
    expect(mobile).toContain("title: 'Revoke this link?'");
    expect(mobile).toContain("message: 'It stops working on the next open.'");
  });

  it('[UIX-004] confirms removing a tranche, payout or invoice on web as mobile does', () => {
    expect(webSource('components/deals/deal-tranches-panel.tsx')).toContain(
      'Only a tranche with nothing received can be removed.'
    );
    expect(webSource('components/deals/deal-co-broking-panel.tsx')).toContain(
      'Only a payout with nothing paid can be removed.'
    );
    expect(webSource('components/pipelines/deal-invoices.tsx')).toContain(
      'stops being attached to this deal, and the file is deleted.'
    );
  });

  it('[UIX-004] confirms archiving and duplicating a property on web as mobile does', () => {
    const web = webSource('app/(dashboard)/inventory/inventory-content.tsx');
    expect(web).toContain(
      'Archive this property? Archived listings are hidden from searches and the showcase.'
    );
    expect(web).toContain('Duplicate this listing?');
  });

  it('[UIX-004] offers Undo after archiving a chat on mobile as web does', () => {
    const inbox = mobileSource('app/(app)/(tabs)/index.tsx');
    expect(inbox).toContain("'Conversation archived'");
    expect(inbox).toContain(
      '() => setConversationArchived(conversation.id, archived)'
    );
  });
});
