import { describe, expect, it } from "vitest";

import { buildCheckInMessage } from "./checkin-message";

describe("buildCheckInMessage", () => {
  it("greets by first name and names the property with its code", () => {
    const msg = buildCheckInMessage({
      contactName: "Supreeth Kumar",
      propertyTitle: "Old residential house in 4200 sqft plot",
      propertyCode: "PROP-1095",
      stageName: "Shortlisted",
    });
    expect(msg).toBe(
      "Hi Supreeth, just checking in on Old residential house in 4200 sqft plot (PROP-1095). We had it at Shortlisted. Are you still considering this one, or should I park it and focus on other options?",
    );
  });

  it("drops the greeting name and the stage clause when they are missing", () => {
    const msg = buildCheckInMessage({
      contactName: "  ",
      propertyTitle: "Sunrise Villa",
      propertyCode: null,
      stageName: null,
    });
    expect(msg).toBe(
      "Hi, just checking in on Sunrise Villa. Are you still considering this one, or should I park it and focus on other options?",
    );
  });

  it("appends the showcase link when one is available", () => {
    const msg = buildCheckInMessage({
      contactName: "Asha",
      propertyTitle: "Sunrise Villa",
      propertyUrl: "https://acme.convoreal.com/?property_id=PROP-7&v=c1",
    });
    expect(msg).toContain(
      "\n\n📸 Photos & full details:\nhttps://acme.convoreal.com/?property_id=PROP-7&v=c1",
    );
  });

  it("ends on the question when there is no link", () => {
    expect(
      buildCheckInMessage({ contactName: "Asha", propertyTitle: "Sunrise Villa" }),
    ).toMatch(/other options\?$/);
  });

  it("falls back to the code, then to a generic subject", () => {
    expect(
      buildCheckInMessage({ contactName: "Asha", propertyCode: "PROP-7" }),
    ).toContain("checking in on PROP-7.");
    expect(buildCheckInMessage({ contactName: "Asha" })).toContain(
      "checking in on the property we discussed.",
    );
  });
});
