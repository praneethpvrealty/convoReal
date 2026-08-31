import { describe, it, expect } from "vitest";
import {
  matchReplyId,
  findReplyIdAcrossNodes,
  appendUnmatchedText,
  UNMATCHED_TEXT_MAX_LENGTH,
  REPROMPT_BODY_TEXT,
  isAcknowledgementOnly,
  matchesKeywordTrigger,
  isAutoAdvancing,
  isSuspending,
  isTerminal,
  evaluateConditionPredicate,
  splitByBudget,
  matchListingSelection,
  resolveInterestTarget,
  buildHandoffBrief,
  preferLocality,
  type ShownListing,
  type ListingRow,
} from "./engine";

describe("matchReplyId", () => {
  it("returns null for nodes without options", () => {
    expect(
      matchReplyId({ node_type: "start", config: { next_node_key: "x" } }, "y"),
    ).toBeNull();
    expect(
      matchReplyId({ node_type: "send_message", config: {} }, "y"),
    ).toBeNull();
    expect(matchReplyId({ node_type: "end", config: {} }, "y")).toBeNull();
  });

  it("matches the buttons array on a send_buttons node", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick one",
        buttons: [
          { reply_id: "yes", title: "Yes", next_node_key: "confirmed" },
          { reply_id: "no", title: "No", next_node_key: "declined" },
        ],
      },
    };
    expect(matchReplyId(node, "yes")).toBe("confirmed");
    expect(matchReplyId(node, "no")).toBe("declined");
  });

  it("returns null when no button reply_id matches", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick",
        buttons: [
          { reply_id: "a", title: "A", next_node_key: "to_a" },
          { reply_id: "b", title: "B", next_node_key: "to_b" },
        ],
      },
    };
    expect(matchReplyId(node, "c")).toBeNull();
    expect(matchReplyId(node, "")).toBeNull();
  });

  it("searches across all sections in a send_list node", () => {
    const node = {
      node_type: "send_list",
      config: {
        text: "Pick an order",
        button_label: "View",
        sections: [
          {
            title: "Recent",
            rows: [
              { reply_id: "o1", title: "Order 1", next_node_key: "ord_1" },
            ],
          },
          {
            title: "Older",
            rows: [
              { reply_id: "o2", title: "Order 2", next_node_key: "ord_2" },
              { reply_id: "o3", title: "Order 3", next_node_key: "ord_3" },
            ],
          },
        ],
      },
    };
    expect(matchReplyId(node, "o1")).toBe("ord_1");
    expect(matchReplyId(node, "o2")).toBe("ord_2");
    expect(matchReplyId(node, "o3")).toBe("ord_3");
    expect(matchReplyId(node, "o99")).toBeNull();
  });

  it("returns null when send_list has no sections / empty sections", () => {
    expect(
      matchReplyId(
        { node_type: "send_list", config: { text: "x", sections: [] } },
        "x",
      ),
    ).toBeNull();
    expect(
      matchReplyId(
        {
          node_type: "send_list",
          config: { text: "x", sections: [{ rows: [] }] },
        },
        "x",
      ),
    ).toBeNull();
  });
});

describe("findReplyIdAcrossNodes — stale-button branch switch", () => {
  // The bug from the field: welcome node offers Buy / List buttons;
  // customer taps "Buy Property", flow advances to the buy branch,
  // then the customer taps "List My Property" on the OLD welcome
  // bubble. The current node doesn't know that reply_id — the flow
  // must find it on the welcome node and switch branches.
  const welcome = {
    node_key: "welcome",
    node_type: "send_buttons",
    config: {
      text: "What are you looking to do?",
      buttons: [
        { reply_id: "buy", title: "Buy Property", next_node_key: "buy_branch" },
        { reply_id: "list", title: "List My Property", next_node_key: "list_branch" },
      ],
    },
  };
  const buyBranch = {
    node_key: "buy_branch",
    node_type: "send_buttons",
    config: {
      text: "What type of property interests you?",
      buttons: [
        { reply_id: "flat", title: "Flat", next_node_key: "flat_q" },
        { reply_id: "plot", title: "Plot", next_node_key: "plot_q" },
      ],
    },
  };

  it("finds a reply_id owned by an earlier node and returns its branch target", () => {
    const hit = findReplyIdAcrossNodes([welcome, buyBranch], "list", "buy_branch");
    expect(hit).toEqual({ node_key: "welcome", next_node_key: "list_branch" });
  });

  it("skips the excluded (current) node so its own misses stay misses", () => {
    expect(findReplyIdAcrossNodes([buyBranch], "unknown", "buy_branch")).toBeNull();
  });

  it("returns null when no node in the flow owns the reply_id", () => {
    expect(findReplyIdAcrossNodes([welcome, buyBranch], "nope", null)).toBeNull();
  });

  it("searches send_list rows too", () => {
    const listNode = {
      node_key: "areas",
      node_type: "send_list",
      config: {
        text: "Pick an area",
        button_label: "Areas",
        sections: [
          { title: "North", rows: [{ reply_id: "devanahalli", title: "Devanahalli", next_node_key: "devanahalli_q" }] },
        ],
      },
    };
    const hit = findReplyIdAcrossNodes([welcome, listNode], "devanahalli", "welcome");
    expect(hit).toEqual({ node_key: "areas", next_node_key: "devanahalli_q" });
  });
});

