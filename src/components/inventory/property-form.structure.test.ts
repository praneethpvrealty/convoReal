import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { propertyFormSections } from '@/lib/inventory/property-form-sections';

function inventorySource(file: string): string {
  return readFileSync(
    join(process.cwd(), 'src/components/inventory', file),
    'utf8'
  );
}

describe('property-form.tsx stays split into its tab components', () => {
  const form = inventorySource('property-form.tsx');

  it('stays under 3,200 lines', () => {
    expect(form.split('\n').length).toBeLessThan(3200);
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

  it('renders the edit form through its section components', () => {
    for (const [component, file] of [
      ['BasicsSection', 'basics-section.tsx'],
      ['LocationSection', 'location-section.tsx'],
      ['TenancySection', 'tenancy-section.tsx'],
      ['SpecsSection', 'specs-section.tsx'],
      ['MediaSection', 'media-section.tsx'],
      ['DescriptionSection', 'description-section.tsx'],
      ['OwnerSection', 'owner-section.tsx'],
    ]) {
      expect(form).toContain(`<${component}`);
      expect(inventorySource(`property-form/${file}`)).toContain(
        `export function ${component}(`
      );
    }
  });

  it('no longer owns the section fields and their handlers', () => {
    for (const token of [
      'Seller&apos;s final price',
      'Guard exact location',
      'Add Tenancy',
      'Show Advanced Options',
      'onUploadImages',
      'handleToggleImageLock',
      'handleGenerateAIDescription',
      'handleOwnerSelect',
      'Contacts with Shown Interest',
    ]) {
      expect(form, `property-form.tsx still contains ${token}`).not.toContain(
        token
      );
    }
  });

  it('keeps every section anchor the section nav scrolls to', () => {
    const sources = [
      form,
      ...[
        'basics-section.tsx',
        'location-section.tsx',
        'specs-section.tsx',
        'media-section.tsx',
        'description-section.tsx',
        'owner-section.tsx',
      ].map((file) => inventorySource(`property-form/${file}`)),
    ].join('\n');
    const sections = propertyFormSections({
      title: '',
      price: '',
      rentPerMonth: '',
      city: '',
      state: '',
      images: [],
      description: '',
      ownerContactId: null,
    });
    for (const { id } of sections) {
      expect(sources).toContain(`id="${id}"`);
    }
    expect(form).toContain(
      '<PropertyFormSectionNav sections={formSections} />'
    );
    expect(form).toContain('id="pf-publish"');
  });

  it('keeps the AI description in-flight flag above the unmounting form, so a reopen cannot submit twice', () => {
    const form = inventorySource('property-form.tsx');
    const section = inventorySource('property-form/description-section.tsx');
    expect(form).toContain(
      'const [generatingDescription, setGeneratingDescription] = useState(false);'
    );
    expect(form).toContain('generatingDescription={generatingDescription}');
    expect(section).not.toContain('useState(');
  });
});
