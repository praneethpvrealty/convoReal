import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { PROPERTY_TYPE_VALUES, normalizePropertyType } from '@/lib/property-types';
import { sanitizeFloorTenancies, type FloorTenancy } from '@/lib/inventory/floor-tenancies';
import { logAiCall } from '@/lib/ai/call-log';

export { PROPERTY_TYPE_VALUES, normalizePropertyType };

/**
 * Centralized Gemini AI client helper.
 * Uses the Generative Language REST API directly to avoid additional SDK dependencies.
 */

// Model tiers with failover chains. 'standard' (default) is full Flash for
// generation, extraction, and vision; 'lite' fronts Flash-Lite for cheap
// high-volume tasks (classification, simple text parses) and falls back UP
// to full Flash on transient errors, so quality is the floor, not the
// ceiling. All four names live-verified against our API key on 2026-07-14 —
// the old gemini-1.5-flash fallback had been retired by Google (and
// gemini-2.5-flash-lite is gated off for newer keys); a dead fallback fails
// exactly when the primary is down.
export type GeminiTier = 'standard' | 'lite';
const MODEL_CHAINS: Record<GeminiTier, string[]> = {
  standard: ["gemini-2.5-flash", "gemini-3.5-flash"],
  lite: ["gemini-3.1-flash-lite", "gemini-2.5-flash"],
};

export interface GeminiCallOpts {
  /** Model tier — use 'lite' for cheap high-volume calls. Default 'standard'. */
  tier?: GeminiTier;
  /** Feature key for the ai_call_log (e.g. 'contact_parse'). Optional. */
  feature?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiContent {
  parts: GeminiPart[];
}

interface GeneratePayload {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: [{ text: string }];
  };
  generationConfig?: {
    responseMimeType?: string;
  };
}

/**
 * Base generic content generator for Gemini with API failover chain.
 */