describe("appendUnmatchedText — free-text capture for handoff context", () => {
  it("stores fresh text verbatim (whitespace collapsed)", () => {
    expect(
      appendUnmatchedText(null, "80000 rented house\n three floor building  near devanahalli"),
    ).toBe("80000 rented house three floor building near devanahalli");
  });

  it("appends to existing requirements with a separator", () => {
    expect(appendUnmatchedText("3BHK in JP Nagar", "budget 80 lakhs")).toBe(
      "3BHK in JP Nagar | budget 80 lakhs",
    );
  });

  it("skips noise-length text", () => {
    expect(appendUnmatchedText("existing", "ok")).toBeNull();
    expect(appendUnmatchedText(null, "  hi ")).toBeNull();
  });

  it("skips text already present (case-insensitive)", () => {
    expect(appendUnmatchedText("Budget 80 Lakhs near HSR", "budget 80 lakhs")).toBeNull();
  });

  it("caps total length keeping the newest content", () => {
    const existing = "x".repeat(UNMATCHED_TEXT_MAX_LENGTH);
    const merged = appendUnmatchedText(existing, "three floor building near devanahalli");
    expect(merged).not.toBeNull();
    expect(merged!.length).toBe(UNMATCHED_TEXT_MAX_LENGTH);
    expect(merged!.endsWith("three floor building near devanahalli")).toBe(true);
  });
});

