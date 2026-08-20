/**
 * Drift guard for the mobile app's hand-ported mirrors of web logic.
 *
 * `mobile/` is a separate Expo project with its own package.json and
 * Metro root, so it cannot import from `src/` — several modules there
 * are maintained as copies and say so in their own header comments.
 * Copies rot silently: before this suite existed the mobile plan card
 * advertised Starter as "50 contacts" (really 150) and Agency as
 * "unlimited broadcasts" (really 5,000).
 *
 * These tests read the mobile sources as text and assert they still
 * agree with the web sources of truth. They run in `npm test`, which
 * the pre-commit hook already executes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_CONFIG, PLAN_ORDER } from '@/lib/billing/plan-config';
import { TOURS } from '@/lib/copilot/tours';
import { MESSAGES } from '@/lib/i18n/messages';
import {
  AMENITIES_BY_CATEGORY,
  AREA_UNITS,
  COMMERCIAL_TYPES,
  FACING_DIRECTIONS,
  NEARBY_HIGHLIGHTS_OPTIONS,
  PROPERTY_TYPE_GROUPS,
  LAND_OWNERSHIP_TYPES,
  LAND_LEGAL_STATUSES,
  LAND_CONVERSION_TYPES,
  LEGACY_RESIDENTIAL_LAND_PLOT,
  hasBedsBaths,
  isApartmentType,
  isLandType,
  isRawLandType,
} from '@/lib/inventory/property-options';
import { PROPERTY_TYPE_VALUES } from '@/lib/property-types';
import { BUDGET_OPTIONS } from '@/lib/contacts/budget-options';
import {
  DIGEST_PAUSE_COMMAND,
  DIGEST_RESUME_COMMAND,
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  ownerDetailsSectionItems,
} from '@/lib/owners/details-request';
import {
  CONSENT_HINTS,
  CONSENT_LABELS,
  CONSENT_OVERRIDE_WARNING,
  CONSENT_STATES,
} from '@/lib/contacts/alerts-consent';
import {
  GREETING_MESSAGE_MAX,
  GREETING_TONES,
} from '@/lib/greetings/generate';
import { OCCASIONS } from '@/lib/greetings/occasions';
import { priceInWords } from '@/lib/currency-utils';
import { confidentialityNote } from '@/lib/share-message-builder';
import {
  gateRequestStatusLabel,
  gateSummary,
} from '@/lib/inventory/gate-stats';
import {
  MONTHLY_PRICED_LISTING_TYPES,
  rentalYieldPercent,
} from '@/lib/inventory/rental-yield';
import {
  FLOW_CHECKBOX_MAX_ITEMS,
  PROPERTY_INTEREST_FLOW_IDS,
  PROPERTY_INTEREST_OPTIONS,
  PROPERTY_INTEREST_SHORT_TITLES,
} from '@/lib/property-interests';
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from '@/lib/whatsapp/customer-window';
import { DELIVERY_FAILURE_MARKER } from '@/lib/whatsapp/delivery-failure';
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_MESSAGE,
  MAX_PINNED_PER_CONVERSATION,
} from '@/lib/whatsapp/message-state';

function mobileSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'mobile', relativePath), 'utf8');
}

/** The `[ ... ]` body of an `export const <name> = [ ... ];` block. */
function constBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  if (start === -1) throw new Error(`${name} not found in mobile source`);
  const open = source.indexOf('[', start);
  const end = source.indexOf('];', open);
  if (open === -1 || end === -1)
    throw new Error(`${name} is not an array literal`);
  return source.slice(open, end);
}

/** String literals inside an `export const <name> = [ ... ];` block. */
function stringLiteralsInConst(source: string, name: string): string[] {
  return stringLiterals(constBody(source, name));
}

function stringLiterals(block: string): string[] {
  return Array.from(
    block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)
  ).map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
}