async function generateContentRaw(
  contents: GeminiContent[],
  systemInstructionText?: string,
  jsonMode: boolean = false,
  opts: GeminiCallOpts = {}
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please add it to your .env.local file.");
  }

  const tier: GeminiTier = opts.tier ?? 'standard';
  const models = MODEL_CHAINS[tier];

  // Telemetry inputs (see ai_call_log, migration 123). Media parts are
  // counted as a flag only — never previewed or sized.
  const inputText = contents
    .flatMap((c) => c.parts)
    .map((p) => p.text || '')
    .join('\n');
  const hasMedia = contents.some((c) => c.parts.some((p) => p.inlineData));
  const startedAt = Date.now();

  let lastError: Error | null = null;

  for (const model of models) {
    try {
      console.log(`[Gemini AI] Attempting generation using model: ${model}`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const payload: GeneratePayload = {
        contents
      };

      if (systemInstructionText) {
        payload.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      if (jsonMode) {
        payload.generationConfig = {
          responseMimeType: "application/json"
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Gemini API returned error: ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("No text returned in Gemini response candidates.");
      }

      console.log(`[Gemini AI] Generation succeeded with model: ${model}`);
      logAiCall({
        feature: opts.feature,
        model,
        tier,
        success: true,
        latencyMs: Date.now() - startedAt,
        jsonMode,
        hasMedia,
        promptTokens: data.usageMetadata?.promptTokenCount ?? null,
        responseTokens: data.usageMetadata?.candidatesTokenCount ?? null,
        promptChars: inputText.length,
        responseChars: text.length,
        systemPreview: systemInstructionText,
        inputPreview: inputText,
        outputPreview: text,
      });
      return text.trim();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[Gemini AI] Failed with model ${model}:`, errorMessage);
      lastError = err instanceof Error ? err : new Error(errorMessage);

      // If it is a transient error (rate limit, service unavailable, high demand),
      // we proceed to try the fallback model.
      const errLower = errorMessage.toLowerCase();
      const isTransientError =
        errLower.includes("high demand") ||
        errLower.includes("quota") ||
        errLower.includes("429") ||
        errLower.includes("503") ||
        errLower.includes("500") ||
        errLower.includes("502") ||
        errLower.includes("504") ||
        errLower.includes("unavailable") ||
        errLower.includes("overloaded") ||
        errLower.includes("timeout") ||
        errLower.includes("deadline") ||
        errLower.includes("internal");

      if (isTransientError && model !== models[models.length - 1]) {
        console.log("[Gemini AI] Falling back to the next model due to transient error...");
        continue;
      }

      logAiCall({
        feature: opts.feature,
        model,
        tier,
        success: false,
        errorMessage,
        latencyMs: Date.now() - startedAt,
        jsonMode,
        hasMedia,
        promptChars: inputText.length,
        systemPreview: systemInstructionText,
        inputPreview: inputText,
      });
      // For non-transient errors (like invalid API keys), fail fast.
      throw err;
    }
  }

  const chainError = lastError || new Error("Failed to generate content with all available models.");
  logAiCall({
    feature: opts.feature,
    model: models[models.length - 1],
    tier,
    success: false,
    errorMessage: chainError.message,
    latencyMs: Date.now() - startedAt,
    jsonMode,
    hasMedia,
    promptChars: inputText.length,
    systemPreview: systemInstructionText,
    inputPreview: inputText,
  });
  throw chainError;
}

/**
 * Standard utility to generate plain text using prompt and system instruction.
 */
export async function generateText(prompt: string, systemInstruction?: string, opts?: GeminiCallOpts): Promise<string> {
  const contents = [{ parts: [{ text: prompt }] }];
  return generateContentRaw(contents, systemInstruction, false, opts);
}

/**
 * Same as generateText but with JSON response mode enabled.
 */
export async function generateJson(prompt: string, systemInstruction?: string, opts?: GeminiCallOpts): Promise<string> {
  const contents = [{ parts: [{ text: prompt }] }];
  return generateContentRaw(contents, systemInstruction, true, opts);
}

/**
 * JSON-mode generation over mixed parts (text + inline media such as a
 * voice-note audio buffer). Used by the calendar event parser to
 * transcribe-and-extract in a single call.
 */
export async function generateJsonFromParts(parts: GeminiPart[], systemInstruction?: string, opts?: GeminiCallOpts): Promise<string> {
  return generateContentRaw([{ parts }], systemInstruction, true, opts);
}

export type { GeminiPart };

/** Must match the vector(768) column in copilot_qa_cache. */
export const EMBEDDING_DIMS = 768;
const EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Semantic embedding for similarity search (copilot Q&A cache).
 * Same raw-REST style as generateContentRaw — no SDK.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please add it to your .env.local file.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: EMBEDDING_DIMS,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Gemini embed API returned error: ${response.statusText}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
    throw new Error("Gemini embed API returned no usable embedding.");
  }
  return values as number[];
}

/**
 * Classifies if a message text is a real estate listing / advertisement.
 */
export async function isListingMessage(text: string): Promise<boolean> {
  const cleanText = text.trim();
  if (!cleanText) return false;

  const systemInstruction = 
    "You are an expert real estate classifier. Your job is to classify if the incoming message contains real estate property details, " +
    "advertisements, or requirements for buying/selling/renting properties. " +
    "Only respond with exactly 'true' or 'false'. Absolutely no markdown, no punctuation, and no other text.";

  const prompt = `Classify this message:\n\n"${cleanText}"`;

  try {
    const response = await generateText(prompt, systemInstruction, { tier: 'lite', feature: 'chatbot_classify' });
    return response.toLowerCase().includes("true");
  } catch (err) {
    console.error("[Gemini AI] Error in isListingMessage classification:", err);
    // Fallback search logic in case of API failure
    const keywords = ["bhk", "sqft", "flat", "plot", "villa", "sale", "rent", "layout", "devanahalli", "furnish", "crore", "lakh", "price", "location", "acres", "commercial", "industrial"];
    return keywords.some(kw => cleanText.toLowerCase().includes(kw));
  }
}

const LEAD_FORWARD_SIGNAL = /interested in|looking for|requirement|refer(?:red|ral)\b|budget|magicbricks|99acres|housing\.com/i;

const PROPERTY_LISTING_SIGNALS: RegExp[] = [
  /\bsq\.?\s?ft\b|\bsqft\b|\bsq\s?feet\b/i,
  /\b\d{2,4}\s*[*x×]\s*\d{2,4}\b/,
  /\b(?:east|west|north|south)(?:[-\s]?(?:east|west))?\s*facing\b/i,
  /\bsite\s*(?:no\.?|number|#)\b/i,
  /\b\d+(?:\.\d+)?\s*(?:cr|crore|lakhs?|lacs?)\b/i,
  /\b\d+\s*bhk\b/i,
  /\b(?:plot|villa|acres?|guntha|cents?|dimension)\b/i,
];

/**
 * A property listing forwarded with the owner's name and phone at the end
 * (e.g. "3750 sqft / 50*75 / East facing / 17cr / Site number 569 / Deepak
 * 98862...") reads as 'contact' to the LLM classifier because it ends in a
 * name and number. Treat it as a listing when it carries at least two
 * distinct property specs and no buyer-lead markers, so it enters the
 * property intake flow instead of the contact-draft flow.
 */
export function looksLikePropertyListing(text?: string): boolean {
  const cleanText = (text || '').trim();
  if (!cleanText || LEAD_FORWARD_SIGNAL.test(cleanText)) return false;
  return PROPERTY_LISTING_SIGNALS.filter((re) => re.test(cleanText)).length >= 2;
}

/**
 * Transcribe the visible text from an image (a forwarded listing poster,
 * screenshot, etc.) so deterministic listing detection can run on an
 * image-only message that has no caption. Returns '' on failure so the
 * caller falls back to the model's own verdict.
 */
async function transcribeImageText(buffer: Buffer, mimeType: string): Promise<string> {
  const systemInstruction =
    "You are an OCR engine. Transcribe ALL visible text from the image verbatim, preserving line breaks. " +
    "Return only the transcribed text with no commentary. If there is no text, return an empty string.";
  try {
    const parts: GeminiPart[] = [
      { inlineData: { mimeType, data: buffer.toString("base64") } },
      { text: "Transcribe all text in this image." },
    ];
    const response = await generateContentRaw([{ parts }], systemInstruction, false, { tier: 'lite', feature: 'chatbot_classify' });
    return (response || "").trim();
  } catch (err) {
    console.error("[Gemini AI] Error transcribing image text:", err);
    return "";
  }
}

/**
 * Classifies if a message (text or image) is a real estate listing, contact details, or neither.
 */
export async function classifyImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<'property' | 'contact' | 'none'> {
  const systemInstruction =
    "You are an expert real estate CRM classifier. Your job is to classify if the incoming message (which can be text and/or an image) is:\n" +
    "1. 'property': A property listing to be added to inventory, layout plan, listing advertisement, or property details description.\n" +
    "2. 'contact': Contact details, vCard details, request to add/save a contact/lead, screenshot of contact/profile details, or lead forwarding/inquiry messages containing contact name/phone and their property interest (e.g. 'VaishaliGaur, 917737932199 is interested in SJR Blue Waters' or Magicbricks/99acres/Housing forwards).\n" +
    "3. 'none': Neither of the above.\n\n" +
    "Precedence: when BOTH property listing details (area/sq ft, dimensions like 50x75, facing, price in cr/lakh, plot/site number, BHK) AND a person's name/phone are present, classify as 'property' — the listing is the primary intent. Reserve 'contact' for messages whose main purpose is saving a person or forwarding a buyer's interest/requirement.\n" +
    "Only respond with exactly 'property', 'contact', or 'none'. Absolutely no markdown, no punctuation, and no other text.";

  const parts: GeminiPart[] = [];
  if (buffer && mimeType) {
    parts.push({
      inlineData: { mimeType, data: buffer.toString("base64") }
    });
  }
  const promptText = text 
    ? `Classify this content:\n\n"${text}"`
    : "Classify the provided image.";
  parts.push({ text: promptText });

  const contents = [{ parts }];

  try {
    const response = await generateContentRaw(contents, systemInstruction, false, { tier: 'lite', feature: 'chatbot_classify' });
    const classification = response.toLowerCase().trim();
    if (classification.includes("property")) return "property";
    if (classification.includes("contact")) {
      if (looksLikePropertyListing(text)) return "property";
      // Image-only forwards have no caption to test deterministically;
      // transcribe the image (e.g. a listing poster whose specs the model
      // overlooked next to a phone number) and re-check so a listing isn't
      // misrouted into the contact-draft flow.
      if (!text?.trim() && buffer && mimeType) {
        const imageText = await transcribeImageText(buffer, mimeType);
        if (looksLikePropertyListing(imageText)) return "property";
      }
      return "contact";
    }
    return "none";
  } catch (err) {
    console.error("[Gemini AI] Error in classifyImageOrText:", err);
    // Fallback logic
    const lowerText = text?.toLowerCase() || "";
    const contactKeywords = ["add contact", "save contact", "new lead", "create contact", "add lead", "email is", "phone is", "save as contact", "is interested in", "magicbricks", "99acres", "housing.com"];
    if (contactKeywords.some(kw => lowerText.includes(kw)) && !looksLikePropertyListing(text)) {
      return "contact";
    }
    const propertyKeywords = ["bhk", "sqft", "flat", "plot", "villa", "sale", "rent", "layout", "crore", "lakh", "price", "location"];
    if (propertyKeywords.some(kw => lowerText.includes(kw))) {
      return "property";
    }
    return "none";
  }
}



/**
 * Deterministic backstop for 'bedrooms': extracts an "X BHK" / "X bhk"
 * count directly from raw text. Same defensive pattern as location/type
 * above — the model is instructed to always set bedrooms from a BHK
 * mention (rule 3), but this catches it even if that instruction doesn't
 * land (e.g. a title like "5 bhk old house..." was seen leaving the
 * structured 'bedrooms' field null).
 */
function extractBedroomsFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+)\s*-?\s*bhk/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Deterministic backstop for 'type': strong whole-building signals in
 * the raw input ("mixed-use", "commercial development/complex/building")
 * override whatever unit-level enum the model picked. Such documents
 * routinely list the units inside (hotel, offices, penthouse…), and the
 * model tends to latch onto one of those — a 55,000 sqft mixed-use
 * development was seen coming back as 'Flat/ Apartment'.
 */
function detectCommercialBuilding(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('mixed use') ||
    lower.includes('mixed-use') ||
    /commercial\s*(building|complex|development)/.test(lower)
  );
}

export interface ParsedPropertyDraft {
  title: string | null;
  price: number | null;
  location: string | null;
  type: 
    | "Flat/ Apartment"
    | "Residential House"
    | "Villa"
    | "Builder Floor Apartment"
    | "Residential Land/ Plot"
    | "Penthouse"
    | "Studio Apartment"
    | "Residential PG building"
    | "PG/ Hostel"
    | "Commercial Office Space"
    | "Office in IT Park/ SEZ"
    | "Commercial Shop"
    | "Commercial Showroom"
    | "Commercial Building"
    | "Commercial Land"
    | "Warehouse/ Godown"
    | "Industrial Land"
    | "Industrial Building"
    | "Industrial Shed"
    | "Agricultural Land"
    | "Farm House"
    | "Others"
    | null;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  land_area: number | null;
  land_area_unit: string | null;
  description: string | null;
  features: string[] | null;
  nearby_highlights: string[] | null;
  dimensions: string | null;
  facing_direction: string | null;
  rental_income: number | null;
  roi: number | null;
  google_map_link: string | null;
  images: string[];
  documents?: string[];
  /** Walkthrough video forwarded during WhatsApp intake — uploaded to
   *  the property-videos bucket, becomes properties.video_url. */
  video_url?: string | null;
  owner_contact_name: string | null;
  owner_contact_phone: string | null;
  owner_contact_role: string | null;
  listing_type: "Sale" | "Rent" | null;
  rent_per_month: number | null;
  maintenance: number | null;
  advance: number | null;
  gst: number | null;
  /** Floor-wise rent roll for pre-leased commercial buildings. */
  floor_tenancies?: FloorTenancy[] | null;
}

/**
 * Safely parse a JSON string returned by Gemini, with fallbacks for trailing commas, comments, and regex-based extraction.
 */
function parseGeminiResponse(rawResult: string): Record<string, unknown> {
  let cleaned = rawResult.trim();
  
  // 1. Strip markdown code block if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  }

  // 2. Try parsing directly first
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (e) {
    console.warn("[Gemini AI] Initial JSON parse failed, attempting cleanup:", e);
  }

  // 3. Cleanup comments and trailing commas
  try {
    // Remove single line comments
    let temp = cleaned.replace(/\/\/.*$/gm, "");
    // Remove multi-line comments
    temp = temp.replace(/\/\*[\s\S]*?\*\//g, "");
    // Remove trailing commas before closing braces/brackets
    temp = temp.replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(temp) as Record<string, unknown>;
  } catch (e) {
    console.warn("[Gemini AI] JSON cleanup parse failed:", e);
  }

  // 4. Try regex repair for common fields if the JSON is truncated or badly malformed
  const fallback: Record<string, unknown> = {};
  
  const extractString = (field: string): string | null => {
    const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
    return match ? match[1] : null;
  };

  const extractNumber = (field: string): number | null => {
    const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?|null)`));
    if (match && match[1] !== 'null') {
      const val = Number(match[1]);
      return isNaN(val) ? null : val;
    }
    return null;
  };

  const extractArray = (field: string): string[] => {
    const match = cleaned.match(new RegExp(`"${field}"\\s*:\\s*\\[([^\\]]*)\\]`));
    if (match) {
      const itemsStr = match[1];
      const items: string[] = [];
      const itemRegex = /"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"/g;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(itemsStr)) !== null) {
        items.push(itemMatch[1]);
      }
      return items;
    }
    return [];
  };

  try {
    fallback.title = extractString("title");
    fallback.price = extractNumber("price");
    fallback.location = extractString("location");
    fallback.type = extractString("type");
    fallback.sublocality = extractString("sublocality");
    fallback.city = extractString("city");
    fallback.state = extractString("state");
    fallback.bedrooms = extractNumber("bedrooms");
    fallback.bathrooms = extractNumber("bathrooms");
    fallback.area_sqft = extractNumber("area_sqft");
    fallback.land_area = extractNumber("land_area");
    fallback.land_area_unit = extractString("land_area_unit");
    fallback.description = extractString("description");
    fallback.features = extractArray("features");
    fallback.nearby_highlights = extractArray("nearby_highlights");
    fallback.dimensions = extractString("dimensions");
    fallback.facing_direction = extractString("facing_direction");
    fallback.rental_income = extractNumber("rental_income");
    fallback.google_map_link = extractString("google_map_link");
    fallback.owner_contact_name = extractString("owner_contact_name");
    fallback.owner_contact_phone = extractString("owner_contact_phone");
    fallback.owner_contact_role = extractString("owner_contact_role");

    // Also support parsing contacts array for contact parser if needed
    const contactsMatch = cleaned.match(/"contacts"\s*:\s*\[([\s\S]*?)\]/);
    if (contactsMatch) {
      const contactsStr = contactsMatch[1];
      const contactObjects = contactsStr.split(/}\s*,\s*{/);
      fallback.contacts = contactObjects.map(objStr => {
        const contact: Record<string, unknown> = {};
        const extractContactStr = (field: string): string | null => {
          const m = objStr.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
          return m ? m[1] : null;
        };
        contact.name = extractContactStr("name");
        contact.phone = extractContactStr("phone");
        contact.email = extractContactStr("email");
        contact.company = extractContactStr("company");
        contact.classification = extractContactStr("classification");
        contact.notes = extractContactStr("notes");
        contact.referrer_name = extractContactStr("referrer_name");
        contact.referrer_phone = extractContactStr("referrer_phone");
        return contact;
      });
    }

    // Check if we successfully extracted at least some fields
    if (Object.keys(fallback).some(k => fallback[k] !== null && fallback[k] !== undefined && (Array.isArray(fallback[k]) ? fallback[k].length > 0 : true))) {
      console.log("[Gemini AI] Successfully recovered fields using regex fallback.");
      return fallback;
    }
  } catch (regexErr) {
    console.error("[Gemini AI] Regex fallback parsing failed:", regexErr);
  }

  // Final fallback: throw the original JSON parse error
  throw new Error(`Failed to parse Gemini response: ${rawResult}`);
}

