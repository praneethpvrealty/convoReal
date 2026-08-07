import { describe, expect, it } from 'vitest';
import { propertiesNamedIn, resolveSubjectShift } from './question-subject';

const OVAL_REEF = {
  id: 'prop-oval',
  project: 'Oval Reef',
  title: '70x60 Residential Plot in Oval Reef, Devanahalli',
};
const JADE_A = { id: 'jade-a', project: 'Jade Gardens', title: 'Plot A' };
const JADE_B = { id: 'jade-b', project: 'Jade Gardens', title: 'Plot B' };

describe('propertiesNamedIn', () => {
  it('finds the project an agent pitched mid-thread', () => {
    expect(
      propertiesNamedIn(
        'Have some inventories in Jade Gardens Devanahalli..Pls let me know if you are interested in the Jade Gardens project.',
        [OVAL_REEF, JADE_A]
      )
    ).toEqual(['jade-a']);
  });

  it('finds every listing in the named project', () => {
    expect(
      propertiesNamedIn('Have some inventories in Jade Gardens', [
        OVAL_REEF,
        JADE_A,
        JADE_B,
      ]).sort()
    ).toEqual(['jade-a', 'jade-b']);
  });

  it('ignores punctuation and casing the way people type', () => {
    expect(
      propertiesNamedIn('anything left in JADE-GARDENS?', [JADE_A])
    ).toEqual(['jade-a']);
  });

  it('does not match a project name inside a longer word', () => {
    expect(propertiesNamedIn('the jadegardens brochure', [JADE_A])).toEqual([]);
    expect(
      propertiesNamedIn('Jadeite Gardenside is a different place', [JADE_A])
    ).toEqual([]);
  });

  it('ignores a project name too short to carry signal', () => {
    expect(
      propertiesNamedIn('a big oak tree out front', [
        { id: 'p', project: 'Oak', title: 'Plot' },
      ])
    ).toEqual([]);
  });

  it('falls back to a full title only for a listing with no project', () => {
    const untitled = {
      id: 'p-notitle',
      project: null,
      title: 'Farm Land in Devanahalli',
    };
    expect(
      propertiesNamedIn('about that Farm Land in Devanahalli', [untitled])
    ).toEqual(['p-notitle']);
    // A partial title must not fire — "plot" would claim half the book.
    expect(propertiesNamedIn('any farm land going?', [untitled])).toEqual([]);
  });

  it('says nothing about empty text', () => {
    expect(propertiesNamedIn('', [OVAL_REEF])).toEqual([]);
  });
});

describe('resolveSubjectShift', () => {
  it('moves the subject when an agent pitched a different, single listing', () => {
    // The real thread: the plot was shared, then the agent offered
    // Jade Gardens, then the buyer asked "Is it by a A grade builder???"
    expect(
      resolveSubjectShift(
        ['Have some inventories in Jade Gardens Devanahalli'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'moved', propertyId: 'jade-a' });
  });

  it('refuses to pick when the named project holds several listings', () => {
    expect(
      resolveSubjectShift(
        ['Have some inventories in Jade Gardens Devanahalli'],
        [OVAL_REEF, JADE_A, JADE_B],
        'prop-oval'
      )
    ).toEqual({ kind: 'ambiguous' });
  });

  it('leaves the subject alone when the agent was still on the shared listing', () => {
    expect(
      resolveSubjectShift(
        ['Sending the Oval Reef survey sketch now'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('reads newest-first, so the latest pitch wins', () => {
    expect(
      resolveSubjectShift(
        [
          'Have some inventories in Jade Gardens Devanahalli',
          'Sharing the Oval Reef details',
        ],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'moved', propertyId: 'jade-a' });
  });

  it('skips agent chatter that names nothing', () => {
    expect(
      resolveSubjectShift(
        ["Hey Anju , seller's final price is 10.5k per sqft.", 'Will revert'],
        [OVAL_REEF, JADE_A],
        'prop-oval'
      )
    ).toEqual({ kind: 'unchanged' });
  });

  it('leaves the ledger in charge when the agent has said nothing', () => {
    expect(resolveSubjectShift([], [OVAL_REEF], 'prop-oval')).toEqual({
      kind: 'unchanged',
    });
  });
});