describe('mobile/lib/plan-meta.ts mirrors plan-config', () => {
  const source = mobileSource('lib/plan-meta.ts');

  /** The `PLAN_META` entry body for one plan, e.g. everything between
   *  `starter: {` and its closing brace. */
  function planBlock(plan: string): string {
    const start = source.indexOf(`  ${plan}: {`);
    expect(start, `no PLAN_META entry for ${plan}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n  },', start);
    return source.slice(start, end);
  }

  it.each(PLAN_ORDER)('%s keeps the web label and tagline', (plan) => {
    const block = planBlock(plan);
    expect(block).toContain(`label: '${PLAN_CONFIG[plan].name}'`);
    expect(block).toContain(`tagline: '${PLAN_CONFIG[plan].tagline}'`);
  });

  // Perks are editorial prose, so we can't derive the string — but every
  // number quoted in it must be that plan's real limit, and a capped
  // plan must never be sold as "unlimited".
  const LIMIT_BY_UNIT: Record<string, keyof (typeof PLAN_CONFIG)['starter']> = {
    user: 'maxUsers',
    users: 'maxUsers',
    member: 'maxUsers',
    members: 'maxUsers',
    contact: 'maxContacts',
    contacts: 'maxContacts',
    property: 'maxProperties',
    properties: 'maxProperties',
    broadcast: 'maxBroadcastsPerMonth',
    broadcasts: 'maxBroadcastsPerMonth',
  };

  it.each(PLAN_ORDER)('%s quotes real limits in its perks line', (plan) => {
    const perks = /perks: '([^']*)'/.exec(planBlock(plan))?.[1];
    expect(perks, `no perks string for ${plan}`).toBeDefined();

    const quoted = Array.from(
      perks!.matchAll(
        /([\d,]+)\s+(users?|members?|contacts?|properties|broadcasts?)/g
      )
    );
    expect(
      quoted.length,
      `perks for ${plan} quote no limits at all`
    ).toBeGreaterThan(0);

    for (const [, rawCount, unit] of quoted) {
      const field = LIMIT_BY_UNIT[unit];
      expect(
        Number(rawCount.replace(/,/g, '')),
        `${plan} perks "${unit}"`
      ).toBe(PLAN_CONFIG[plan][field]);
    }

    for (const unit of Object.keys(LIMIT_BY_UNIT)) {
      if (new RegExp(`unlimited\\s+${unit}\\b`, 'i').test(perks!)) {
        expect(
          PLAN_CONFIG[plan][LIMIT_BY_UNIT[unit]],
          `${plan} perks say unlimited ${unit} but the plan is capped`
        ).toBe(Number.POSITIVE_INFINITY);
      }
    }
  });
});

describe('mobile/lib/property-options.ts mirrors the web option catalog', () => {
  const source = mobileSource('lib/property-options.ts');

  it('offers the same property types in the same groups', () => {
    const groups = Array.from(
      source.matchAll(/group: '([^']+)',\s*options: \[([\s\S]*?)\]/g)
    ).map(([, group, body]) => ({ group, options: stringLiterals(body) }));

    // The Commercial group spreads COMMERCIAL_TYPES rather than listing
    // them, so fill it in from the const the spread refers to.
    const commercial = stringLiteralsInConst(source, 'COMMERCIAL_TYPES');
    const resolved = groups.map((g) =>
      g.options.length === 0 ? { ...g, options: commercial } : g
    );

    expect(resolved).toEqual(
      PROPERTY_TYPE_GROUPS.map((g) => ({
        group: g.group,
        options: g.options.map((o) => o.value),
      }))
    );
  });

  it('gates commercial fields on the same type list', () => {
    expect(stringLiteralsInConst(source, 'COMMERCIAL_TYPES')).toEqual(
      COMMERCIAL_TYPES
    );
  });

  it.each([
    ['FACING_DIRECTIONS', FACING_DIRECTIONS],
    ['AREA_UNITS', AREA_UNITS],
    ['NEARBY_HIGHLIGHTS_OPTIONS', NEARBY_HIGHLIGHTS_OPTIONS],
    ['LAND_OWNERSHIP_TYPES', LAND_OWNERSHIP_TYPES],
    ['LAND_LEGAL_STATUSES', LAND_LEGAL_STATUSES],
    ['LAND_CONVERSION_TYPES', LAND_CONVERSION_TYPES],
  ])('keeps %s in sync', (name, expected) => {
    expect(stringLiteralsInConst(source, name)).toEqual(expected);
  });

  // The type predicates decide which field groups an editor renders.
  // Mobile shipped without them, so a plot's editor asked for bedrooms
  // and a super-built area — fields a vacant parcel cannot have.
  // Compared by behaviour across the whole taxonomy rather than by
  // literal, since the mobile lists reference a shared legacy const.
  it.each([
    ['BEDS_BATHS_TYPES', hasBedsBaths],
    ['LAND_TYPES', isLandType],
    ['RAW_LAND_TYPES', isRawLandType],
    ['APARTMENT_TYPES', isApartmentType],
  ])(
    'classifies every property type the same way as %s',
    (name, webPredicate) => {
      const body = constBody(source, name);
      const members = new Set(stringLiterals(body));
      if (body.includes('LEGACY_RESIDENTIAL_LAND_PLOT')) {
        members.add(LEGACY_RESIDENTIAL_LAND_PLOT);
      }

      for (const type of PROPERTY_TYPE_VALUES) {
        expect(members.has(type), `${name} disagrees on "${type}"`).toBe(
          webPredicate(type)
        );
      }
    }
  );

  it('offers the same amenities under the same categories', () => {
    const categories = Array.from(
      source.matchAll(
        /category: '((?:[^'\\]|\\.)*)',\s*\n\s*items: \[([\s\S]*?)\]/g
      )
    ).map(([, category, body]) => [
      category.replace(/\\'/g, "'"),
      stringLiterals(body),
    ]);

    expect(Object.fromEntries(categories)).toEqual(AMENITIES_BY_CATEGORY);
  });
});

describe('mobile/lib/consent.ts mirrors the alerts-consent wording', () => {
  // Consent is a compliance state. Two surfaces describing the same
  // state in different words — or warning differently before undoing a
  // contact's own opt-out — is worse than either wording alone.
  const source = mobileSource('lib/consent.ts');

  it('carries the same label for every state', () => {
    for (const state of CONSENT_STATES) {
      expect(source, state).toContain(`'${CONSENT_LABELS[state]}'`);
    }
  });

  it('carries the same hint for every state', () => {
    for (const state of CONSENT_STATES) {
      for (const fragment of CONSENT_HINTS[state].split('. ')) {
        const trimmed = fragment.trim();
        if (trimmed.length > 24) expect(source, state).toContain(trimmed);
      }
    }
  });

  it('warns with the same words before undoing an opt-out', () => {
    for (const fragment of CONSENT_OVERRIDE_WARNING.split(' — ')) {
      expect(source).toContain(fragment.trim());
    }
  });

  it('offers exactly the states the column allows', () => {
    expect(stringLiteralsInConst(source, 'CONSENT_STATES')).toEqual([
      ...CONSENT_STATES,
    ]);
  });
});

describe('mobile/lib/greetings.ts mirrors the greeting composer limits', () => {
  // The occasion catalog itself is served over the API rather than
  // copied, so the only thing that can drift is the composer's own
  // limits. A mobile cap larger than the web's would let an agent write
  // a greeting the API then rejects, after they had already paid the
  // credits to generate it.
  const source = mobileSource('lib/greetings.ts');

  it('caps the greeting at the same length the API enforces', () => {
    expect(source).toContain(
      `GREETING_MESSAGE_MAX = ${GREETING_MESSAGE_MAX}`
    );
  });

  it('offers the same tones the prompt builder accepts', () => {
    expect(stringLiteralsInConst(source, 'GREETING_TONES')).toEqual([
      ...GREETING_TONES,
    ]);
  });

  it('does not copy the occasion catalog, which shifts every year', () => {
    for (const occasion of OCCASIONS) {
      expect(
        source.includes(`'${occasion.label}'`),
        `mobile hardcodes the occasion "${occasion.label}" — it must come from /api/greetings/occasions`
      ).toBe(false);
    }
  });
});

describe('mobile/lib/customer-window.ts mirrors customer-window', () => {
  // Meta rejects the send when this is wrong, so the two copies have to
  // agree on the window length, the error markers, and the pre-flight
  // message that `isReengagementError` has to keep recognising.
  const source = mobileSource('lib/customer-window.ts');

  it('uses the same 24-hour window', () => {
    expect(source).toContain(`CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000`);
  });

  it('matches the same re-engagement markers', () => {
    for (const marker of ['131047', '24 hours', 're-engagement']) {
      expect(source, `missing marker ${marker}`).toContain(marker);
    }
  });

  it('throws the same pre-flight message', () => {
    expect(source).toContain(CUSTOMER_WINDOW_EXPIRED_MESSAGE);
  });
});

describe('mobile/lib/reply-state.ts mirrors reply-state', () => {
  // Both inboxes decide "does this thread need a human?" from the same
  // conversation columns. If the copies disagree, a thread shows as
  // handled on one surface and waiting on the other.
  const source = mobileSource('lib/reply-state.ts');
  const web = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/reply-state.ts'),
    'utf8'
  );

  it.each([
    'needsReply',
    'waitingShort',
    'needsReplyLabel',
    'unanswered',
    'unansweredLabel',
  ])('keeps the %s body identical to the web source', (name) => {
    const body = (s: string) => {
      const start = s.indexOf(`export function ${name}`);
      expect(start, `${name} missing`).toBeGreaterThan(-1);
      const end = s.indexOf('\n}', start);
      return s.slice(start, end);
    };
    expect(body(source)).toBe(body(web));
  });
});

describe('mobile/lib/message-actions.ts mirrors delivery-failure', () => {
  // The marker is what a resend or forward cuts the failure note off at.
  // If the webhook's wording changes and the mobile copy doesn't, the
  // agent's own error report goes back out to the customer.
  it('cuts at the same marker', () => {
    expect(mobileSource('lib/message-actions.ts')).toContain(
      DELIVERY_FAILURE_MARKER
    );
  });
});

describe('mobile/lib/message-reactions.ts mirrors the web quick-reaction bar', () => {
  // Both surfaces sit on the same message rows and the same
  // /api/whatsapp/react route. An emoji offered on one and missing on
  // the other reads as a broken thread to whoever reached for the
  // second surface, so the bars have to stay identical.
  it('offers the same quick reactions the web thread does', () => {
    const web = stringLiterals(
      readFileSync(
        join(process.cwd(), 'src/components/inbox/message-actions.tsx'),
        'utf8'
      ).match(/const QUICK_EMOJIS = \[[^\]]*\]/)?.[0] ?? ''
    );

    expect(web.length).toBeGreaterThan(0);
    expect(
      stringLiteralsInConst(
        mobileSource('lib/message-reactions.ts'),
        'QUICK_EMOJIS'
      )
    ).toEqual(web);
  });
});

describe('mobile/lib/message-state.ts mirrors message-state', () => {
  // Pin and hide are Engine-local: WhatsApp has no revoke endpoint and
  // no pin outside a group. If either copy stops saying so, an agent
  // tells a customer their message was deleted when it is still on
  // their phone — so the wording is pinned, not just the cap.
  const source = mobileSource('lib/message-state.ts');

  it('uses the same pin ceiling', () => {
    expect(source).toContain(
      `MAX_PINNED_PER_CONVERSATION = ${MAX_PINNED_PER_CONVERSATION}`
    );
  });

  it('carries the same confirmation copy, verbatim', () => {
    expect(source).toContain(HIDE_CONFIRM_MESSAGE);
  });

  it('names the action the same way on both surfaces', () => {
    expect(source).toContain(HIDE_ACTION_LABEL);
  });

  it('still warns, in its own header, that neither reaches WhatsApp', () => {
    expect(source).toMatch(/no revoke endpoint/i);
  });
});

describe('mobile/lib/share-message.ts mirrors share-message-builder', () => {
  it('exports every function the web builder does', () => {
    const exportedFunctions = (source: string) =>
      Array.from(source.matchAll(/export function (\w+)/g))
        .map((m) => m[1])
        .sort();

    const web = exportedFunctions(
      readFileSync(
        join(process.cwd(), 'src/lib/share-message-builder.ts'),
        'utf8'
      )
    );
    const mobile = exportedFunctions(mobileSource('lib/share-message.ts'));

    // Mobile may add surface-specific builders on top; it must never be
    // missing one the web share dialog relies on.
    expect(mobile).toEqual(expect.arrayContaining(web));
  });

  // The confidentiality note is the customer-facing explanation of why a
  // listing is gated. Two surfaces telling a buyer two different stories
  // about the owner's instruction is worse than either story alone, so
  // this is pinned verbatim rather than merely "present".
  it('carries the same confidentiality note, verbatim', () => {
    // Both files build the note by concatenating literals across source
    // lines, so neither the whole string nor a fragment spanning a `+`
    // appears verbatim. Splicing the concatenation joints back out gives
    // a source to match the web builder's own output against.
    const source = mobileSource('lib/share-message.ts')
      .replace(/['"`]\s*\+\s*['"`]/g, '')
      // The TTL is interpolated on both sides; the note reads the same
      // without it, and the empty-TTL case is what the web emits here.
      .replace(/\$\{validity\}/g, '');
    const fragments = [
      ...confidentialityNote('client').split('\n'),
      ...confidentialityNote('agent').split('\n'),
    ]
      .flatMap((line) => line.split(/(?<=[.,]) /))
      .map((f) => f.trim())
      .filter((f) => f.length > 24);

    expect(fragments.length).toBeGreaterThan(4);
    for (const fragment of fragments) {
      expect(source, `mobile is missing: ${fragment}`).toContain(fragment);
    }
  });

  it('reduces a gated listing to the same stub the web builder does', () => {
    const source = mobileSource('lib/share-message.ts');
    // Both must band the price and rebuild the title rather than pasting
    // the stored one — a share message is more forwardable than the page.
    expect(source).toContain("showcase_visibility === 'teaser'");
    expect(source).toContain('Guide price *${band}*');
    expect(source).toContain('teaserTitle(property)');
  });
});

