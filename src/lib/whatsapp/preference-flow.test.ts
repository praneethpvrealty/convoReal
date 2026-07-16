import { describe, expect, it } from "vitest";
import {
  buildPreferenceFlowJson,
  buildPreferencePrefillData,
  parsePreferenceFormValues,
  preferenceFormToContactUpdate,
  summarizePreferenceUpdate,
  isPreferenceFlowRequestText,
  PREFERENCE_SCREEN_ID,
  SAVE_PREFERENCES_ACTION,
  PROPERTY_INTEREST_FLOW_OPTIONS,
} from "./preference-flow";

// Meta component caps enforced at flow-JSON build time. Exceeding them
// fails asset upload with a validation error, so we assert them here.
const TEXT_INPUT_LABEL_MAX = 20;
const CHECKBOX_ITEM_TITLE_MAX = 30;

type FlowComponent = {
  type: string;
  name?: string;
  label?: string;
  children?: FlowComponent[];
  "init-value"?: unknown;
  "init-values"?: Record<string, unknown>;
  "on-click-action"?: { name: string; payload: Record<string, string> };
};

function getScreen() {
  const flow = buildPreferenceFlowJson() as {
    version: string;
    data_api_version: string;
    routing_model: Record<string, string[]>;
    screens: Array<{
      id: string;
      terminal: boolean;
      data: Record<string, unknown>;
      layout: { children: FlowComponent[] };
    }>;
  };
  return { flow, screen: flow.screens[0] };
}

function getForm(): FlowComponent {
  const { screen } = getScreen();
  const form = screen.layout.children.find((c) => c.type === "Form");
  if (!form) throw new Error("Form component missing");
  return form;
}

describe("buildPreferenceFlowJson", () => {
  it("declares an endpoint-backed flow with a single terminal PREFERENCES screen", () => {
    const { flow, screen } = getScreen();
    expect(flow.data_api_version).toBe("3.0");
    expect(flow.routing_model).toEqual({ [PREFERENCE_SCREEN_ID]: [] });
    expect(flow.screens).toHaveLength(1);
    expect(screen.id).toBe(PREFERENCE_SCREEN_ID);
    expect(screen.terminal).toBe(true);
  });

  it("binds every form field into the data_exchange payload", () => {
    const form = getForm();
    const footer = form.children!.find((c) => c.type === "Footer")!;
    const payload = footer["on-click-action"]!.payload;
    expect(footer["on-click-action"]!.name).toBe("data_exchange");
    expect(payload.action_type).toBe(SAVE_PREFERENCES_ACTION);

    const inputNames = form
      .children!.filter((c) => c.type !== "Footer")
      .map((c) => c.name);
    for (const name of inputNames) {
      expect(payload[name as string]).toBe(`\${form.${name}}`);
    }
  });

  it("keeps the screen data schema in sync with the prefill builder", () => {
    const { screen } = getScreen();
    const prefill = buildPreferencePrefillData({});
    expect(Object.keys(prefill).sort()).toEqual(Object.keys(screen.data).sort());
  });

  it("prefills via the Form's init-values, never per-field init-value (Meta rejects that combination)", () => {
    // Regression test: Meta's publish-time validation rejects
    // "init-value" on TextInput/TextArea/CheckboxGroup when they're
    // wrapped in a Form ("Property 'init-value' is not allowed in
    // 'TextInput' component."). Form-wrapped fields must be prefilled
    // via the Form's own "init-values" map instead.
    const form = getForm();
    const fieldNames = form
      .children!.filter((c) => c.type !== "Footer")
      .map((c) => c.name as string);

    for (const child of form.children!) {
      if (child.type !== "Footer") {
        expect(child["init-value"]).toBeUndefined();
      }
    }

    expect(form["init-values"]).toBeDefined();
    expect(Object.keys(form["init-values"]!).sort()).toEqual(fieldNames.sort());
    for (const name of fieldNames) {
      expect(form["init-values"]![name]).toBe(`\${data.${name === "property_types" ? "selected_property_types" : name}}`);
    }
  });

  it("stays within Meta's component label limits", () => {
    const form = getForm();
    for (const child of form.children!) {
      if (child.type === "TextInput" || child.type === "TextArea") {
        expect(child.label!.length).toBeLessThanOrEqual(TEXT_INPUT_LABEL_MAX);
      }
    }
    for (const option of PROPERTY_INTEREST_FLOW_OPTIONS) {
      expect(option.title.length).toBeLessThanOrEqual(CHECKBOX_ITEM_TITLE_MAX);
    }
  });
});