/**
 * Parses listing details from an image buffer and/or text block.
 */
export async function parseListingFromImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<ParsedPropertyDraft> {
  const systemInstruction = 
    "You are an expert real estate data parser. Extract property details from the provided text and/or image.\n" +
    "You must return a JSON object conforming to the following structure:\n" +
    "{\n" +
    "  \"title\": \"A descriptive title (e.g. '3 BHK Apartment in HSR Layout' or '30x40 Residential Plot in Devanahalli') or null\",\n" +
    "  \"price\": Numeric price in INR (e.g. if text says '1.2 Cr' or '120 Lakhs', price is 12000000) or null,\n" +
    "  \"location\": \"Exact location or address or null\",\n" +
    "  \"type\": \"Must be exactly one of: 'Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Residential Land/ Plot', 'Penthouse', 'Studio Apartment', 'Residential PG building', 'PG/ Hostel', 'Commercial Office Space', 'Office in IT Park/ SEZ', 'Commercial Shop', 'Commercial Showroom', 'Commercial Building', 'Commercial Land', 'Warehouse/ Godown', 'Industrial Land', 'Industrial Building', 'Industrial Shed', 'Agricultural Land', 'Farm House', 'Others' or null\",\n" +
    "  \"sublocality\": \"Sublocality or neighborhood name or null\",\n" +
    "  \"city\": \"City name (default 'Bangalore')\",\n" +
    "  \"state\": \"State name (default 'Karnataka')\",\n" +
    "  \"bedrooms\": Number of bedrooms (numeric) or null,\n" +
    "  \"bathrooms\": Number of bathrooms (numeric) or null,\n" +
    "  \"area_sqft\": Area in Sq.Ft. (numeric) or null,\n" +
    "  \"land_area\": Land area (numeric) or null,\n" +
    "  \"land_area_unit\": \"Land area unit (must be one of: 'Sq.Ft.', 'Sq.Mtr.', 'Acre', 'Gunta', 'Cent', 'Ground') or null\",\n" +
    "  \"description\": \"A professional description summarizing the listing or null\",\n" +
    "  \"features\": Array of string features/amenities (e.g., ['Fenced Boundary', 'Access Road', '24/7 Security']) or empty array,\n" +
    "  \"nearby_highlights\": Array of string nearby landmarks/highlights (e.g., ['Metro Station', 'School', 'Hospital', 'Mall']) or empty array,\n" +
    "  \"dimensions\": \"Dimensions if land/plot (e.g., '30x40') or null\",\n" +
    "  \"facing_direction\": \"E.g. 'North', 'East', 'West', 'South' or null\",\n" +
    "  \"rental_income\": \"Numeric monthly rental income in INR if specified (e.g., if text says 'rent 2.5 Lakhs/month' or '2.5 L rent', rental_income is 250000) or null\",\n" +
    "  \"google_map_link\": \"Google Map link URL if present in text/image (e.g., 'https://maps.app.goo.gl/...' or 'https://google.com/maps/...') or null\",\n" +
    "  \"owner_contact_name\": \"Contact person's name, or sender's name or listing agent/owner name mentioned or null\",\n" +
    "  \"owner_contact_phone\": \"Contact person's phone number mentioned (numeric digits only) or null\",\n" +
    "  \"owner_contact_role\": \"Role of the contact person mentioned (must be 'Agent' or 'Owner' or null)\",\n" +
    "  \"listing_type\": \"Transaction type ('Sale' or 'Rent'). Set to 'Rent' if terms like 'for rent', 'rent per month', 'advance/deposit', 'lease' are used. Default is 'Sale'\",\n" +
    "  \"rent_per_month\": Numeric monthly rent in INR (e.g. 'rent 40k' -> 40000) or null,\n" +
    "  \"maintenance\": Numeric monthly maintenance charges in INR or null,\n" +
    "  \"advance\": Numeric security deposit / advance in INR (e.g. 'advance 2.5 L' -> 250000) or null,\n" +
    "  \"gst\": Numeric GST percentage (e.g. '18% GST' -> 18) or flat GST amount in INR or null,\n" +
    "  \"floor_tenancies\": For commercial buildings sold with a floor-wise / unit-wise breakdown (rent roll), an array with one entry per floor or unit that has any rent, tenant, or usage detail: [{\"floor\": \"Ground + First Floor\", \"area_sqft\": 20000 or null, \"tenant_name\": \"tenant/business name or null\", \"monthly_rent\": monthly rent in INR excluding GST (e.g. '₹8,00,000' -> 800000) or null, \"lease_start\": \"YYYY-MM-DD\" or null, \"lease_end\": \"YYYY-MM-DD\" or null, \"lock_in_months\": numeric or null, \"maintenance\": \"maintenance terms or null\", \"notes\": \"usage, e.g. 'Hypermarket' or '3-Star Hotel, 27 rooms'\"}]. Empty array when the input has no floor-wise breakdown\n" +
    "}\n\n" +
    "Important parsing rules:\n" +
    "0. CRITICAL: The 'title' field is a human-readable summary and will often restate details — like BHK count, area, or location — that ALSO belong in their own structured fields below. NEVER treat a detail as 'already handled' just because it appears in the title. You MUST still populate every matching structured field (bedrooms, area_sqft, land_area, location, type, etc.) independently and completely whenever that information is present anywhere in the input, even if it's redundant with the title.\n" +
    "1. For Price, Rent, Advance/Deposit: Convert terms like 'Crore', 'Cr', 'Lakhs', 'L', 'k' to standard numeric integer values (e.g., '80 Lakhs' -> 8000000, '1.5 Cr' -> 15000000, '2.5 L' -> 250000, '25k' -> 25000).\n" +
    "2. For Location: ALWAYS populate the top-level 'location' field with the primary area/neighborhood/address text mentioned anywhere in the input (e.g. if the text says '...for sale in Jayanagar 17th Main' or 'Location - Jayanagar 17th Main', set location to 'Jayanagar 17th Main'). Never leave 'location' null just because the same text is already part of the 'title' — 'location' is a separate required field. Additionally, if a distinct sublocality/layout name (e.g. HSR Layout, Koramangala) is identifiable, also set 'sublocality' — but 'location' must be filled whenever ANY area/address is mentioned, even if it's identical to 'sublocality'.\n" +
    "3. For Bedrooms: 'X BHK' or 'X bhk' means bedrooms = X (numeric). Always set 'bedrooms' whenever a BHK count is mentioned anywhere in the input, even if that same count already appears in the title (e.g. title '5 BHK old house...' still requires bedrooms: 5).\n" +
    "4. For Area vs Land Area: 'area_sqft' is the BUILT-UP / carpet / super built-up area of a structure (a flat's interior, a house's floor area, etc). 'land_area' (with 'land_area_unit') is the SITE/PLOT size the property sits on, or vacant land itself. If the input mentions a 'plot', 'site', or land size figure (e.g. '3870 sqft plot', '30x40 site'), put it in 'land_area', NOT 'area_sqft' — even when the listing is a house/villa built on that plot. Only put a figure in 'area_sqft' when it's explicitly described as built-up/carpet/floor area.\n" +
    "5. For vacant land/plot without building details (e.g., no bedrooms/bathrooms/apartment mention), map 'type' intelligently based on keywords to 'Residential Land/ Plot', 'Commercial Land', 'Industrial Land', or 'Agricultural Land'. For example, commercial plots go to 'Commercial Land'.\n" +
    "6. For PG/Hostel listings: if the input mentions 'PG', 'paying guest', or 'hostel', map 'type' to 'PG/ Hostel' (or 'Residential PG building' if it's clearly a whole building run as a PG business, not a single room/bed being offered).\n" +
    "7. Set any fields that cannot be found or reasonably inferred to null.\n" +
    "8. For Amenities/Features: Extract any amenities, specifications, or internal/external building features of the property (such as wood flooring, modular kitchen, power backup, gym, pool, gated community, library, basement, water supply, fenced boundary, security, etc.) into the `features` array.\n" +
    "9. For Nearby Highlights/Landmark information: Extract any nearby landmarks, highlights, or proximity information (such as near metro station, opposite Starbucks, near shopping mall, hospital, school, tech park, etc.) into the `nearby_highlights` array. Do NOT confuse building details/features with nearby landmarks/highlights.\n" +
    "10. For Listing/Owner Contact details: If the message/image details have any contact person or sender's name (e.g., 'Regards, Ramesh (Agent)' or 'Contact Suresh on 9876543210'), extract their name, phone (if present), and role ('Agent' or 'Owner'). If not mentioned, set to null.\n" +
    "11. For whole commercial buildings / mixed-use developments (multiple floors with different uses like hypermarket + hotel + gym): set 'type' to 'Commercial Building', capture each floor/unit in 'floor_tenancies', and set 'rental_income' to the TOTAL monthly rent when stated.\n" +
    "12. Output MUST be valid JSON.";

  const parts: GeminiPart[] = [];

  if (buffer && mimeType) {
    parts.push({
      inlineData: {
        mimeType,
        data: buffer.toString("base64")
      }
    });
  }

  const promptText = text 
    ? `Parse the following real estate listing details:\n\n"${text}"`
    : "Extract all visible real estate listing details from the provided image.";

  parts.push({ text: promptText });

  const contents = [{ parts }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true, { feature: 'listing_parse' });
    const parsed = parseGeminiResponse(rawResult) as unknown as Partial<ParsedPropertyDraft>;

    const rental_income = parsed.rental_income || null;
    let roi = null;
    if (rental_income && parsed.price) {
      roi = Number(((rental_income * 12) / parsed.price * 100).toFixed(2));
    }

    return {
      title: parsed.title || null,
      price: parsed.price || null,
      // Deterministic safety net: if the model filled sublocality but left
      // the primary location empty (the model's most common failure mode
      // here), fall back to sublocality rather than showing "Missing" when
      // the user clearly gave *some* area/address text.
      location: parsed.location || parsed.sublocality || null,
      // Deterministic backstop: strong whole-building signals in the raw
      // input win over a unit-level enum the model may have picked.
      type:
        detectCommercialBuilding(text) || detectCommercialBuilding(parsed.title)
          ? "Commercial Building"
          : (normalizePropertyType(parsed.type) as ParsedPropertyDraft["type"]),
      sublocality: parsed.sublocality || null,
      city: parsed.city || "Bangalore",
      state: parsed.state || "Karnataka",
      // Falls back to regex-extracting "X BHK" from the raw input text,
      // then from the model's own generated title, before giving up.
      bedrooms: parsed.bedrooms || extractBedroomsFromText(text) || extractBedroomsFromText(parsed.title) || null,
      bathrooms: parsed.bathrooms || null,
      area_sqft: parsed.area_sqft || null,
      land_area: parsed.land_area || null,
      land_area_unit: parsed.land_area_unit || "Sq.Ft.",
      description: parsed.description || null,
      features: parsed.features || [],
      nearby_highlights: parsed.nearby_highlights || [],
      dimensions: parsed.dimensions || null,
      facing_direction: parsed.facing_direction || null,
      rental_income,
      roi,
      google_map_link: parsed.google_map_link || null,
      images: [],
      owner_contact_name: parsed.owner_contact_name || null,
      owner_contact_phone: parsed.owner_contact_phone || null,
      owner_contact_role: parsed.owner_contact_role || null,
      listing_type: parsed.listing_type || "Sale",
      rent_per_month: parsed.rent_per_month || null,
      maintenance: parsed.maintenance || null,
      advance: parsed.advance || null,
      gst: parsed.gst || null,
      floor_tenancies: sanitizeFloorTenancies(parsed.floor_tenancies)
    };
  } catch (err) {
    console.error("[Gemini AI] Error parsing listing details:", err);
    throw err;
  }
}