describe('mobile/lib/owner-details-request.ts mirrors details-request', () => {
  // The seller reads this once and answers it once. If the two surfaces
  // ask for different papers, an owner messaged from the phone hands
  // over a different file than one messaged from the desktop — and the
  // agent has no way to tell which list they were given.
  const source = mobileSource('lib/owner-details-request.ts');

  it('asks for exactly the same items in every section, land or built', () => {
    for (const type of ['Residential Plot', 'Flat/ Apartment']) {
      for (const section of OWNER_DETAILS_SECTIONS) {
        for (const item of ownerDetailsSectionItems(section, type)) {
          expect(source, `mobile is missing: ${item}`).toContain(item);
        }
      }
    }
  });

  it('titles the sections the same way', () => {
    for (const section of OWNER_DETAILS_SECTIONS) {
      expect(source).toContain(`'${OWNER_DETAILS_SECTION_TITLES[section]}'`);
    }
  });

  // The promise and the opt-out are the same sentence. A mobile copy
  // that advertises different words hands the owner a command the
  // webhook will not honour.
  it('quotes the same digest commands', () => {
    expect(source).toContain(`'${DIGEST_PAUSE_COMMAND}'`);
    expect(source).toContain(`'${DIGEST_RESUME_COMMAND}'`);
  });

  // Everything else in the message is prose held in string literals, so
  // the copies are compared literal by literal rather than by sampling
  // one rendered body. The import path is the one line allowed to
  // differ — Metro cannot resolve the web alias.
  it('carries every literal the web module does', () => {
    // Comments are stripped first: the two headers deliberately differ,
    // and an apostrophe in prose reads as a quote to the extractor.
    const literals = (text: string) =>
      new Set(
        stringLiterals(text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')).filter(
          (s) => !s.startsWith('@/')
        )
      );
    const web = literals(
      readFileSync(
        join(process.cwd(), 'src/lib/owners/details-request.ts'),
        'utf8'
      )
    );
    const mobile = literals(source);

    expect(web.size).toBeGreaterThan(30);
    for (const literal of web) {
      expect(mobile.has(literal), `mobile is missing: ${literal}`).toBe(true);
    }
  });

  it('renders a message the web builder would recognise', () => {
    const web = buildOwnerDetailsRequestMessage({
      ownerName: 'Mr Nadeem',
      propertyLabel: 'a corner site',
      propertyType: 'Residential Plot',
      agentName: 'Praneeth',
    });
    expect(web).toContain('*1. The property itself*');
    expect(web).not.toContain('What is built on it');
    expect(source).toContain(
      '*${i + 1}. ${OWNER_DETAILS_SECTION_TITLES[section]}*'
    );
  });
});

