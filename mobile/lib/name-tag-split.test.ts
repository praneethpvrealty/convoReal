import { describe, it, expect } from 'vitest';

import { splitImportedName, suggestNameTagSplit } from './name-tag-split';

describe('splitImportedName', () => {
  it('[CTM-005] fills first name, second name and name tag from a phone contact', () => {
    expect(
      splitImportedName('Dr Murali Makam Owner Hsr Has Building On 27th Main')
    ).toEqual({
      name: 'Dr Murali',
      secondName: 'Makam',
      nameTag: 'Owner Hsr Has Building On 27th Main',
    });
  });

  it('[CTM-005] keeps the phonebook qualifier out of the first name', () => {
    expect(suggestNameTagSplit('Nataraj Bank DSA')).toEqual({
      name: 'Nataraj',
      nameTag: 'Bank DSA',
    });
    expect(splitImportedName('Suresh Kumar Bank DSA')).toEqual({
      name: 'Suresh',
      secondName: 'Kumar',
      nameTag: 'Bank DSA',
    });
  });

  it('[CTM-005] leaves a plain single name untouched', () => {
    expect(splitImportedName('Akanksha')).toEqual({
      name: 'Akanksha',
      secondName: null,
      nameTag: null,
    });
  });
});
