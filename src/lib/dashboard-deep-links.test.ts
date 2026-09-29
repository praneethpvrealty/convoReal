import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const SELF = 'lib/dashboard-deep-links.test.ts';
const UNREAD_PARAMS = /\/(contacts\?contact|inventory\?property)=/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function source(path: string): string {
  return readFileSync(join(SRC, path), 'utf8');
}

describe('dashboard deep links use the parameters the pages read', () => {
  it('opens a contact from ?contactId= and a property from ?propertyId=', () => {
    expect(source('app/(dashboard)/contacts/contacts-content.tsx')).toContain(
      "searchParams?.get('contactId')"
    );
    expect(source('app/(dashboard)/inventory/inventory-content.tsx')).toContain(
      "searchParams?.get('propertyId')"
    );
  });

  it('links the deal workspace header to the contact and the property', () => {
    const workspace = source('components/deals/deal-workspace.tsx');
    expect(workspace).toContain('`/contacts?contactId=${deal.contact?.id}`');
    expect(workspace).toContain('`/inventory?propertyId=${deal.property.id}`');
  });

  it('never links to /contacts?contact= or /inventory?property=', () => {
    const offenders = sources(SRC)
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((file) => file !== SELF)
      .filter((file) => UNREAD_PARAMS.test(source(file)));
    expect(offenders).toEqual([]);
  });
});