describe('mobile/lib/map-links.ts mirrors the pin resolver', () => {
  // The marker the app drops, the showcase iframe and the pin in the
  // WhatsApp reveal are all the same claim about where a property is.
  // Mobile ports this rather than importing it — `@shared/` is a
  // types-only alias, so a value import does not survive Metro — which
  // makes drift between the two copies the thing to guard.
  const source = mobileSource('lib/map-links.ts');
  const web = readFileSync(
    join(process.cwd(), 'src/lib/maps/map-links.ts'),
    'utf8'
  );

  it('resolves pins in the same order of truth', () => {
    for (const line of [
      'const linkCoordinates = link ? extractCoordinatesFromMapUrl(link) : null;',
      'linkCoordinates ?? toCoordinates(source.latitude ?? NaN, source.longitude ?? NaN);',
      'if (!linkCoordinates && link) {',
    ]) {
      expect(source).toContain(line);
      expect(web).toContain(line);
    }
  });

  it('builds the same link and embed URLs', () => {
    for (const literal of [
      '`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`',
      '`https://maps.google.com/maps?q=${pair}&z=16&output=embed`',
    ]) {
      expect(source).toContain(literal);
      expect(web).toContain(literal);
    }
  });

  it('contains the decode that would otherwise throw on a bad escape', () => {
    expect(source).toContain('decodedPath = decodeURIComponent(');
    expect(source).toContain('decodedPath = null;');
  });
});