describe("buildPreferencePrefillData", () => {
  it("passes through current contact preferences as numbers", () => {
    const data = buildPreferencePrefillData({
      min_budget: 5000000,
      max_budget: 20000000,
      areas_of_interest: ["JP Nagar", "Jayanagar"],
      property_interests: ["Vacant plot"],
      min_roi: 4.5,
    });
    expect(data.min_budget).toBe(5000000);
    expect(data.max_budget).toBe(20000000);
    expect(data.areas).toBe("JP Nagar, Jayanagar");
    expect(data.min_roi).toBe(4.5);
    expect(data.selected_property_types).toEqual(["Vacant plot"]);
    expect(data.property_type_options).toEqual(PROPERTY_INTEREST_FLOW_OPTIONS);
  });

  it("defaults unset numeric preferences to 0 (schema requires a number, not '')", () => {
    const data = buildPreferencePrefillData({});
    expect(data.min_budget).toBe(0);
    expect(data.max_budget).toBe(0);
    expect(data.min_roi).toBe(0);
    expect(data.areas).toBe("");
    expect(data.selected_property_types).toEqual([]);
  });

  it("drops stored property interests the form doesn't offer", () => {
    const data = buildPreferencePrefillData({
      property_interests: ["Vacant plot", "Castle in the sky"],
    });
    expect(data.selected_property_types).toEqual(["Vacant plot"]);
  });
});

describe("parsePreferenceFormValues", () => {
  it("extracts only well-typed fields from untrusted payloads", () => {
    const values = parsePreferenceFormValues({
      min_budget: "5000000",
      max_budget: 42, // wrong type — dropped
      areas: "JP Nagar",
      property_types: ["Vacant plot", 7, null],
      min_roi: "4.5",
      flow_token: "tok", // unrelated keys ignored
    });
    expect(values).toEqual({
      min_budget: "5000000",
      areas: "JP Nagar",
      property_types: ["Vacant plot"],
      min_roi: "4.5",
    });
  });

  it("returns an empty object for null/garbage input", () => {
    expect(parsePreferenceFormValues(null)).toEqual({});
    expect(parsePreferenceFormValues(undefined)).toEqual({});
  });
});

describe("preferenceFormToContactUpdate", () => {
  it("parses numbers, splits localities, and whitelists property types", () => {
    const update = preferenceFormToContactUpdate({
      min_budget: "50,00,000",
      max_budget: "2 00 00 000",
      areas: " JP Nagar , Jayanagar ,, ",
      property_types: ["Vacant plot", "Not a real option"],
      min_roi: "4.5%",
    });
    expect(update).toEqual({
      min_budget: 5000000,
      max_budget: 20000000,
      areas_of_interest: ["JP Nagar", "Jayanagar"],
      property_interests: ["Vacant plot"],
      min_roi: 4.5,
    });
  });

  it("treats a present-but-empty field as clearing the preference", () => {
    const update = preferenceFormToContactUpdate({
      min_budget: "",
      areas: "",
      property_types: [],
    });
    expect(update.min_budget).toBeNull();
    expect(update.areas_of_interest).toEqual([]);
    expect(update.property_interests).toEqual([]);
    // Missing keys are left untouched.
    expect("max_budget" in update).toBe(false);
    expect("min_roi" in update).toBe(false);
  });

  it("skips unparseable or negative numeric junk instead of writing it", () => {
    const update = preferenceFormToContactUpdate({
      min_budget: "cheap",
      min_roi: "-3",
    });
    expect("min_budget" in update).toBe(false);
    expect("min_roi" in update).toBe(false);
  });
});

describe("summarizePreferenceUpdate", () => {
  it("summarizes the saved fields", () => {
    const text = summarizePreferenceUpdate({
      min_budget: 5000000,
      max_budget: 20000000,
      areas_of_interest: ["JP Nagar"],
      property_interests: ["Vacant plot"],
      min_roi: 4.5,
    });
    expect(text).toContain("₹50,00,000");
    expect(text).toContain("₹2,00,00,000");
    expect(text).toContain("JP Nagar");
    expect(text).toContain("Vacant plot");
    expect(text).toContain("4.5%");
  });

  it("falls back to a generic confirmation for an empty update", () => {
    expect(summarizePreferenceUpdate({})).toMatch(/preferences have been updated/i);
  });
});

describe("isPreferenceFlowRequestText", () => {
  it("matches buyer requests to update preferences", () => {
    expect(isPreferenceFlowRequestText("update my preferences")).toBe(true);
    expect(isPreferenceFlowRequestText("Change preferences")).toBe(true);
    expect(isPreferenceFlowRequestText("I want to edit my preferences please")).toBe(true);
    expect(isPreferenceFlowRequestText("My Preferences")).toBe(true);
  });

  it("does not hijack the property/contact update feature or normal chat", () => {
    expect(isPreferenceFlowRequestText("update property PROP-1018")).toBe(false);
    expect(isPreferenceFlowRequestText("update contact")).toBe(false);
    expect(isPreferenceFlowRequestText("update")).toBe(false);
    expect(isPreferenceFlowRequestText("any 2bhk in JP Nagar?")).toBe(false);
    expect(isPreferenceFlowRequestText(null)).toBe(false);
    expect(
      isPreferenceFlowRequestText(
        "long message ".repeat(10) + "that happens to mention preferences"
      )
    ).toBe(false);
  });
});
