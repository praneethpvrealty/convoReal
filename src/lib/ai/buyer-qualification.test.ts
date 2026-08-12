import { describe, expect, it, vi, beforeEach } from 'vitest';

// The callback guard must stand down before the first query. A mock
// that throws proves it: reaching the database at all fails the test,
// and the module's own catch cannot hide it because the assertion is on
// the call, not on the return value.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: vi.fn(() => {
    throw new Error('database reached');
  }),
}));

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  appendRequirement,
  processBuyerQualificationMessage,
  buildQualificationReply,
  tallyAreaSuggestions,
  buildMatchesReply,
  buildNoMatchReply,
  buildQualifierQuestion,
  carriesRequirementSignal,
  nextQualifier,
  preferenceSignature,
  shouldSendMatchesNow,
  buildFollowUpQuestion,
  preferenceFacts,
  askedQualifiers,
} from './buyer-qualification';
import {
  EMPTY_PREFERENCES,
  type ExtractedPreferences,
} from './preference-extraction';
import type { RankedPropertyMatch } from '@/lib/radar/engine';
import type { Property } from '@/types';

function prefs(
  overrides: Partial<ExtractedPreferences> = {}
): ExtractedPreferences {
  return { ...EMPTY_PREFERENCES, ...overrides };
}

function match(overrides: Partial<Property>): RankedPropertyMatch {
  return {
    property: {
      id: 'prop-1',
      account_id: 'acc',
      title: 'Farm Land in Devanahalli',
      price: 17_500_000,
      location: 'Devanahalli',
      sublocality: 'Devanahalli',
      city: 'Bangalore',
      type: 'Agricultural Land',
      status: 'Available',
      listing_type: 'Sale',
      ...overrides,
    } as Property,
    score: 85,
    details: {
      type: 'match',
      location: 'match',
      budget: 'match',
      bhk: 'unknown',
      roi: 'unknown',
    },
  };
}

