import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function inventorySource(file: string): string {
  return readFileSync(
    join(process.cwd(), 'src/components/inventory', file),
    'utf8'
  );
}

describe('property-form.tsx stays split into its tab components', () => {
  const form = inventorySource('property-form.tsx');

  it('stays under 8,000 lines', () => {
    expect(form.split('\n').length).toBeLessThan(8000);
  });

  it('no longer owns the broadcast wizard, document sharing or request panels', () => {
    for (const token of [
      'broadcastStep',
      'handleShareDoc',
      'fetchDocRequests',
      'fetchLocRequests',
      'handleSendBroadcast',
      'enginePreviewQuery',
      'followUpContactId',
    ]) {
      expect(form, `property-form.tsx still contains ${token}`).not.toContain(
        token
      );
    }
  });

  it('renders the extracted components in their place', () => {
    for (const [component, file] of [
      ['PropertyMatchesTab', 'property-matches-tab.tsx'],
      ['PropertyEnquiriesTab', 'property-enquiries-tab.tsx'],
      ['ShareDocumentsDialog', 'share-documents-dialog.tsx'],
      ['PropertyRequestsPanels', 'property-requests-panels.tsx'],
    ]) {
      expect(form).toContain(`<${component}`);
      expect(inventorySource(file)).toContain(`export function ${component}(`);
    }
  });

  it('keeps the matched and enquired counts beside the tab labels', () => {
    expect(form).toContain('Matching Contacts ({displayedMatches.length})');
    expect(form).toContain('Enquired Contacts ({enquiredContacts.length})');
  });
});