/**
 * Updates an existing parsed listing draft JSON with a conversational update instruction from the user.
 */
export async function updateListingDraft(
  currentDraft: ParsedPropertyDraft,
  updateRequest: string
): Promise<ParsedPropertyDraft> {
  const systemInstruction =
    "You are an expert real estate data updater. You are given a current property draft JSON object and a natural language instruction from the user.\n" +
    "Your job is to apply the updates requested by the user and return the complete updated JSON object matching the exact structure.\n" +
    "Do not change any other fields unless requested by the user.\n" +
    "CRITICAL: Only omit/null a field in your response if the user's instruction genuinely doesn't touch it. If the instruction clearly provides a value for a field visible in the current draft (title, description, city, state, sublocality, dimensions, facing_direction, bedrooms, bathrooms, area_sqft, land_area, etc.), you MUST set that exact field — never silently drop a value the user just gave you.\n" +
    "Convert terms like 'Crore', 'Cr', 'Lakhs', 'L', 'k' to standard numeric integer values for the price, rent_per_month, advance, and rental_income fields. Extracted Google Map links should be placed in 'google_map_link' field.\n" +
    "Handle updates to amenities (features) and nearby highlights (nearby_highlights) intelligently (e.g. if the user says 'add Gym to amenities', add 'Gym' to the features array; if they say 'add HSR Metro to landmarks', add 'HSR Metro' to the nearby_highlights array).\n" +
    "Handle updates to listing/owner contact details intelligently (e.g. if the user says 'contact name is Ramesh' or 'owner phone is 9876543210', update owner_contact_name or owner_contact_phone respectively).\n" +
    "Handle updates to location intelligently: if the user says 'location is X', 'Location - X', 'located in X', or similar, set the top-level 'location' field to X. 'location' is a required primary address field, separate from 'sublocality' — never leave it unset when the user has given any area/address text, even if you also record a more specific 'sublocality'.\n" +
    "Handle updates to property type intelligently: if the user says 'type is X', 'Type - X', or describes the property category in any way, map it to the closest matching value from this exact list: 'Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Residential Land/ Plot', 'Penthouse', 'Studio Apartment', 'Residential PG building', 'PG/ Hostel', 'Commercial Office Space', 'Office in IT Park/ SEZ', 'Commercial Shop', 'Commercial Showroom', 'Commercial Building', 'Commercial Land', 'Warehouse/ Godown', 'Industrial Land', 'Industrial Building', 'Industrial Shed', 'Agricultural Land', 'Farm House', 'Others'. For example, 'Type - Residential old house' or 'its an old independent house' both map to 'Residential House'; 'PG for girls' or 'paying guest accommodation' maps to 'PG/ Hostel'. Never leave 'type' null when the user has specified any property category — always pick the closest match from the list above rather than leaving it unset.\n" +
    "Handle updates to bedrooms intelligently: 'X BHK' or 'X bhk' means bedrooms = X. Always update 'bedrooms' when a BHK count is given.\n" +
    "Handle updates to area intelligently: 'area_sqft' is the BUILT-UP/carpet area of a structure; 'land_area' (with 'land_area_unit') is the SITE/PLOT size. If the user gives a 'plot'/'site'/land size figure, set 'land_area', not 'area_sqft' — even for a house/villa on that plot.\n" +
    "Include fields for rental vertical updates: listing_type ('Sale' or 'Rent'), rent_per_month, maintenance, advance, and gst.\n" +
    "Output MUST be valid JSON.";

  const prompt = `Current Draft:\n${JSON.stringify(currentDraft, null, 2)}\n\nUser Update Request:\n"${updateRequest}"\n\nApply these updates and return the updated JSON.`;
  const contents = [{ parts: [{ text: prompt }] }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true, { feature: 'listing_update' });
    const parsed = parseGeminiResponse(rawResult) as unknown as Partial<ParsedPropertyDraft>;

    const updatedDraft = {
      ...currentDraft,
      ...parsed,
      // Deterministic safety net (see parseListingFromImageOrText): if this
      // update newly set sublocality but the model still left the primary
      // location empty, fall back rather than showing "Missing".
      location: parsed.location || currentDraft.location || parsed.sublocality || currentDraft.sublocality || null,
      // Same idea for 'type' — normalize whatever the model returned (or
      // fall back to the prior value) rather than letting it revert to
      // null when the user clearly specified a category.
      type: normalizePropertyType(parsed.type ?? currentDraft.type) as ParsedPropertyDraft["type"],
      // Same idea for 'bedrooms' — fall back to extracting "X BHK" from
      // the raw correction text if the model didn't set it.
      bedrooms: parsed.bedrooms ?? currentDraft.bedrooms ?? extractBedroomsFromText(updateRequest) ?? null,
      // Re-validate the rent roll if the update touched it; otherwise
      // keep the prior rows.
      floor_tenancies:
        parsed.floor_tenancies !== undefined
          ? sanitizeFloorTenancies(parsed.floor_tenancies)
          : currentDraft.floor_tenancies ?? null,
      // Retain images and other fields if they were omitted in the response
      images: currentDraft.images || []
    };

    if (updatedDraft.rental_income && updatedDraft.price) {
      updatedDraft.roi = Number(((updatedDraft.rental_income * 12) / updatedDraft.price * 100).toFixed(2));
    } else {
      updatedDraft.roi = null;
    }

    return updatedDraft;
  } catch (err) {
    console.error("[Gemini AI] Error updating draft:", err);
    return currentDraft; // Return unchanged on error
  }
}

