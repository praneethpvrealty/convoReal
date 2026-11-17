import { describe, expect, it } from 'vitest';

import {
  matchesPropertyTag,
  propertySearchTerm,
  stripPropertyTag,
  titleForLinkedProperty,
  trailingPropertyTag,
} from './property-hashtag';

describe('[CAL-018] trailingPropertyTag', () => {
  it('reads the tag being typed at the end of the title', () => {
    expect(trailingPropertyTag('Visit hbr Layout property #hb')).toBe('hb');
  });

  it('treats a bare # as an empty tag so recent listings show', () => {
    expect(trailingPropertyTag('Site visit #')).toBe('');
    expect(trailingPropertyTag('#')).toBe('');
  });

  it('ignores a # inside a word or a finished tag', () => {
    expect(trailingPropertyTag('Flat no#4')).toBeNull();
    expect(trailingPropertyTag('Visit #hb tomorrow')).toBeNull();
    expect(trailingPropertyTag('Site visit')).toBeNull();
  });
});

describe('stripPropertyTag', () => {
  it('drops the tag once the property is linked', () => {
    expect(stripPropertyTag('Visit hbr Layout property #hb')).toBe(
      'Visit hbr Layout property'
    );
    expect(stripPropertyTag('#hb')).toBe('');
  });

  it('leaves a title without a trailing tag alone', () => {
    expect(stripPropertyTag('Visit #hb tomorrow')).toBe('Visit #hb tomorrow');
  });
});

describe('propertySearchTerm', () => {
  it('removes characters that break a PostgREST or-filter', () => {
    expect(propertySearchTerm('JP Nagar, (phase 2)%')).toBe('JP Nagar phase 2');
  });
});

describe('matchesPropertyTag', () => {
  const property = {
    title: 'HBR Layout 3BHK',
    property_code: 'PV-0142',
    location: 'Kalyan Nagar',
  };

  it('matches title, code or location case-insensitively', () => {
    expect(matchesPropertyTag(property, 'hbr')).toBe(true);
    expect(matchesPropertyTag(property, 'pv-01')).toBe(true);
    expect(matchesPropertyTag(property, 'kalyan')).toBe(true);
    expect(matchesPropertyTag(property, 'whitefield')).toBe(false);
  });

  it('matches everything for an empty tag', () => {
    expect(matchesPropertyTag(property, '')).toBe(true);
  });
});

describe('titleForLinkedProperty', () => {
  it('names an untitled event after the property', () => {
    expect(titleForLinkedProperty('', 'Site visit', 'HBR Layout 3BHK')).toBe(
      'Site visit — HBR Layout 3BHK'
    );
  });

  it('keeps a title the agent already typed', () => {
    expect(titleForLinkedProperty('Visit', 'Site visit', 'HBR')).toBe('Visit');
  });
});