describe("REPROMPT_BODY_TEXT", () => {
  it("is apologetic, short, and points at the buttons", () => {
    expect(REPROMPT_BODY_TEXT).toMatch(/didn't quite catch/i);
    expect(REPROMPT_BODY_TEXT).toMatch(/tap one of the options/i);
    // WhatsApp interactive body cap is 1024 chars — stay far under.
    expect(REPROMPT_BODY_TEXT.length).toBeLessThan(200);
  });
});

describe("matchesKeywordTrigger — word boundaries", () => {
  // The showcase funnel ships with "hi" among its keywords. Naive
  // substring matching made it fire on "which"/"this", restarting the
  // welcome funnel underneath a live agent conversation.
  const cfg = { keywords: ["hello", "hi", "buy", "rent"] };

  it("does not match a keyword buried inside another word", () => {
    expect(
      matchesKeywordTrigger(
        "There are two building pics in the link above. Which one is the one we are talking here.",
        cfg,
      ),
    ).toBe(false);
    expect(matchesKeywordTrigger("Is this still available?", cfg)).toBe(false);
    expect(matchesKeywordTrigger("The parking is behind the block", cfg)).toBe(false);
    expect(matchesKeywordTrigger("current tenant pays maintenance", cfg)).toBe(false);
  });

  it("still matches the keyword as a whole word", () => {
    expect(matchesKeywordTrigger("hi there", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I want to buy a plot", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Hello!", cfg)).toBe(true);
    expect(matchesKeywordTrigger("looking to RENT.", cfg)).toBe(true);
  });

  it("matches multi-word keywords as a phrase", () => {
    expect(
      matchesKeywordTrigger("can we book a site visit", { keywords: ["site visit"] }),
    ).toBe(true);
    expect(
      matchesKeywordTrigger("the site visitor logged in", { keywords: ["site visit"] }),
    ).toBe(false);
  });

  it("falls back to plain containment for keywords with no word characters", () => {
    expect(matchesKeywordTrigger("sounds good 👍 thanks", { keywords: ["👍"] })).toBe(true);
  });
});

describe("matchesKeywordTrigger", () => {
  it("returns false for empty text", () => {
    expect(matchesKeywordTrigger("", { keywords: ["hi"] })).toBe(false);
  });

  it("returns false when keywords array is empty", () => {
    expect(matchesKeywordTrigger("anything", { keywords: [] })).toBe(false);
  });

  it("default match_type='contains' does case-insensitive substring", () => {
    const cfg = { keywords: ["support"] };
    expect(matchesKeywordTrigger("I need SUPPORT please", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Support is great", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Help me", cfg)).toBe(false);
  });

  it("match_type='exact' compares the whole string case-insensitively", () => {
    const cfg = { keywords: ["help"], match_type: "exact" as const };
    expect(matchesKeywordTrigger("help", cfg)).toBe(true);
    expect(matchesKeywordTrigger("HELP", cfg)).toBe(true);
    expect(matchesKeywordTrigger("help me", cfg)).toBe(false);
  });

  it("case_sensitive=true preserves case", () => {
    const cfg = {
      keywords: ["Support"],
      case_sensitive: true,
    };
    expect(matchesKeywordTrigger("I need Support", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need support", cfg)).toBe(false);
  });

  it("matches any one of multiple keywords", () => {
    const cfg = { keywords: ["help", "support", "issue"] };
    expect(matchesKeywordTrigger("I have an issue", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need Help!", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nothing to see here", cfg)).toBe(false);
  });

  it("skips empty strings in the keywords array", () => {
    const cfg = { keywords: ["", "support", ""] };
    expect(matchesKeywordTrigger("support center", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nope", cfg)).toBe(false);
  });
});

describe("node classification helpers", () => {
  it("isAutoAdvancing covers start + send_message + send_media + condition + set_tag", () => {
    expect(isAutoAdvancing("start")).toBe(true);
    expect(isAutoAdvancing("send_message")).toBe(true);
    expect(isAutoAdvancing("send_media")).toBe(true);
    expect(isAutoAdvancing("condition")).toBe(true);
    expect(isAutoAdvancing("set_tag")).toBe(true);
    expect(isAutoAdvancing("send_buttons")).toBe(false);
    expect(isAutoAdvancing("send_list")).toBe(false);
    expect(isAutoAdvancing("collect_input")).toBe(false);
    expect(isAutoAdvancing("handoff")).toBe(false);
    expect(isAutoAdvancing("end")).toBe(false);
  });

  it("isSuspending covers the input-requiring nodes", () => {
    expect(isSuspending("send_buttons")).toBe(true);
    expect(isSuspending("send_list")).toBe(true);
    expect(isSuspending("collect_input")).toBe(true);
    expect(isSuspending("start")).toBe(false);
    expect(isSuspending("send_message")).toBe(false);
    expect(isSuspending("condition")).toBe(false);
    expect(isSuspending("set_tag")).toBe(false);
    expect(isSuspending("handoff")).toBe(false);
    expect(isSuspending("end")).toBe(false);
  });

  it("isTerminal covers handoff + end", () => {
    expect(isTerminal("handoff")).toBe(true);
    expect(isTerminal("end")).toBe(true);
    expect(isTerminal("start")).toBe(false);
    expect(isTerminal("send_buttons")).toBe(false);
    expect(isTerminal("condition")).toBe(false);
  });

  it("the three classifications are mutually exclusive for known node types", () => {
    const types = [
      "start",
      "send_message",
      "send_buttons",
      "send_list",
      "send_media",
      "collect_input",
      "condition",
      "set_tag",
      "handoff",
      "end",
    ];
    for (const t of types) {
      const flags = [isAutoAdvancing(t), isSuspending(t), isTerminal(t)];
      // Exactly one of the three should be true for every known node.
      expect(flags.filter(Boolean).length).toBe(1);
    }
  });
});

describe("evaluateConditionPredicate", () => {
  it("present: true when subject has a value", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "alice@example.com",
        configValue: undefined,
      }),
    ).toBe(true);
  });

  it("present: false when subject is undefined or empty", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(false);
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("absent: inverse of present", () => {
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: "x",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("equals: exact string comparison; case-sensitive", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "VIP",
        configValue: "VIP",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "vip",
        configValue: "VIP",
      }),
    ).toBe(false);
  });

  it("equals: undefined subject never matches (even against empty)", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: undefined,
        configValue: "",
      }),
    ).toBe(false);
  });

  it("contains: substring match", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@example.com",
        configValue: "@example.com",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@other.com",
        configValue: "@example.com",
      }),
    ).toBe(false);
  });

  it("contains: undefined subject never matches", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: undefined,
        configValue: "anything",
      }),
    ).toBe(false);
  });
});