/**
 * Classifies if a message text is a request to save/add a contact or contains contact details.
 */
export async function isContactMessage(text: string): Promise<boolean> {
  const cleanText = text.trim();
  if (!cleanText) return false;

  const systemInstruction = 
    "You are an expert contact classifier. Your job is to classify if the incoming message contains contact details " +
    "to be saved, or requests to add, create, or save a contact/lead in a CRM system. " +
    "Only respond with exactly 'true' or 'false'. Absolutely no markdown, no punctuation, and no other text.";

  const prompt = `Classify this message:\n\n"${cleanText}"`;

  try {
    const response = await generateText(prompt, systemInstruction, { tier: 'lite', feature: 'chatbot_classify' });
    return response.toLowerCase().includes("true");
  } catch (err) {
    console.error("[Gemini AI] Error in isContactMessage classification:", err);
    // Fallback logic in case of API failure
    const keywords = ["add contact", "save contact", "new lead", "create contact", "add lead", "email is", "phone is", "save as contact"];
    return keywords.some(kw => cleanText.toLowerCase().includes(kw));
  }
}

export interface ParsedContactDraft {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  classification: "Owner" | "Seller" | "Buyer" | "Agent" | "Developer" | "Owner & Buyer" | "Others";
  notes: string | null;
  /** Buyer's stated buying criteria extracted from the conversation
   *  (budget, localities, size, property type, preferences). Persisted
   *  to contacts.requirements and later fed to preference extraction /
   *  matching. Kept separate from `notes` (source/summary). */
  requirements: string | null;
  referrer_name: string | null;
  referrer_phone: string | null;
}