describe('mobile/lib/photo-sources.ts mirrors photo-sources', () => {
  // Both galleries have to find a gated listing's photos in the guarded
  // bucket, in the same order, at the same proxy index — the index IS
  // the identifier the route reads.
  const source = mobileSource('lib/photo-sources.ts');

  it('builds the same proxy path', () => {
    expect(source).toContain(
      '`/api/properties/${propertyId}/private-images/${index}`'
    );
  });

  it('orders public photos before guarded ones', () => {
    expect(source).toContain('[...pub, ...guarded]');
  });

  it('indexes guarded photos by their place in private_images', () => {
    expect(source).toContain('guardedPhotoPath(p.id, i)');
  });

  // An agent who sees "2 photos · confidential" on the desktop and a
  // bare tile on the phone has no way to tell which surface is lying
  // about the listing they are about to pitch.
  it('withholds photos with the same wording', () => {
    expect(source).toContain(
      "`${withheld} photo${withheld === 1 ? '' : 's'} · confidential`"
    );
    expect(source).toContain("'No photos uploaded'");
  });

  it('applies the same guard before labelling', () => {
    expect(source).toContain('internalPhotoCount(p) > 0 || withheld <= 0');
  });
});

describe('mobile/lib/gate-stats.ts mirrors gate-stats', () => {
  // The card summary is a number an agent acts on. "3 asked · 1 open"
  // on the phone and something else on the desktop would leave them not
  // knowing which to trust, so the wording is pinned rather than the
  // mere presence of a helper.
  const source = mobileSource('lib/gate-stats.ts');

  it('produces the same summary for the same counts', () => {
    const cases = [
      { requested: 3, pending: 1, approved: 2, rejected: 0, liveGrants: 2 },
      { requested: 4, pending: 0, approved: 4, rejected: 0, liveGrants: 0 },
      { requested: 0, pending: 0, approved: 0, rejected: 0, liveGrants: 2 },
    ];
    // The mobile port is text here; assert the literals it builds from
    // match what the web builder emits for the same input.
    for (const c of cases) {
      const web = gateSummary({ ...c, lastRequestedAt: null });
      if (!web) continue;
      for (const part of web.split(' · ')) {
        const unit = part.replace(/^\d+ /, '');
        expect(source, `mobile is missing the "${unit}" wording`).toContain(
          `${unit}\``
        );
      }
    }
  });

  it('keeps the same activity threshold', () => {
    expect(source).toContain('s.requested > 0 || s.liveGrants > 0');
  });

  it('joins the parts the same way', () => {
    expect(source).toContain("parts.join(' · ')");
  });

  // Both request drawers label a request from this one function. A
  // timed-out consent chain reading "Rejected" on one surface and "No
  // answer" on the other would report two different things about the
  // same row.
  it.each(['pending', 'approved', 'rejected', 'expired', 'anything-else'])(
    'labels %s the same way',
    (status) => {
      expect(source).toContain(`'${gateRequestStatusLabel(status)}'`);
    }
  );
});

