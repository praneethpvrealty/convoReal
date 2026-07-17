import { describe, expect, it } from "vitest";

import { scanMessagesForProperties } from "./chat-scan";

const PROPS = [
  { id: "p1", property_code: "PROP-1002", title: "Sunrise Villa JP Nagar" },
  { id: "p2", property_code: null, title: "2 BHK" }, // short title — must not match by title
  { id: "p3", property_code: "PROP-9", title: "Lakeview Residency Koramangala" },
];

describe("scanMessagesForProperties", () => {
  it("matches by property_id link, code, and long title", () => {
    const found = scanMessagesForProperties(
      [
        { content_text: "check https://x.com/list?property_id=p1", created_at: "t1" },
        { content_text: "sharing PROP-9 details", created_at: "t2" },
        { content_text: "Lakeview Residency Koramangala pics attached", created_at: "t3" },
      ],
      PROPS,
    );
    expect(found.get("p1")).toBe("t1");
    expect(found.get("p3")).toBe("t2"); // code hit wins first (message order)
    expect(found.size).toBe(2);
  });

  it("ignores short titles to avoid false positives on everyday chat", () => {
    const found = scanMessagesForProperties(
      [{ content_text: "looking for a 2 BHK for my brother", created_at: "t1" }],
      PROPS,
    );
    expect(found.has("p2")).toBe(false);
  });

  it("title matching is case-insensitive", () => {
    const found = scanMessagesForProperties(
      [{ content_text: "SUNRISE VILLA JP NAGAR is available", created_at: "t1" }],
      PROPS,
    );
    expect(found.get("p1")).toBe("t1");
  });

  it("keeps the first (newest-first callers: latest) mention per property", () => {
    const found = scanMessagesForProperties(
      [
        { content_text: "PROP-1002", created_at: "newer" },
        { content_text: "PROP-1002 again", created_at: "older" },
      ],
      PROPS,
    );
    expect(found.get("p1")).toBe("newer");
  });

  it("skips empty messages", () => {
    const found = scanMessagesForProperties(
      [{ content_text: null, created_at: "t1" }],
      PROPS,
    );
    expect(found.size).toBe(0);
  });
});