describe("splitByBudget", () => {
  const row = (id: string, price: number | null): ListingRow => ({
    id,
    title: `Listing ${id}`,
    location: "Bangalore",
    type: "Commercial Shop",
    bedrooms: null,
    area_sqft: null,
    price,
    property_code: `PROP-${id}`,
    listing_type: "Sale",
  });

  it("leads with what the lead can actually afford", () => {
    const { withinBudget, aboveBudget } = splitByBudget(
      [row("a", 320_000_000), row("b", 103_000_000), row("c", 18_000_000)],
      "1-2cr",
      5,
    );
    expect(withinBudget.map((p) => p.id)).toEqual(["c"]);
    expect(aboveBudget.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("puts the nearest stretch first, not the most expensive listing in stock", () => {
    const { aboveBudget } = splitByBudget(
      [row("dear", 500_000_000), row("near", 25_000_000)],
      "1-2cr",
      5,
    );
    expect(aboveBudget[0].id).toBe("near");
  });

  it("never spends a slot on a stretch listing while in-budget stock remains", () => {
    const within = [row("w1", 10_000_000), row("w2", 11_000_000), row("w3", 12_000_000)];
    const { withinBudget, aboveBudget } = splitByBudget(
      [...within, row("over", 900_000_000)],
      "1-2cr",
      3,
    );
    expect(withinBudget).toHaveLength(3);
    expect(aboveBudget).toHaveLength(0);
  });

  it("keeps price-on-request listings rather than dropping them", () => {
    const { withinBudget } = splitByBudget([row("poa", null)], "1-2cr", 5);
    expect(withinBudget.map((p) => p.id)).toEqual(["poa"]);
  });

  it("is a no-op when no budget was collected", () => {
    const rows = [row("a", 320_000_000), row("b", 18_000_000)];
    const { withinBudget, aboveBudget } = splitByBudget(rows, null, 5);
    expect(withinBudget.map((p) => p.id)).toEqual(["a", "b"]);
    expect(aboveBudget).toHaveLength(0);
  });

  it("is a no-op when the budget text means nothing", () => {
    const rows = [row("a", 320_000_000)];
    expect(splitByBudget(rows, "not sure yet", 5).withinBudget).toHaveLength(1);
  });
});

describe("matchListingSelection", () => {
  const shown: ShownListing[] = [
    { n: 1, id: "p1", title: "Hoodi office", code: "PROP-1091" },
    { n: 2, id: "p2", title: "BTM corner", code: "PROP-1077" },
    { n: 3, id: "p3", title: "Whitefield", code: null },
  ];

  it("resolves a bare number to the listing that carried it", () => {
    expect(matchListingSelection("2", shown)?.id).toBe("p2");
  });

  it("tolerates how people actually type it", () => {
    expect(matchListingSelection(" 3 ", shown)?.id).toBe("p3");
    expect(matchListingSelection("no 1", shown)?.id).toBe("p1");
    expect(matchListingSelection("#2", shown)?.id).toBe("p2");
    expect(matchListingSelection("2.", shown)?.id).toBe("p2");
  });

  it("ignores a number nobody was shown", () => {
    expect(matchListingSelection("7", shown)).toBeNull();
    expect(matchListingSelection("0", shown)).toBeNull();
  });

  it("does not mistake a phone number or a price for a selection", () => {
    expect(matchListingSelection("call me on 9880012345", shown)).toBeNull();
    expect(matchListingSelection("1-2cr", shown)).toBeNull();
    expect(matchListingSelection("9880012345", shown)).toBeNull();
  });

  it("leaves an ambiguous multi-pick to an agent", () => {
    expect(matchListingSelection("2 and 3", shown)).toBeNull();
  });

  it("is inert when no listings were shown", () => {
    expect(matchListingSelection("2", [])).toBeNull();
  });
});

describe("resolveInterestTarget", () => {
  const buttons = [
    { reply_id: "explore_more", title: "View More Categories", next_node_key: "buy_menu" },
    { reply_id: "talk_to_agent", title: "Talk to an Agent", next_node_key: "collect_email" },
  ];

  it("uses the explicit key when the node declares one", () => {
    expect(
      resolveInterestTarget({ text: "x", buttons, interest_node_key: "book_visit" }),
    ).toBe("book_visit");
  });

  it("finds the agent branch in flows seeded before the key existed", () => {
    expect(resolveInterestTarget({ text: "x", buttons })).toBe("collect_email");
  });

  it("degrades to the last button rather than dropping the lead", () => {
    expect(
      resolveInterestTarget({
        text: "x",
        buttons: [
          { reply_id: "a", title: "See more", next_node_key: "menu" },
          { reply_id: "b", title: "Reach out", next_node_key: "email" },
        ],
      }),
    ).toBe("email");
  });

  it("returns null when there is nowhere to go", () => {
    expect(resolveInterestTarget({ text: "x", buttons: [] })).toBeNull();
  });
});

describe("buildHandoffBrief", () => {
  it("gives an agent everything the funnel collected, in reading order", () => {
    expect(
      buildHandoffBrief({
        budget: "1-2cr",
        category: "Rent Yielding Buildings",
        intent: "Buying",
        interested_property: "BTM corner (PROP-1077)",
      }),
    ).toBe(
      "Looking to: Buying · Type: Rent Yielding Buildings · Budget: 1-2cr · Interested in: BTM corner (PROP-1077)",
    );
  });

  it("skips what the funnel never got", () => {
    expect(buildHandoffBrief({ budget: "1-2cr" })).toBe("Budget: 1-2cr");
  });

  it("ignores engine bookkeeping and blank answers", () => {
    expect(
      buildHandoffBrief({
        budget: "  ",
        __shown_listings: [{ n: 1, id: "p1", title: "x", code: null }],
      }),
    ).toBe("");
  });

  it("is empty for a run that captured nothing", () => {
    expect(buildHandoffBrief({})).toBe("");
    expect(buildHandoffBrief(null)).toBe("");
  });
});

describe("preferLocality", () => {
  const rows = [
    { sublocality: "Whitefield", location: "Whitefield, Bangalore" },
    { sublocality: "Koramangala", location: "5th Block, Koramangala, Bangalore" },
    { sublocality: "HSR Layout", location: "Sector 2, HSR Layout, Bangalore" },
  ];

  it("puts the named area first without dropping the rest", () => {
    const out = preferLocality(rows, "Koramangala");
    expect(out.map((r) => r.sublocality)).toEqual(["Koramangala", "Whitefield", "HSR Layout"]);
  });

  it("reads more than one area from a free-text answer", () => {
    const out = preferLocality(rows, "Koramangala and HSR");
    expect(out.slice(0, 2).map((r) => r.sublocality)).toEqual(["Koramangala", "HSR Layout"]);
  });

  it("handles commas and slashes the way people type them", () => {
    expect(preferLocality(rows, "HSR Layout, Whitefield")[0].sublocality).toBe("Whitefield");
    expect(preferLocality(rows, "Koramangala/HSR")[0].sublocality).toBe("Koramangala");
  });

  it("matches the full location line, not only the sublocality", () => {
    const out = preferLocality(rows, "5th Block");
    expect(out[0].sublocality).toBe("Koramangala");
  });

  it("keeps the original order when the area matches nothing", () => {
    expect(preferLocality(rows, "Chennai").map((r) => r.sublocality)).toEqual(
      rows.map((r) => r.sublocality),
    );
  });

  it("is a no-op for an unanswered or throwaway reply", () => {
    expect(preferLocality(rows, null)).toEqual(rows);
    expect(preferLocality(rows, "any")).toEqual(rows);
  });
});

describe('splitByBudget in a rental context', () => {
  const row = (id: string, price: number): ListingRow => ({
    id, title: `Listing ${id}`, location: 'Bangalore', type: 'Flat/ Apartment',
    bedrooms: 3, area_sqft: null, price, property_code: null, listing_type: 'Rent',
  });

  it('reads "35 to 45" as a monthly rent band, not rupees', () => {
    const { withinBudget, aboveBudget } = splitByBudget(
      [row('cheap', 40_000), row('dear', 620_000)],
      '35 to 45',
      5,
      'rent',
    );
    expect(withinBudget.map((p) => p.id)).toEqual(['cheap']);
    expect(aboveBudget.map((p) => p.id)).toEqual(['dear']);
  });

  it('without the context every listing is above a Rs 45 ceiling', () => {
    const { withinBudget } = splitByBudget([row('cheap', 40_000)], '35 to 45', 5);
    expect(withinBudget).toHaveLength(0);
  });
});

describe("isAcknowledgementOnly", () => {
  it("recognises a bare acknowledgement, whatever its punctuation", () => {
    for (const text of ["Okay", "ok", "OK.", "thanks!", "Thank you", "👍", "noted", "sari"]) {
      expect(isAcknowledgementOnly(text)).toBe(true);
    }
  });

  it("leaves anything carrying content to the fallback policy", () => {
    for (const text of [
      "ok but what about the price",
      "2",
      "3 bhk in whitefield",
      "okay send me the photos",
      "",
    ]) {
      expect(isAcknowledgementOnly(text)).toBe(false);
    }
  });

  it("does not swallow a negative reaction", () => {
    for (const text of ["👎", "❌", "😡"]) {
      expect(isAcknowledgementOnly(text)).toBe(false);
    }
  });
});
