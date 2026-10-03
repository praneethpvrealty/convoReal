import { describe, expect, it } from 'vitest';
import { propertyFormSections } from './property-form-sections';

const empty = {
  title: '',
  price: '',
  rentPerMonth: '',
  city: '',
  state: '',
  images: [''],
  description: '',
  ownerContactId: null,
};

describe('propertyFormSections', () => {
  it('[PRP-033] lists the form sections in order, ending with Publish', () => {
    expect(propertyFormSections(empty).map((s) => s.id)).toEqual([
      'pf-basics',
      'pf-location',
      'pf-specs',
      'pf-media',
      'pf-description',
      'pf-owner',
      'pf-publish',
    ]);
  });

  it('[PRP-033] marks nothing complete on a blank listing', () => {
    expect(propertyFormSections(empty).filter((s) => s.done === true)).toEqual(
      []
    );
  });

  it('[PRP-033] completes Basics with a title and a sale or rent price', () => {
    const basics = (input: Partial<typeof empty>) =>
      propertyFormSections({ ...empty, ...input })[0].done;
    expect(basics({ title: 'Villa' })).toBe(false);
    expect(basics({ title: 'Villa', price: '9000000' })).toBe(true);
    expect(basics({ title: 'Villa', rentPerMonth: '40000' })).toBe(true);
    expect(basics({ title: '  ', price: '9000000' })).toBe(false);
  });

  it('[PRP-033] completes the other sections from their own fields', () => {
    const done = Object.fromEntries(
      propertyFormSections({
        ...empty,
        city: 'Bengaluru',
        state: 'Karnataka',
        images: ['', 'https://example.com/a.jpg'],
        description: 'Corner plot',
        ownerContactId: 'contact-1',
      }).map((s) => [s.id, s.done])
    );
    expect(done['pf-location']).toBe(true);
    expect(done['pf-media']).toBe(true);
    expect(done['pf-description']).toBe(true);
    expect(done['pf-owner']).toBe(true);
    expect(done['pf-specs']).toBeNull();
    expect(done['pf-publish']).toBeNull();
  });
});
