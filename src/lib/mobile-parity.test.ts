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
} from "@/lib/inventory/property-options";
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from "@/lib/whatsapp/customer-window";

function mobileSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), "mobile", relativePath), "utf8");
}

/** String literals inside an `export const <name> = [ ... ];` block. */
function stringLiteralsInConst(source: string, name: string): string[] {
  const start = source.indexOf(`export const ${name}`);
  if (start === -1) throw new Error(`${name} not found in mobile source`);
  const open = source.indexOf("[", start);
  const end = source.indexOf("];", open);
  if (open === -1 || end === -1) throw new Error(`${name} is not an array literal`);
  return stringLiterals(source.slice(open, end));
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
  ])("keeps %s in sync", (name, expected) => {
    expect(stringLiteralsInConst(source, name)).toEqual(expected);
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
