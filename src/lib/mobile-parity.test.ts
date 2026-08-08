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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_CONFIG, PLAN_ORDER } from "@/lib/billing/plan-config";
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
  isLandType,
  isRawLandType,
} from "@/lib/inventory/property-options";
import { PROPERTY_TYPE_VALUES } from "@/lib/property-types";
import { priceInWords } from "@/lib/currency-utils";
import {
  FLOW_CHECKBOX_MAX_ITEMS,
  PROPERTY_INTEREST_FLOW_IDS,
  PROPERTY_INTEREST_OPTIONS,
  PROPERTY_INTEREST_SHORT_TITLES,
} from "@/lib/property-interests";
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from "@/lib/whatsapp/customer-window";
import { DELIVERY_FAILURE_MARKER } from "@/lib/whatsapp/delivery-failure";
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_MESSAGE,
  MAX_PINNED_PER_CONVERSATION,
} from "@/lib/whatsapp/message-state";

function mobileSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), "mobile", relativePath), "utf8");
}

/** The `[ ... ]` body of an `export const <name> = [ ... ];` block. */
function constBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  if (start === -1) throw new Error(`${name} not found in mobile source`);
  const open = source.indexOf("[", start);
  const end = source.indexOf("];", open);
  if (open === -1 || end === -1) throw new Error(`${name} is not an array literal`);
  return source.slice(open, end);
}

/** String literals inside an `export const <name> = [ ... ];` block. */
function stringLiteralsInConst(source: string, name: string): string[] {
  return stringLiterals(constBody(source, name));
}

function stringLiterals(block: string): string[] {
  return Array.from(block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)).map((m) =>
    (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"')
  );
}

