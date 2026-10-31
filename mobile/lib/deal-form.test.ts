import { describe, expect, it } from 'vitest';

import { dealFormMissing } from './deal-form';

const base = {
  title: 'Prestige 3BHK',
  hasContact: true,
  hasStage: true,
  lostReasonMissing: false,
  creating: true,
};

describe('[UIX-011] dealFormMissing', () => {
  it('is null once the deal can be saved', () => {
    expect(dealFormMissing(base)).toBeNull();
  });

  it('names every missing field', () => {
    expect(dealFormMissing({ ...base, title: '  ', hasContact: false })).toBe(
      'Add a title and a contact to create the deal.'
    );
    expect(
      dealFormMissing({
        ...base,
        title: '',
        hasContact: false,
        hasStage: false,
        creating: false,
      })
    ).toBe('Add a title, a contact and a stage to save the deal.');
  });

  it('asks for the lost reason last', () => {
    expect(dealFormMissing({ ...base, lostReasonMissing: true })).toBe(
      'Pick why the deal was lost.'
    );
  });
});
