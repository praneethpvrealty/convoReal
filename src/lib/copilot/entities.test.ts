import { describe, expect, it } from 'vitest';
import {
  activeEntityQuery,
  entityHref,
  insertEntityReference,
  readEntityReferences,
  requestedEntityNavigation,
  sanitizeEntitySearchQuery,
} from './entities';

const property = {
  kind: 'property' as const,
  id: '11111111-1111-4111-8111-111111111111',
  label: 'JP Nagar Plot',
};

describe('Copilot entity references', () => {
  it('detects the active symbol and query at the composer tail', () => {
    expect(activeEntityQuery('Open #JP Nag')).toEqual({
      symbol: '#',
      query: 'JP Nag',
      start: 5,
      end: 12,
    });
    expect(activeEntityQuery('Message @')).toEqual({
      symbol: '@',
      query: '',
      start: 8,
      end: 9,
    });
  });

  it('does not reopen a picker for an already selected token', () => {
    expect(activeEntityQuery('Open #JP Nagar Plot ', [property])).toBeNull();
  });

  it('inserts a canonical token without discarding preceding text', () => {
    const active = activeEntityQuery('Please open #jp')!;
    expect(insertEntityReference('Please open #jp', active, property)).toBe(
      'Please open #JP Nagar Plot '
    );
  });

  it('sanitizes search syntax and untrusted references', () => {
    expect(sanitizeEntitySearchQuery(' JP, Nagar% (plot) ')).toBe(
      'JP Nagar plot'
    );
    expect(
      readEntityReferences([
        property,
        property,
        { kind: 'contact', id: 'not-a-uuid', label: 'No' },
      ])
    ).toEqual([property]);
  });

  it('only resolves explicit read-only navigation requests', () => {
    expect(
      requestedEntityNavigation('Open #JP Nagar Plot', [property])
    ).toEqual(property);
    expect(
      requestedEntityNavigation('Share #JP Nagar Plot', [property])
    ).toBeNull();
    expect(entityHref(property.kind, property.id)).toContain(
      '/inventory?propertyId='
    );
  });
});