describe('mobile/lib/rental-yield.ts mirrors rental-yield', () => {
  // A rental's price is its monthly rent, so the naive sum reads 1200%.
  // The two surfaces showing a different yield for the same listing is
  // the drift that produced PROP-1205 in the first place.
  const source = mobileSource('lib/rental-yield.ts');

  it.each([
    ['Sale', 30_000_000, 150_000],
    ['Rent', 1_548_000, 1_548_000],
    ['Built to Suit', 1_548_000, 1_548_000],
    ['JV/JD', 30_000_000, 150_000],
    [null, 13_500_000, 62_000],
  ] as const)('agrees on %s', (listingType, price, rentalIncome) => {
    // The mobile copy is text here, so the shape is asserted rather than
    // executed: same excluded types, same formula, same rounding.
    expect(rentalYieldPercent(listingType, price, rentalIncome)).toBe(
      listingType === 'Sale' || listingType === null
        ? Number((((rentalIncome * 12) / price) * 100).toFixed(2))
        : null
    );
  });

  it('excludes the same listing types', () => {
    for (const type of MONTHLY_PRICED_LISTING_TYPES) {
      expect(source).toContain(`'${type}'`);
    }
    expect(source).toContain("return value === 'Sale'");
  });

  it('uses the same formula and rounding', () => {
    expect(source).toContain('(((r * 12) / p) * 100).toFixed(2)');
  });
});