describe('processBuyerQualificationMessage — a lead asking for a person', () => {
  const contact = { id: 'c1', phone: '919000000000', name: 'Kumar' };
  const conversation = { id: 'conv-1' };
  const run = (text: string) =>
    processBuyerQualificationMessage(
      text,
      contact,
      conversation,
      'acc-1',
      'token',
      'phone-id'
    );

  beforeEach(() => {
    vi.mocked(supabaseAdmin).mockClear();
  });

  it('stands down on "Call me" without filing it or paying to read it', async () => {
    // The bug: this reached the ladder, which filed "Call me" as the
    // contact's requirement, paid Gemini to extract preferences from
    // it, and replied "Noted — residential plot. What budget range are
    // you working with?" to someone who had asked to be phoned.
    await expect(run('Call me')).resolves.toBe(false);
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it('stands down however the lead phrases it', async () => {
    for (const text of [
      'please call me',
      'ring me tomorrow',
      'connect me to an agent',
    ]) {
      await expect(run(text), text).resolves.toBe(false);
    }
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it('still takes a real requirement to the ladder', async () => {
    // The other direction: a guard that swallowed ordinary answers
    // would silently switch qualification off for everyone.
    await run('3 BHK in Whitefield, budget 2cr');
    expect(supabaseAdmin).toHaveBeenCalled();
  });

  it('stands down when the lead names a listing number', async () => {
    // The bug this whole change is about. It arrived right after a
    // shortlist, so `awaitingAnswer` was true and the ladder claimed
    // it: a buyer offering to drive out to two listings the same day
    // was asked "what kind of property are you looking for?".
    await expect(
      run('Can you share location of Options 1 & 2? I will visit today.')
    ).resolves.toBe(false);
    await expect(run('photos for no. 3 please')).resolves.toBe(false);
    await expect(run('2')).resolves.toBe(false);
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });

  it('keeps a plain question, which the ladder answers better', async () => {
    // A new lead asking "what do you have?" wants to be asked what
    // they are after — not told that someone will come back to them.
    await run('What do you have?');
    expect(supabaseAdmin).toHaveBeenCalled();
  });

  it('keeps a numbered message that states the requirement', async () => {
    await run('option 2 style, 3 BHK in Whitefield under 2cr');
    expect(supabaseAdmin).toHaveBeenCalled();
  });
});

describe('carriesRequirementSignal', () => {
  it('reads the real MagicBricks lead reply', () => {
    expect(carriesRequirementSignal('Land , 1.5 to 2cr')).toBe(true);
  });

  it('accepts a type or a budget on its own', () => {
    expect(carriesRequirementSignal('3 BHK apartment')).toBe(true);
    expect(carriesRequirementSignal('budget around 80 lakhs')).toBe(true);
    expect(carriesRequirementSignal('commercial')).toBe(true);
    expect(carriesRequirementSignal('under 90L')).toBe(true);
  });

  it('rejects chatter, so an agent keeps the thread', () => {
    expect(carriesRequirementSignal('ok thanks')).toBe(false);
    expect(carriesRequirementSignal('please call me')).toBe(false);
    expect(carriesRequirementSignal('')).toBe(false);
    expect(carriesRequirementSignal(null)).toBe(false);
  });

  it('rejects a bare locality — that only reads as an answer in context', () => {
    expect(carriesRequirementSignal('Devanahalli')).toBe(false);
  });
});

describe('nextQualifier', () => {
  it('walks type → budget → location', () => {
    expect(nextQualifier(prefs())).toBe('type');
    expect(nextQualifier(prefs({ property_categories: ['plot'] }))).toBe(
      'budget'
    );
    expect(
      nextQualifier(
        prefs({ property_categories: ['plot'], budget_max: 20_000_000 })
      )
    ).toBe('location');
  });

  it('is satisfied by a broad category, not only a specific type', () => {
    expect(nextQualifier(prefs({ property_categories: ['commercial'] }))).toBe(
      'budget'
    );
  });

  it('returns null once all three rungs are answered', () => {
    expect(
      nextQualifier(
        prefs({
          property_types: ['Agricultural Land'],
          budget_min: 15_000_000,
          budget_max: 20_000_000,
          areas: ['Devanahalli'],
        })
      )
    ).toBeNull();
  });

  it('counts a named project as a location', () => {
    expect(
      nextQualifier(
        prefs({
          property_categories: ['residential'],
          budget_max: 9_000_000,
          projects: ['Purva Vantage'],
        })
      )
    ).toBeNull();
  });

  it('does not put a rung a second time', () => {
    // The live loop: asked "which area are you looking at?", answered
    // "Anywhere. its fine, We are Kyzion. We purchase plot, Build
    // 1bhk/studio for Short term rentals" — which is an answer, and
    // leaves areas empty because there is no area. The bot repeated
    // itself word for word and would have kept repeating it.
    const answered = prefs({
      property_categories: ['commercial'],
      budget_max: 80_000_000,
    });
    expect(nextQualifier(answered)).toBe('location');
    expect(nextQualifier(answered, ['location'])).toBeNull();
  });

  it('moves to the next rung rather than skipping the ladder', () => {
    expect(nextQualifier(prefs(), ['type'])).toBe('budget');
    expect(nextQualifier(prefs(), ['type', 'budget'])).toBe('location');
    expect(nextQualifier(prefs(), ['type', 'budget', 'location'])).toBeNull();
  });
});

describe('askedQualifiers', () => {
  it('reads each rung back off the message that asked it', () => {
    for (const field of ['type', 'budget', 'location'] as const) {
      // Both phrasings, so the fingerprints cannot drift away from the
      // questions they identify.
      expect(
        askedQualifiers([
          buildQualifierQuestion(field, prefs(), ['HSR Layout']),
        ]),
        field
      ).toEqual([field]);
      expect(askedQualifiers([buildFollowUpQuestion(field)]), field).toEqual([
        field,
      ]);
    }
  });

  it('claims nothing from the bot messages that are not questions', () => {
    expect(
      askedQualifiers([
        'Thanks Pavan — here are 3 that fit 👇',
        null,
        "Got it — I'll have someone from the team call you shortly.",
      ])
    ).toEqual([]);
  });

  it('reports the rungs in ladder order', () => {
    expect(
      askedQualifiers([
        buildQualifierQuestion('location', prefs()),
        buildQualifierQuestion('type', prefs()),
      ])
    ).toEqual(['type', 'location']);
  });
});

describe('buildQualifierQuestion', () => {
  it('asks for the type first with no assumptions', () => {
    const q = buildQualifierQuestion('type', prefs());
    expect(q).toContain('What kind of property');
  });

  it('tidies a dropdown taxonomy value into something readable', () => {
    // Live Gemini returns the canonical "Residential Land/ Plot"; the
    // stray space around the slash is visible to the lead otherwise.
    const q = buildQualifierQuestion(
      'budget',
      prefs({ property_types: ['Residential Land/ Plot'] })
    );
    expect(q).toContain('residential land/plot');
    expect(q).not.toContain('land/ plot');
  });

  it('reflects the stated type back when asking for budget', () => {
    const q = buildQualifierQuestion(
      'budget',
      prefs({ property_types: ['Agricultural Land'] })
    );
    expect(q).toContain('agricultural land');
    expect(q).toContain('budget');
  });

  it('reflects type and budget when asking for location', () => {
    const q = buildQualifierQuestion(
      'location',
      prefs({
        property_categories: ['plot'],
        budget_min: 15_000_000,
        budget_max: 20_000_000,
      })
    );
    expect(q).toContain('₹1.5 Cr–₹2 Cr');
    expect(q).toContain('Which area');
  });

  it('offers localities we actually have inventory in', () => {
    const q = buildQualifierQuestion(
      'location',
      prefs({ property_categories: ['plot'], budget_max: 20_000_000 }),
      ['Devanahalli', 'Sarjapur', 'Kanakapura']
    );
    expect(q).toContain('Devanahalli, Sarjapur, Kanakapura');
  });

  it('drops the locality hint when there is no live inventory to name', () => {
    const q = buildQualifierQuestion(
      'location',
      prefs({ property_categories: ['plot'] }),
      []
    );
    expect(q).not.toContain('We have options in');
  });
});

describe('buildMatchesReply', () => {
  it('numbers the shortlist and links each listing to the contact', () => {
    const reply = buildMatchesReply(
      'Tanwi Farheen',
      [
        match({}),
        match({
          id: 'prop-2',
          title: 'Plot in Sarjapur',
          sublocality: 'Sarjapur',
        }),
      ],
      'https://convoreal.com/',
      'contact-9'
    );
    expect(reply).toContain('Tanwi');
    expect(reply).toContain('*1. Farm Land in Devanahalli*');
    expect(reply).toContain('*2. Plot in Sarjapur*');
    expect(reply).toContain(
      'https://convoreal.com/?property_id=prop-1&v=contact-9'
    );
    expect(reply).toContain('₹1.75 Cr');
  });

  it('caps the shortlist at three so a reply never reads as a dump', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      match({ id: `p-${i}`, title: `Listing ${i}` })
    );
    const reply = buildMatchesReply(
      'Tanwi',
      many,
      'https://convoreal.com',
      'c1'
    );
    expect(reply).toContain('*3. Listing 2*');
    expect(reply).not.toContain('*4.');
  });

  it('reads naturally for a single match', () => {
    const reply = buildMatchesReply(
      'Tanwi',
      [match({})],
      'https://convoreal.com',
      'c1'
    );
    expect(reply).toContain("here's one that fits");
  });
});

describe('buildNoMatchReply', () => {
  it('repeats the brief back so the lead knows it was heard', () => {
    const reply = buildNoMatchReply(
      'Tanwi',
      prefs({
        property_categories: ['plot'],
        budget_max: 20_000_000,
        areas: ['Devanahalli'],
      })
    );
    expect(reply).toContain('Tanwi');
    expect(reply).toContain('Devanahalli');
    expect(reply).toContain('up to ₹2 Cr');
  });
});

describe('appendRequirement', () => {
  it('starts the brief from an empty contact', () => {
    expect(appendRequirement(null, 'Land , 1.5 to 2cr')).toBe(
      'Land , 1.5 to 2cr'
    );
  });

  it('appends the next answer on its own line', () => {
    expect(appendRequirement('Land , 1.5 to 2cr', 'Devanahalli')).toBe(
      'Land , 1.5 to 2cr\nDevanahalli'
    );
  });

  it('does not stack a repeated answer', () => {
    expect(appendRequirement('Land , 1.5 to 2cr', 'land , 1.5 TO 2cr')).toBe(
      'Land , 1.5 to 2cr'
    );
  });
});

describe('tallyAreaSuggestions', () => {
  it('offers real localities, commonest first', () => {
    expect(
      tallyAreaSuggestions([
        { sublocality: 'Koramangala', city: 'Bangalore' },
        { sublocality: 'HSR Layout', city: 'Bangalore' },
        { sublocality: 'Koramangala', city: 'Bangalore' },
      ])
    ).toEqual(['Koramangala', 'HSR Layout']);
  });

  it('never offers the city as an area — that is not a choice', () => {
    expect(
      tallyAreaSuggestions([
        { sublocality: null, city: 'Bangalore' },
        { sublocality: 'Bangalore', city: 'Bangalore' },
        { sublocality: 'BTM Layout', city: 'Bangalore' },
      ])
    ).toEqual(['BTM Layout']);
  });

  it('caps the list at three', () => {
    expect(
      tallyAreaSuggestions(
        ['A', 'B', 'C', 'D'].map((s) => ({ sublocality: s, city: 'Bangalore' }))
      )
    ).toHaveLength(3);
  });
});

describe('buildQualificationReply', () => {
  it('asks the missing rung and reports which one', () => {
    const out = buildQualificationReply(
      prefs({ property_categories: ['plot'] }),
      'Tanwi',
      [],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(out.missing).toBe('budget');
    expect(out.reply).toContain('budget');
  });

  it('sends listings once the ladder is answered', () => {
    const out = buildQualificationReply(
      prefs({
        property_categories: ['plot'],
        budget_max: 20_000_000,
        areas: ['Devanahalli'],
      }),
      'Tanwi',
      [match({})],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(out.missing).toBeNull();
    expect(out.reply).toContain('Farm Land in Devanahalli');
  });

  it('promises a callback rather than sending nothing when the ladder is answered but inventory has no fit', () => {
    const out = buildQualificationReply(
      prefs({
        property_categories: ['plot'],
        budget_max: 20_000_000,
        areas: ['Devanahalli'],
      }),
      'Tanwi',
      [],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(out.missing).toBeNull();
    expect(out.reply).toContain('call you shortly');
  });
});

describe('preferenceSignature', () => {
  it('is stable across ordering and case', () => {
    expect(
      preferenceSignature(prefs({ areas: ['Devanahalli', 'Sarjapur'] }))
    ).toBe(preferenceSignature(prefs({ areas: ['sarjapur', 'devanahalli'] })));
  });

  it('changes when the lead adds something new', () => {
    expect(preferenceSignature(prefs({ budget_max: 20_000_000 }))).not.toBe(
      preferenceSignature(
        prefs({ budget_max: 20_000_000, areas: ['Devanahalli'] })
      )
    );
  });

  it('ignores suggested tags, which never change what we ask or match', () => {
    expect(preferenceSignature(prefs({ suggested_tags: ['Investor'] }))).toBe(
      preferenceSignature(prefs())
    );
  });

  it('reads a re-tokenised locality as unchanged', () => {
    // The production values, verbatim. The stored areas were the pair;
    // re-extracting the same brief returned them comma-joined into one
    // string. Element-wise that is a change, and the ladder answered a
    // lead who had typed "Call me" with the next qualifier.
    expect(
      preferenceSignature(
        prefs({ areas: ['Block 4th Sir M Vishweshwaraiah Layout, Bangalore'] })
      )
    ).toBe(
      preferenceSignature(
        prefs({
          areas: ['Block 4th Sir M Vishweshwaraiah Layout', 'Bangalore'],
        })
      )
    );
  });

  it('ignores whitespace and duplicate noise from a re-run', () => {
    expect(
      preferenceSignature(
        prefs({ areas: ['  HSR  Layout ', 'hsr layout', ''] })
      )
    ).toBe(preferenceSignature(prefs({ areas: ['HSR Layout'] })));
  });

  it('normalises every list field, not just areas', () => {
    for (const field of [
      'property_types',
      'property_categories',
      'excluded_areas',
      'projects',
      'listing_types',
    ] as const) {
      expect(
        preferenceSignature(prefs({ [field]: ['Alpha, Beta'] } as never)),
        field
      ).toBe(
        preferenceSignature(prefs({ [field]: ['alpha', 'beta'] } as never))
      );
    }
  });

  it('still hears a genuinely new locality', () => {
    // The guard must not go deaf: splitting for comparison cannot make
    // an added area look like the same set.
    expect(preferenceSignature(prefs({ areas: ['Whitefield'] }))).not.toBe(
      preferenceSignature(prefs({ areas: ['Whitefield', 'Hoodi'] }))
    );
  });

  it('still hears a locality that was dropped', () => {
    // The other direction, and the one that matters for data loss: a
    // re-extraction that loses an area is a real difference, and must
    // stay visible rather than being normalised away.
    expect(
      preferenceSignature(
        prefs({ areas: ['Hrbr Layout', 'Kalyan Nagar', 'Bangalore'] })
      )
    ).not.toBe(
      preferenceSignature(prefs({ areas: ['Hrbr Layout', 'Kalyan Nagar'] }))
    );
  });
});

describe('shouldSendMatchesNow', () => {
  it('short-circuits the ladder when a named project has stock', () => {
    expect(shouldSendMatchesNow(prefs({ projects: ['Oval Reef'] }), 1)).toBe(
      true
    );
  });

  it('leaves the ladder alone when the named project has no stock', () => {
    expect(shouldSendMatchesNow(prefs({ projects: ['Oval Reef'] }), 0)).toBe(
      false
    );
  });

  it('does not fire on a plain locality — only a named project is decisive', () => {
    expect(shouldSendMatchesNow(prefs({ areas: ['Devanahalli'] }), 3)).toBe(
      false
    );
  });

  it('does not fire on an empty brief', () => {
    expect(shouldSendMatchesNow(prefs(), 3)).toBe(false);
  });
});

describe('buildQualificationReply — project-first matching', () => {
  // Anju's opening message, as extracted: three named projects, no
  // type and no budget.
  const anju = prefs({
    projects: ['Swiss Town', 'Hollywood Town', 'Oval Reef'],
  });

  it('sends the Oval Reef listing instead of asking for the property type', () => {
    const outcome = buildQualificationReply(
      anju,
      'Anju',
      [match({ title: '70x60 Residential Plot in Oval Reef, Devanahalli' })],
      [],
      'https://aryavartaventures.convoreal.com',
      'contact-anju'
    );

    expect(outcome.missing).toBeNull();
    expect(outcome.reply).toContain('Oval Reef');
    expect(outcome.reply).not.toContain(
      'What kind of property are you looking for'
    );
  });

  it('still asks the open rung, as a postscript to the listings', () => {
    const outcome = buildQualificationReply(
      anju,
      'Anju',
      [match({})],
      [],
      'https://convoreal.com',
      'c1'
    );
    // Anju stated no type, so that is what is still worth knowing.
    expect(outcome.reply).toContain(
      'land/plot, apartment, villa or commercial'
    );
    // The greeting-led version would read as though the bot forgot it
    // had just sent three listings.
    expect(outcome.reply).not.toContain('Got it 👍');
  });

  it('moves the postscript on to budget once the type is known', () => {
    const outcome = buildQualificationReply(
      prefs({ ...anju, property_categories: ['plot'] }),
      'Anju',
      [match({})],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(outcome.reply).toContain('what budget are you working with');
    expect(outcome.reply).not.toContain('Noted —');
  });

  it('falls back to the ladder when the named project has nothing to show', () => {
    const outcome = buildQualificationReply(
      anju,
      'Anju',
      [],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(outcome.missing).toBe('type');
    expect(outcome.reply).toContain(
      'What kind of property are you looking for'
    );
  });

  it('adds no postscript when the ladder finished on its own', () => {
    const complete = prefs({
      property_types: ['Residential Plot'],
      budget_max: 50_000_000,
      areas: ['Devanahalli'],
    });
    const outcome = buildQualificationReply(
      complete,
      'Anju',
      [match({})],
      [],
      'https://convoreal.com',
      'c1'
    );
    expect(outcome.reply).not.toContain('One thing —');
  });
});

describe('buildFollowUpQuestion', () => {
  it('asks the rung without re-greeting the lead', () => {
    for (const field of ['type', 'budget', 'location'] as const) {
      const text = buildFollowUpQuestion(field);
      expect(text.startsWith('One thing —')).toBe(true);
      expect(text).not.toContain('Got it');
      expect(text).not.toContain('Perfect —');
    }
  });
});

describe('preferenceFacts', () => {
  const investor = prefs({
    budget_max: 50_000_000,
    areas: ['Devanahalli'],
    min_roi: 4,
    suggested_tags: ['Investor', 'NRI'],
  });

  it('hands every preference to the registry, including yield and tags', () => {
    const fields = preferenceFacts(investor, []).map((f) => f.field);
    expect(fields).toContain('pref_budget_max');
    expect(fields).toContain('pref_min_roi');
    expect(fields).toContain('pref_suggested_tags');
    // Nothing is attached yet, so both suggestions are proposable.
    expect(fields).toContain('tags');
  });

  it('proposes only the tags the contact does not already carry', () => {
    const tagFact = preferenceFacts(investor, ['investor']).find(
      (f) => f.field === 'tags'
    );
    expect(tagFact?.value).toEqual(['NRI']);
  });

  it('proposes no tags once every suggestion is attached', () => {
    // A queue item that resolves to nothing is worse than no item.
    const fields = preferenceFacts(investor, ['Investor', 'NRI']).map(
      (f) => f.field
    );
    expect(fields).not.toContain('tags');
    // The suggestion column still travels — it is what the chips read.
    expect(fields).toContain('pref_suggested_tags');
  });

  it('proposes no tags when the buyer earned none', () => {
    const fields = preferenceFacts(prefs({ budget_max: 1_000_000 }), []).map(
      (f) => f.field
    );
    expect(fields).not.toContain('tags');
  });
});