export interface ParsedContactDraftsContainer {
  contacts: ParsedContactDraft[];
}

export function normalizeClassification(val?: string | null): "Owner" | "Seller" | "Buyer" | "Agent" | "Developer" | "Owner & Buyer" | "Others" {
  if (!val) return "Others";
  const norm = val.trim().toLowerCase();
  if (norm === "owner") return "Owner";
  if (norm === "seller") return "Seller";
  if (norm === "buyer") return "Buyer";
  if (norm === "agent") return "Agent";
  if (norm === "developer") return "Developer";
  if (norm === "owner & buyer" || norm === "owner and buyer" || norm === "ownerbuyer") return "Owner & Buyer";
  return "Others";
}

/**
 * `requirements` holds a buyer's stated buying criteria, so a contact that
 * has requirements is a buyer. When the parser/updater leaves the
 * classification unresolved ('Others') but a requirement is present, treat
 * the contact as a 'Buyer'. Any deliberately-set role (Owner/Seller/Agent/
 * Developer/Owner & Buyer) is left untouched.
 */
export function inferBuyerFromRequirements(
  classification: ParsedContactDraft["classification"],
  requirements: string | null
): ParsedContactDraft["classification"] {
  if (classification === "Others" && requirements && requirements.trim()) {
    return "Buyer";
  }
  return classification;
}