describe('mobile/lib/format.ts mirrors priceInWords', () => {
  // Both platforms put this readout under every price input, so a drift
  // here shows the same amount two different ways — "₹1.2 Crore" on the
  // web and something else in the app, for the same field.
  const source = mobileSource('lib/format.ts');
  const block = source.slice(
    source.indexOf('export function priceInWords'),
    source.indexOf('/** Indian price notation')
  );

  it('exists', () => {
    expect(block, 'priceInWords not found in mobile format.ts').toContain(
      'priceInWords'
    );
  });

  it('uses the same crore and lakh thresholds and wording', () => {
    expect(block).toContain('10000000');
    expect(block).toContain('Crore');
    expect(block).toContain('100000');
    expect(block).toContain('Lakhs');
    expect(block).toContain('en-IN');
  });

  it('trims trailing zeros the same way, so 12000000 is ₹1.2 Crore', () => {
    expect(block).toContain(
      `toFixed(2).replace(/\\.00$/, '').replace(/\\.(\\d)0$/, '.$1')`
    );
  });

  it('agrees with the web output across the range', () => {
    // The mobile copy is checked as text (the web tsconfig excludes
    // mobile/), so pin the web side's answers here: these are the strings
    // the assertions above are guarding.
    expect(priceInWords(160000000)).toBe('₹16 Crore');
    expect(priceInWords(12000000)).toBe('₹1.2 Crore');
    expect(priceInWords(8500000)).toBe('₹85 Lakhs');
    expect(priceInWords(45000)).toBe('₹45,000');
    expect(priceInWords('')).toBe('');
  });
});