describe("mobile/lib/plan-meta.ts mirrors plan-config", () => {
  const source = mobileSource("lib/plan-meta.ts");

  /** The `PLAN_META` entry body for one plan, e.g. everything between
   *  `starter: {` and its closing brace. */
  function planBlock(plan: string): string {
    const start = source.indexOf(`  ${plan}: {`);
    expect(start, `no PLAN_META entry for ${plan}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n  },", start);
    return source.slice(start, end);
  }

  it.each(PLAN_ORDER)("%s keeps the web label and tagline", (plan) => {
    const block = planBlock(plan);
    expect(block).toContain(`label: '${PLAN_CONFIG[plan].name}'`);
    expect(block).toContain(`tagline: '${PLAN_CONFIG[plan].tagline}'`);
  });

  // Perks are editorial prose, so we can't derive the string — but every
  // number quoted in it must be that plan's real limit, and a capped
  // plan must never be sold as "unlimited".
  const LIMIT_BY_UNIT: Record<string, keyof (typeof PLAN_CONFIG)["starter"]> = {
    user: "maxUsers",
    users: "maxUsers",
    member: "maxUsers",
    members: "maxUsers",
    contact: "maxContacts",
    contacts: "maxContacts",
    property: "maxProperties",
    properties: "maxProperties",
    broadcast: "maxBroadcastsPerMonth",
    broadcasts: "maxBroadcastsPerMonth",
  };

  it.each(PLAN_ORDER)("%s quotes real limits in its perks line", (plan) => {
    const perks = /perks: '([^']*)'/.exec(planBlock(plan))?.[1];
    expect(perks, `no perks string for ${plan}`).toBeDefined();

    const quoted = Array.from(
      perks!.matchAll(/([\d,]+)\s+(users?|members?|contacts?|properties|broadcasts?)/g)
    );
    expect(quoted.length, `perks for ${plan} quote no limits at all`).toBeGreaterThan(0);

    for (const [, rawCount, unit] of quoted) {
      const field = LIMIT_BY_UNIT[unit];
      expect(Number(rawCount.replace(/,/g, "")), `${plan} perks "${unit}"`).toBe(
        PLAN_CONFIG[plan][field]
      );
    }

    for (const unit of Object.keys(LIMIT_BY_UNIT)) {
      if (new RegExp(`unlimited\\s+${unit}\\b`, "i").test(perks!)) {
        expect(
          PLAN_CONFIG[plan][LIMIT_BY_UNIT[unit]],
          `${plan} perks say unlimited ${unit} but the plan is capped`
        ).toBe(Number.POSITIVE_INFINITY);
      }
    }
  });
});

describe("mobile/lib/property-options.ts mirrors the web option catalog", () => {
  const source = mobileSource("lib/property-options.ts");

  it("offers the same property types in the same groups", () => {
    const groups = Array.from(
      source.matchAll(/group: '([^']+)',\s*options: \[([\s\S]*?)\]/g)
    ).map(([, group, body]) => ({ group, options: stringLiterals(body) }));

    // The Commercial group spreads COMMERCIAL_TYPES rather than listing
    // them, so fill it in from the const the spread refers to.
    const commercial = stringLiteralsInConst(source, "COMMERCIAL_TYPES");
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

  it("gates commercial fields on the same type list", () => {
    expect(stringLiteralsInConst(source, "COMMERCIAL_TYPES")).toEqual(COMMERCIAL_TYPES);
  });

  it.each([
    ["FACING_DIRECTIONS", FACING_DIRECTIONS],
    ["AREA_UNITS", AREA_UNITS],
    ["NEARBY_HIGHLIGHTS_OPTIONS", NEARBY_HIGHLIGHTS_OPTIONS],
    ["LAND_OWNERSHIP_TYPES", LAND_OWNERSHIP_TYPES],
    ["LAND_LEGAL_STATUSES", LAND_LEGAL_STATUSES],
    ["LAND_CONVERSION_TYPES", LAND_CONVERSION_TYPES],
  ])("keeps %s in sync", (name, expected) => {
    expect(stringLiteralsInConst(source, name)).toEqual(expected);
  });

  // The type predicates decide which field groups an editor renders.
  // Mobile shipped without them, so a plot's editor asked for bedrooms
  // and a super-built area — fields a vacant parcel cannot have.
  // Compared by behaviour across the whole taxonomy rather than by
  // literal, since the mobile lists reference a shared legacy const.
  it.each([
    ["BEDS_BATHS_TYPES", hasBedsBaths],
    ["LAND_TYPES", isLandType],
    ["RAW_LAND_TYPES", isRawLandType],
  ])("classifies every property type the same way as %s", (name, webPredicate) => {
    const body = constBody(source, name);
    const members = new Set(stringLiterals(body));
    if (body.includes("LEGACY_RESIDENTIAL_LAND_PLOT")) {
      members.add(LEGACY_RESIDENTIAL_LAND_PLOT);
    }

    for (const type of PROPERTY_TYPE_VALUES) {
      expect(members.has(type), `${name} disagrees on "${type}"`).toBe(webPredicate(type));
    }
  });

  it("offers the same amenities under the same categories", () => {
    const categories = Array.from(
      source.matchAll(/category: '((?:[^'\\]|\\.)*)',\s*\n\s*items: \[([\s\S]*?)\]/g)
    ).map(([, category, body]) => [
      category.replace(/\\'/g, "'"),
      stringLiterals(body),
    ]);

    expect(Object.fromEntries(categories)).toEqual(AMENITIES_BY_CATEGORY);
  });
});

describe("mobile/lib/customer-window.ts mirrors customer-window", () => {
  // Meta rejects the send when this is wrong, so the two copies have to
  // agree on the window length, the error markers, and the pre-flight
  // message that `isReengagementError` has to keep recognising.
  const source = mobileSource("lib/customer-window.ts");

  it("uses the same 24-hour window", () => {
    expect(source).toContain(`CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000`);
  });

  it("matches the same re-engagement markers", () => {
    for (const marker of ["131047", "24 hours", "re-engagement"]) {
      expect(source, `missing marker ${marker}`).toContain(marker);
    }
  });

  it("throws the same pre-flight message", () => {
    expect(source).toContain(CUSTOMER_WINDOW_EXPIRED_MESSAGE);
  });
});

describe("mobile/lib/reply-state.ts mirrors reply-state", () => {
  // Both inboxes decide "does this thread need a human?" from the same
  // conversation columns. If the copies disagree, a thread shows as
  // handled on one surface and waiting on the other.
  const source = mobileSource("lib/reply-state.ts");
  const web = readFileSync(
    join(process.cwd(), "src/lib/whatsapp/reply-state.ts"),
    "utf8"
  );

  it.each(["needsReply", "waitingShort", "needsReplyLabel"])(
    "keeps the %s body identical to the web source",
    (name) => {
      const body = (s: string) => {
        const start = s.indexOf(`export function ${name}`);
        expect(start, `${name} missing`).toBeGreaterThan(-1);
        const end = s.indexOf("\n}", start);
        return s.slice(start, end);
      };
      expect(body(source)).toBe(body(web));
    }
  );
});

describe("mobile/lib/message-actions.ts mirrors delivery-failure", () => {
  // The marker is what a resend or forward cuts the failure note off at.
  // If the webhook's wording changes and the mobile copy doesn't, the
  // agent's own error report goes back out to the customer.
  it("cuts at the same marker", () => {
    expect(mobileSource("lib/message-actions.ts")).toContain(DELIVERY_FAILURE_MARKER);
  });
});

describe("mobile/lib/message-reactions.ts mirrors the web quick-reaction bar", () => {
  // Both surfaces sit on the same message rows and the same
  // /api/whatsapp/react route. An emoji offered on one and missing on
  // the other reads as a broken thread to whoever reached for the
  // second surface, so the bars have to stay identical.
  it("offers the same quick reactions the web thread does", () => {
    const web = stringLiterals(
      readFileSync(
        join(process.cwd(), "src/components/inbox/message-actions.tsx"),
        "utf8"
      ).match(/const QUICK_EMOJIS = \[[^\]]*\]/)?.[0] ?? ""
    );

    expect(web.length).toBeGreaterThan(0);
    expect(stringLiteralsInConst(mobileSource("lib/message-reactions.ts"), "QUICK_EMOJIS")).toEqual(
      web
    );
  });
});

describe("mobile/lib/message-state.ts mirrors message-state", () => {
  // Pin and hide are Engine-local: WhatsApp has no revoke endpoint and
  // no pin outside a group. If either copy stops saying so, an agent
  // tells a customer their message was deleted when it is still on
  // their phone — so the wording is pinned, not just the cap.
  const source = mobileSource("lib/message-state.ts");

  it("uses the same pin ceiling", () => {
    expect(source).toContain(
      `MAX_PINNED_PER_CONVERSATION = ${MAX_PINNED_PER_CONVERSATION}`,
    );
  });

  it("carries the same confirmation copy, verbatim", () => {
    expect(source).toContain(HIDE_CONFIRM_MESSAGE);
  });

  it("names the action the same way on both surfaces", () => {
    expect(source).toContain(HIDE_ACTION_LABEL);
  });

  it("still warns, in its own header, that neither reaches WhatsApp", () => {
    expect(source).toMatch(/no revoke endpoint/i);
  });
});

describe("mobile/lib/share-message.ts mirrors share-message-builder", () => {
  it("exports every function the web builder does", () => {
    const exportedFunctions = (source: string) =>
      Array.from(source.matchAll(/export function (\w+)/g))
        .map((m) => m[1])
        .sort();

    const web = exportedFunctions(
      readFileSync(join(process.cwd(), "src/lib/share-message-builder.ts"), "utf8")
    );
    const mobile = exportedFunctions(mobileSource("lib/share-message.ts"));

    // Mobile may add surface-specific builders on top; it must never be
    // missing one the web share dialog relies on.
    expect(mobile).toEqual(expect.arrayContaining(web));
  });
});

describe("mobile/lib/format.ts mirrors priceInWords", () => {
  // Both platforms put this readout under every price input, so a drift
  // here shows the same amount two different ways — "₹1.2 Crore" on the
  // web and something else in the app, for the same field.
  const source = mobileSource("lib/format.ts");
  const block = source.slice(
    source.indexOf("export function priceInWords"),
    source.indexOf("/** Indian price notation")
  );

  it("exists", () => {
    expect(block, "priceInWords not found in mobile format.ts").toContain("priceInWords");
  });

  it("uses the same crore and lakh thresholds and wording", () => {
    expect(block).toContain("10000000");
    expect(block).toContain("Crore");
    expect(block).toContain("100000");
    expect(block).toContain("Lakhs");
    expect(block).toContain("en-IN");
  });

  it("trims trailing zeros the same way, so 12000000 is ₹1.2 Crore", () => {
    expect(block).toContain(`toFixed(2).replace(/\\.00$/, '').replace(/\\.(\\d)0$/, '.$1')`);
  });

  it("agrees with the web output across the range", () => {
    // The mobile copy is checked as text (the web tsconfig excludes
    // mobile/), so pin the web side's answers here: these are the strings
    // the assertions above are guarding.
    expect(priceInWords(160000000)).toBe("₹16 Crore");
    expect(priceInWords(12000000)).toBe("₹1.2 Crore");
    expect(priceInWords(8500000)).toBe("₹85 Lakhs");
    expect(priceInWords(45000)).toBe("₹45,000");
    expect(priceInWords("")).toBe("");
  });
});

describe("mobile contact screen mirrors the property-interest vocabulary", () => {
  const source = mobileSource("app/(app)/contact/[id].tsx");

  it("offers exactly the web's in-app interest options, in the same order", () => {
    // Declared as a plain `const` inside the screen, so it is sliced here
    // rather than through constBody's `export const` lookup.
    const start = source.indexOf("const PROPERTY_INTEREST_OPTIONS");
    expect(start).toBeGreaterThan(-1);
    const open = source.indexOf("[", start);
    const end = source.indexOf("];", open);

    expect(stringLiterals(source.slice(open, end))).toEqual([
      ...PROPERTY_INTEREST_OPTIONS,
    ]);
  });
});

describe("property-interest vocabulary split", () => {
  it("keeps every Flow id inside the in-app option list", () => {
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