/**
 * Parses contact details from an image buffer (screenshot) and/or text block.
 */
export async function parseContactFromImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<ParsedContactDraftsContainer> {
  const systemInstruction = 
    "You are an expert contact data parser. Extract contact details from the provided text and/or image.\n" +
    "You must return a JSON object containing an array of contacts conforming to the following structure:\n" +
    "{\n" +
    "  \"contacts\": [\n" +
    "    {\n" +
    "      \"name\": \"Full name of the contact or null\",\n" +
    "      \"phone\": \"Phone number (numeric digits only, e.g. '9876543210' or with country code if visible like '919876543210') or null\",\n" +
    "      \"email\": \"Email address or null\",\n" +
    "      \"company\": \"Company name if specified or null\",\n" +
    "      \"classification\": \"Must be exactly one of: 'Owner', 'Seller', 'Buyer', 'Agent', 'Developer', 'Others'\",\n" +
    "      \"notes\": \"A short one-line summary of who this lead is and where they came from (e.g. 'Interested in SJR Blue Waters, Sarjapur Road. Source: Magicbricks') or null\",\n" +
    "      \"requirements\": \"For a BUYER: their stated buying criteria pulled from the WHOLE conversation — budget/price expectation, preferred localities/areas/landmarks, property type, size/area (sq ft, acre, cents), BHK, and any preferences (e.g. 'Wants ~1 acre to 2 acre (20000 sq ft to 2 acre) industrial land near Hosur Main Road / Hongasandra metro; main road preferred but slightly inside is fine; ok with market rate'). Capture ALL requirement details mentioned in the chat, not just the first line. null if the person is not a buyer or no requirements are stated.\",\n" +
    "      \"referrer_name\": \"Referrer or sender's name if mentioned (e.g. 'Sent by Suresh' or 'Referred by Suresh') or null\",\n" +
    "      \"referrer_phone\": \"Referrer or sender's phone number if mentioned (numeric digits only) or null\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Important parsing rules:\n" +
    "1. You can parse MULTIPLE contacts from the same image or text block. If there are multiple people/profiles/leads, create a separate object inside the 'contacts' array for each one.\n" +
    "2. Set any fields that cannot be found to null. For classification, choose the best fit based on context. Lead forwards showing interest in buying/renting a property must be classified as 'Buyer'.\n" +
    "3. In lead forwarding messages (e.g. 'VaishaliGaur, 917737932199 is interested in SJR Blue Waters...'), extract the lead's name ('VaishaliGaur'), phone ('917737932199'), classify as 'Buyer', and put their interest ('Interested in SJR Blue Waters, Sarjapur Road Magicbricks') in 'notes'.\n" +
    "4. For Referrer/Sender details: If the message/image details mention any sender or referrer name/phone (e.g., 'Referred by Suresh' or 'Sent by Suresh'), extract it into `referrer_name` and `referrer_phone` respectively. If not mentioned, set to null.\n" +
    "5. When the input is a screenshot or transcript of a BUYER conversation (questions about availability, budget, locations, sizes), read the ENTIRE conversation and consolidate every buying-criteria detail into `requirements`. Keep `notes` as the short source/summary line and put the detailed criteria in `requirements`. Do not drop preferences mentioned later in the chat.\n" +
    "6. Output MUST be valid JSON matching the schema.";

  const parts: GeminiPart[] = [];

  if (buffer && mimeType) {
    parts.push({
      inlineData: {
        mimeType,
        data: buffer.toString("base64")
      }
    });
  }

  const promptText = text 
    ? `Parse the following contact details:\n\n"${text}"`
    : "Extract all visible contact details from the provided image.";

  parts.push({ text: promptText });

  const contents = [{ parts }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true, { feature: 'contact_parse' });
    const parsed = parseGeminiResponse(rawResult) as unknown as Partial<ParsedContactDraftsContainer>;
    const contactsList = Array.isArray(parsed.contacts) ? parsed.contacts : [];

    return {
      contacts: contactsList.map((c: Partial<ParsedContactDraft>) => {
        const requirements = c.requirements || null;
        return {
          name: c.name || null,
          phone: c.phone ? (normalizePhoneWithCountryCode(c.phone) || null) : null,
          email: c.email || null,
          company: c.company || null,
          classification: inferBuyerFromRequirements(normalizeClassification(c.classification), requirements),
          notes: c.notes || null,
          requirements,
          referrer_name: c.referrer_name || null,
          referrer_phone: c.referrer_phone ? (normalizePhoneWithCountryCode(c.referrer_phone) || null) : null
        };
      })
    };
  } catch (err) {
    console.error("[Gemini AI] Error parsing contact details:", err);
    throw err;
  }
}