describe('mobile/lib/money-ladder.ts mirrors the Contacts budget ladder', () => {
  // Both platforms filter by the same money bounds — contact budgets on
  // Contacts, asking price on Properties. A drift means the same row
  // falls inside the band on one device and outside it on the other.
  const source = mobileSource('lib/money-ladder.ts');

  it("offers exactly the web ladder's steps, in the same order", () => {
    const steps = constBody(source, 'BUDGET_STEPS')
      .replace(/[[\]\s]/g, '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(steps).toEqual(BUDGET_OPTIONS.map((o) => Number(o.value)));
  });
});

describe('mobile contact screen mirrors the property-interest vocabulary', () => {
  const source = mobileSource('app/(app)/contact/[id].tsx');

  it("offers exactly the web's in-app interest options, in the same order", () => {
    // Declared as a plain `const` inside the screen, so it is sliced here
    // rather than through constBody's `export const` lookup.
    const start = source.indexOf('const PROPERTY_INTEREST_OPTIONS');
    expect(start).toBeGreaterThan(-1);
    const open = source.indexOf('[', start);
    const end = source.indexOf('];', open);

    expect(stringLiterals(source.slice(open, end))).toEqual([
      ...PROPERTY_INTEREST_OPTIONS,
    ]);
  });
});

describe('property-interest vocabulary split', () => {
  it('keeps every Flow id inside the in-app option list', () => {
    // The Flow subset is what Meta renders; anything in it that the
    // in-app pickers do not offer would be unreachable for an agent.
    const inApp = new Set<string>(PROPERTY_INTEREST_OPTIONS);
    for (const id of PROPERTY_INTEREST_FLOW_IDS) {
      expect(inApp.has(id)).toBe(true);
    }
  });

  it("stays within Meta's 30-char CheckboxGroup item limit", () => {
    for (const id of PROPERTY_INTEREST_FLOW_IDS) {
      const title = PROPERTY_INTEREST_SHORT_TITLES[id] ?? id;
      expect(title.length).toBeLessThanOrEqual(30);
    }
  });

  it("stays within Meta's CheckboxGroup item count", () => {
    // The options arrive as dynamic data, so overshooting this shows up
    // in a buyer's WhatsApp client rather than at publish time. Fail
    // here instead. The in-app list is free to exceed it — that is the
    // whole reason the two lists are separate.
    expect(PROPERTY_INTEREST_FLOW_IDS.length).toBeLessThanOrEqual(
      FLOW_CHECKBOX_MAX_ITEMS
    );
    expect(PROPERTY_INTEREST_OPTIONS.length).toBeGreaterThan(
      FLOW_CHECKBOX_MAX_ITEMS
    );
  });
});

describe("mobile/lib/copilot-tours.ts mirrors the tour registry's mobileSteps", () => {
  // \u{...} escapes in the mobile source are resolved so emoji-carrying
  // bodies compare equal to the web registry's runtime strings.
  const source = mobileSource('lib/copilot-tours.ts').replace(
    /\\u\{([0-9a-fA-F]+)\}/g,
    (_, hex) => String.fromCodePoint(parseInt(hex, 16))
  );
  const mobileCapable = TOURS.filter((t) => t.mobileSteps?.length);

  it('carries every mobile-capable tour, and nothing else', () => {
    const ids = stringLiteralsInConst(source, 'MOBILE_TOURS').filter(
      (s) =>
        mobileCapable.some((t) => t.id === s) || TOURS.some((t) => t.id === s)
    );
    for (const tour of mobileCapable) {
      expect(ids, tour.id).toContain(tour.id);
    }
    for (const tour of TOURS.filter((t) => !t.mobileSteps?.length)) {
      expect(ids, `${tour.id} has no mobileSteps`).not.toContain(tour.id);
    }
  });

  it.each(mobileCapable.map((t) => [t.id, t] as const))(
    '%s keeps the web copy and step data',
    (_id, tour) => {
      expect(source).toContain(`title: '${tour.title.replace(/'/g, "\\'")}'`);
      expect(source).toContain(tour.description);
      for (const step of tour.mobileSteps!) {
        expect(source).toContain(`screen: '${step.screen}'`);
        expect(source).toContain(`target: '${step.target}'`);
        expect(source).toContain(step.body);
        expect(source).toContain(`advanceOn: '${step.advanceOn}'`);
      }
    }
  );
});

describe('mobile/lib/contact-interest.ts mirrors the web project axis', () => {
  // Both surfaces derive the project picker from the same function; a
  // divergence would make the two lists disagree on dedupe or order.
  function projectOptionsBody(source: string): string {
    const start = source.indexOf('export function projectOptions');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end).replace(/\s+/g, ' ');
  }

  it('keeps projectOptions byte-equivalent to the web implementation', () => {
    const web = readFileSync(
      join(process.cwd(), 'src/lib/contacts/contact-interest.ts'),
      'utf8'
    );
    expect(projectOptionsBody(mobileSource('lib/contact-interest.ts'))).toBe(
      projectOptionsBody(web)
    );
  });
});

describe("mobile/lib/i18n.ts mirrors the web catalogue's copilot slice", () => {
  // Importing the module would make vitest transform a file governed by
  // mobile/tsconfig.json, which extends expo/tsconfig.base — absent
  // unless mobile deps are installed (the web CI job does not). The
  // catalogue is emitted with JSON.stringify, so its entry lines parse
  // back losslessly as JSON instead.
  const source = mobileSource('lib/i18n.ts');

  function parsedCatalogue(lang: string): Record<string, string> {
    const decl = `\n  ${lang}: {\n`;
    const start = source.indexOf(decl);
    expect(start, `no ${lang} catalogue in mobile i18n`).toBeGreaterThan(-1);
    const end = source.indexOf('\n  },', start);
    const body = source
      .slice(start + decl.length, end)
      .trim()
      .replace(/,$/, '');
    return JSON.parse(`{${body}}`) as Record<string, string>;
  }

  it('keeps every ported key byte-equal in every language', () => {
    const en = parsedCatalogue('en');
    expect(Object.keys(en).length).toBeGreaterThanOrEqual(20);
    for (const lang of Object.keys(MESSAGES)) {
      const catalogue = parsedCatalogue(lang);
      expect(Object.keys(catalogue).sort(), lang).toEqual(
        Object.keys(en).sort()
      );
      const web = MESSAGES[lang as keyof typeof MESSAGES] as Record<
        string,
        string
      >;
      for (const [key, value] of Object.entries(catalogue)) {
        expect(
          web[key],
          `${lang}/${key} missing from web catalogue`
        ).toBeDefined();
        expect(value, `${lang}/${key}`).toBe(web[key]);
      }
    }
  });
});