/**
 * Updates an existing parsed contact drafts container JSON with a conversational update instruction.
 */
export async function updateContactDraft(
  currentDraft: ParsedContactDraftsContainer,
  updateRequest: string
): Promise<ParsedContactDraftsContainer> {
  const systemInstruction = 
    "You are an expert contact data updater. You are given a current contact drafts JSON object containing an array of contacts and a natural language instruction from the user.\n" +
    "Your job is to apply the updates requested by the user and return the complete updated JSON object matching the exact structure.\n" +
    "For example, if the user says 'name of second contact is Vaishali', update the name of the second contact. If they say 'change classification to Agent for all', update the classification field to 'Agent' for all contacts in the list. If they say 'referred by Ramesh', update referrer_name. If they add buying criteria (e.g. 'budget is 90L', 'wants a plot in Whitefield', 'looking for 2 acres near Hosur'), merge it into the `requirements` field, preserving any requirements already captured.\n" +
    "When you populate `requirements` with buying criteria and the contact's classification is 'Others', set that contact's classification to 'Buyer'.\n" +
    "Do not change any other fields unless requested by the user.\n" +
    "Output MUST be valid JSON.";

  const prompt = `Current Draft:\n${JSON.stringify(currentDraft, null, 2)}\n\nUser Update Request:\n"${updateRequest}"\n\nApply these updates and return the updated JSON.`;
  const contents = [{ parts: [{ text: prompt }] }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true, { feature: 'contact_update' });
    const parsed = parseGeminiResponse(rawResult) as unknown as Partial<ParsedContactDraftsContainer>;
    const contactsList = Array.isArray(parsed.contacts) ? parsed.contacts : [];

    return {
      contacts: contactsList.map((c: Partial<ParsedContactDraft>) => {
        const requirements = c.requirements || null;
        return {
          name: c.name || null,
          phone: c.phone ? (normalizePhoneWithCountryCode(c.phone) || null) : null,
          email: c.email || null,
          company: c.company || null,
          classification: inferBuyerFromRequirements(normalizeClassification(c.classification), requirements),
          notes: c.notes || null,
          requirements,
          referrer_name: c.referrer_name || null,
          referrer_phone: c.referrer_phone ? (normalizePhoneWithCountryCode(c.referrer_phone) || null) : null
        };
      })
    };
  } catch (err) {
    console.error("[Gemini AI] Error updating contact draft:", err);
    return currentDraft; // Return unchanged on error
  }
}

