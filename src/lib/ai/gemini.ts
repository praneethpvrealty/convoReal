import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { PROPERTY_TYPE_VALUES, normalizePropertyType } from '@/lib/property-types';
import type { FloorPlan } from "@/lib/inventory/floor-plans";
import { sanitizeFloorPlans } from "@/lib/inventory/floor-plans";
import { sanitizeFloorTenancies, type FloorTenancy } from '@/lib/inventory/floor-tenancies';
import { logAiCall } from '@/lib/ai/call-log';
import { applyListingDerivations } from '@/lib/ai/listing-derivations';

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
    temperature?: number;
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

      // Structured extraction only. A JSON call has one right answer,
      // so sampling variety is noise: the same brief re-extracted came
      // back with a locality spelled as one comma-joined string where
      // the stored value was two, and the buyer ladder read that as new
      // information. Free-text generation keeps the model default —
      // property descriptions and ad copy are published, and at zero
      // two similar listings write themselves the same page.
      //
      // Narrows the drift; does not remove it. The failover chain can
      // answer on a different model entirely, and identical inputs are
      // not bit-identical across batches even at zero — so readers of
      // this output still have to tolerate variation rather than assume
      // it away.
      if (jsonMode) {
        payload.generationConfig = {
          responseMimeType: "application/json",
          temperature: 0
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

const BUYER_REQUIREMENT_SIGNAL =
  /\brequirements?\b|\b(?:looking (?:for|to buy|to rent)|want(?:s|ed)? to (?:buy|rent|purchase)|searching for|in the market for|budget (?:is|of|around|up ?to)|interested in buying)\b/i;

/**
 * True when the text reads as a BUYER stating what they want (a
 * "requirement" / "looking for …"), rather than a property being offered.
 * Used to keep a buyer requirement attached to the contact draft instead of
 * misrouting it into the property-listing flow, even though it mentions
 * sqft/plot/BHK/localities.
 */
export function looksLikeBuyerRequirement(text?: string): boolean {
  const cleanText = (text || '').trim();
  return !!cleanText && BUYER_REQUIREMENT_SIGNAL.test(cleanText);
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
 * Transcribes an owner's WhatsApp voice note into the text the rest of
 * the assistant reads.
 *
 * Audio used to reach exactly one destination — the calendar parser —
 * so a listing, a contact or a correction dictated instead of typed was
 * either forced into an event or answered with nothing. Transcribing
 * first makes a voice note the same message as a typed one, and every
 * path downstream is already built for text.
 *
 * Translated to English like the calendar parser's own `transcript`
 * field, so a note dictated in Hindi, Telugu or Kannada is classified
 * and parsed by the same prompts as a typed one. Returns '' on failure
 * so the caller can say it could not hear rather than act on a guess.
 */
export async function transcribeVoiceNote(buffer: Buffer, mimeType: string): Promise<string> {
  const systemInstruction =
    "You are a transcription engine for an Indian real-estate agent's voice notes. " +
    "Transcribe what is said, verbatim, and translate it into English if it is spoken in another language. " +
    "Reproduce names, phone numbers, prices, areas, dimensions and localities exactly as spoken. " +
    "Return only the transcript — no commentary, no speaker labels, no quotation marks. " +
    "If nothing intelligible is said, return an empty string.";
  try {
    const parts: GeminiPart[] = [
      {
        inlineData: {
          mimeType: mimeType.split(";")[0].trim() || "audio/ogg",
          data: buffer.toString("base64"),
        },
      },
      { text: "Transcribe this voice note." },
    ];
    const response = await generateContentRaw([{ parts }], systemInstruction, false, {
      feature: 'voice_transcribe',
    });
    return (response || "").trim();
  } catch (err) {
    console.error("[Gemini AI] Error transcribing voice note:", err);
    return "";
  }
}

/**
 * Classifies if a message (text or image) is a real estate listing, contact
 * details, a scheduling request, or none of those.
 */
export async function classifyImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<'property' | 'contact' | 'schedule' | 'client_reply' | 'none'> {
  const systemInstruction =
    "You are an expert real estate lead classifier. Your job is to classify if the incoming message (which can be text and/or an image) is:\n" +
    "1. 'property': A property listing to be added to inventory, layout plan, listing advertisement, or property details description.\n" +
    "2. 'contact': Contact details, vCard details, request to add/save a contact/lead, screenshot of contact/profile details, or lead forwarding/inquiry messages containing contact name/phone and their property interest (e.g. 'VaishaliGaur, 917737932199 is interested in SJR Blue Waters' or Magicbricks/99acres/Housing forwards).\n" +
    "3. 'schedule': A meeting, site visit, call or appointment being arranged or confirmed for a stated day/time — typically a screenshot of a chat thread where two people settle on when to meet (e.g. 'Monday 5 pm the meeting with the lawyer is confirmed right' / 'Yes, its confirmed'), or a calendar invite screenshot.\n" +
    "4. 'client_reply': A screenshot of a WhatsApp chat thread where an EXISTING client/lead is replying with a status update or decision about a property that was already shared or discussed with them — e.g. answering a follow-up/check-in like 'just checking in on <property>... are you still considering?' with 'I will speak to the chairman and let you know', 'still thinking about it', 'we liked it, will confirm next week'. The thread typically shows the agent's earlier property link/check-in and the other party's response bubble.\n" +
    "5. 'none': None of the above.\n\n" +
    "Precedence: when BOTH property listing details (area/sq ft, dimensions like 50x75, facing, price in cr/lakh, plot/site number, BHK) AND a person's name/phone are present, classify as 'property' — the listing is the primary intent. Reserve 'contact' for messages whose main purpose is saving a person or forwarding a buyer's interest/requirement.\n" +
    "'client_reply' beats 'property' and 'contact' for a two-sided chat screenshot whose point is the OTHER party's answer about an already-shared listing: the property preview card or code (e.g. PROP-1138) inside such a thread is context, not a new listing, and the person replying is already known, not a new lead to save. Reserve 'contact' for forwards that INTRODUCE a person.\n" +
    "'schedule' is the narrowest class and never wins over the other two: a listing or a lead forward that merely mentions a day ('call him on Monday', 'site visit possible this weekend') is still 'property' or 'contact'. Choose 'schedule' only when arranging or confirming the WHEN is the entire point of the message and a specific day or time is actually stated. A vague promise to get back ('will let you know', 'soon') is 'client_reply', not 'schedule'.\n" +
    "Only respond with exactly 'property', 'contact', 'schedule', 'client_reply', or 'none'. Absolutely no markdown, no punctuation, and no other text.";

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
    if (classification.includes("client_reply") || classification.includes("client")) return "client_reply";
    if (classification.includes("property")) return "property";
    if (classification.includes("schedule")) {
      // A listing poster that also names a viewing day must not be
      // pulled onto the calendar instead of into inventory.
      if (looksLikePropertyListing(text)) return "property";
      if (!text?.trim() && buffer && mimeType) {
        const imageText = await transcribeImageText(buffer, mimeType);
        if (looksLikePropertyListing(imageText)) return "property";
      }
      return "schedule";
    }
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
  /** The development or society this unit is in ("Sattva Exotic").
   *  Distinct from sublocality, which is the area around it. Carried to
   *  properties.project, and matched against the account's projects so
   *  a forwarded floor plan lands as a unit rather than an orphan.
   *  Optional like every other field added after the original shape —
   *  a draft persisted before this existed has no key for it. */
  project?: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  land_area: number | null;
  land_area_unit: string | null;
  /** Rate quoted per Sq.Ft. ("10500 per sqft"), kept so the total price
   *  can be derived once an area arrives — often a message or two later. */
  price_per_sqft?: number | null;
  /** True while `price` is the product of `price_per_sqft` and the area,
   *  so it re-derives when the area changes but never overwrites a total
   *  the user stated outright. */
  price_from_rate?: boolean;
  description: string | null;
  features: string[] | null;
  nearby_highlights: string[] | null;
  dimensions: string | null;
  facing_direction: string | null;
  rental_income: number | null;
  roi: number | null;
  google_map_link: string | null;
  /** Coordinates of a shared map pin, resolved from `google_map_link`.
   *  Carried to properties.latitude/longitude so WhatsApp-intake
   *  listings are covered by radius matching and ad targeting. */
  latitude?: number | null;
  longitude?: number | null;
  /** The map link (or coordinate pair) the geo fields above were
   *  resolved from, so re-parsing a draft doesn't re-hit the geocoder
   *  on every follow-up message. */
  geo_resolved_from?: string | null;
  images: string[];
  documents?: string[];
  /** Walkthrough video forwarded during WhatsApp intake — uploaded to
   *  the property-videos bucket, becomes properties.video_url. */
  video_url?: string | null;
  /** YouTube link shared during intake — extracted deterministically
   *  from the message text (never by the model), becomes
   *  properties.youtube_video_id. */
  youtube_video_id?: string | null;
  owner_contact_name: string | null;
  /** The qualifier trailing a phonebook name ("8th Block 2100 Sqft
   *  Corner Property Owner"), split off a forwarded contact card so the
   *  saved contact greets a person rather than a label. Set only by
   *  `applySharedCardOwner`, never by the model. */
  owner_contact_name_tag?: string | null;
  owner_contact_phone: string | null;
  owner_contact_role: string | null;
  listing_type: "Sale" | "Rent" | "JV/JD" | null;
  rent_per_month: number | null;
  maintenance: number | null;
  advance: number | null;
  gst: number | null;
  /** JV/JD deal terms. A joint development has no asking price — the
   *  landowner trades the land for a share of what gets built — so
   *  these carry the deal the way `price` carries a sale. */
  jv_structure?: "Revenue Share" | "Area Share" | "Hybrid" | null;
  owner_share_percent?: number | null;
  builder_share_percent?: number | null;
  goodwill_amount?: number | null;
  /** Floor-wise rent roll for pre-leased commercial buildings. */
  floor_tenancies?: FloorTenancy[] | null;
  /** Floors the source document draws a plan for, in document order.
   *  The model supplies the labels and page numbers; the drawings
   *  themselves are matched in from the PDF's extracted images. */
  floor_plans?: FloorPlan[] | null;
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
    fallback.project = extractString("project");
    fallback.city = extractString("city");
    fallback.state = extractString("state");
    fallback.bedrooms = extractNumber("bedrooms");
    fallback.bathrooms = extractNumber("bathrooms");
    fallback.area_sqft = extractNumber("area_sqft");
    fallback.land_area = extractNumber("land_area");
    fallback.land_area_unit = extractString("land_area_unit");
    fallback.price_per_sqft = extractNumber("price_per_sqft");
    fallback.description = extractString("description");
    fallback.features = normalizeListingFeatures(extractArray("features"));
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
        contact.name_tag = extractContactStr("name_tag");
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

const MIXED_PAYMENT_LABEL = 'Mixed payment terms';
const BLACK_WHITE_PAYMENT_RE = /black\s*(?:and|&|n)\s*white/i;

/**
 * Normalize AI-extracted listing features: replace the legally-loaded
 * "black and white payment" phrasing (part-cash / part-cheque) with the
 * neutral "Mixed payment terms", trim, drop empties, and dedupe
 * (case-insensitive, order preserved). Exported for unit tests.
 */
export function normalizeListingFeatures(features?: unknown): string[] {
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of features) {
    if (typeof raw !== 'string') continue;
    const label = BLACK_WHITE_PAYMENT_RE.test(raw) ? MIXED_PAYMENT_LABEL : raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
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
    "  \"price\": Numeric TOTAL price in INR (e.g. if text says '1.2 Cr' or '120 Lakhs', price is 12000000) or null,\n" +
    "  \"price_per_sqft\": Numeric rate in INR per Sq.Ft. when the price is quoted per unit area (e.g. '10500 per sqft' -> 10500, '₹1.2 Cr per acre' -> 275.48) or null,\n" +
    "  \"location\": \"Exact location or address or null\",\n" +
    "  \"type\": \"Must be exactly one of: 'Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Residential Land/ Plot', 'Penthouse', 'Studio Apartment', 'Residential PG building', 'PG/ Hostel', 'Commercial Office Space', 'Office in IT Park/ SEZ', 'Commercial Shop', 'Commercial Showroom', 'Commercial Building', 'Commercial Land', 'Warehouse/ Godown', 'Industrial Land', 'Industrial Building', 'Industrial Shed', 'Agricultural Land', 'Farm House', 'Others' or null\",\n" +
    "  \"sublocality\": \"Sublocality or neighborhood name or null\",\n" +
    "  \"project\": \"Name of the apartment project, development or society this unit is in (e.g. 'Sattva Exotic', 'Prestige Lakeside Habitat') or null. This is the BUILDING's name, not the area — never copy the sublocality here, and leave it null for an independent house or a plot.\",\n" +
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
    "  \"dimensions\": \"Plot dimensions in feet if land/plot, including sizes given as 'Size - 60*40' or '30 x 40' (e.g., '30x40') or null\",\n" +
    "  \"facing_direction\": \"E.g. 'North', 'East', 'West', 'South' or null\",\n" +
    "  \"rental_income\": \"Numeric monthly rental income in INR if specified (e.g., if text says 'rent 2.5 Lakhs/month' or '2.5 L rent', rental_income is 250000) or null\",\n" +
    "  \"google_map_link\": \"Google Map link URL if present in text/image (e.g., 'https://maps.app.goo.gl/...' or 'https://google.com/maps/...') or null\",\n" +
    "  \"owner_contact_name\": \"Contact person's name, or sender's name or listing agent/owner name mentioned or null\",\n" +
    "  \"owner_contact_phone\": \"Contact person's phone number mentioned (numeric digits only) or null\",\n" +
    "  \"owner_contact_role\": \"Role of the contact person mentioned (must be 'Agent' or 'Owner' or null)\",\n" +
    "  \"listing_type\": \"Transaction type ('Sale', 'Rent' or 'JV/JD'). Set to 'Rent' if terms like 'for rent', 'rent per month', 'advance/deposit', 'lease' are used. Set to 'JV/JD' if the land is offered for joint development / joint venture ('JD', 'JV', 'joint development', 'available for an apartment JD', 'revenue share basis'). Default is 'Sale'\",\n" +
    "  \"rent_per_month\": Numeric monthly rent in INR (e.g. 'rent 40k' -> 40000) or null,\n" +
    "  \"maintenance\": Numeric monthly maintenance charges in INR or null,\n" +
    "  \"advance\": Numeric security deposit / advance in INR (e.g. 'advance 2.5 L' -> 250000) or null,\n" +
    "  \"gst\": Numeric GST percentage (e.g. '18% GST' -> 18) or flat GST amount in INR or null,\n" +
    "  \"jv_structure\": \"JV/JD deal structure, one of 'Revenue Share', 'Area Share', 'Hybrid', or null\",\n" +
    "  \"owner_share_percent\": Numeric landowner's share of the JV/JD deal in percent (e.g. 'JD 60:40' -> 60) or null,\n" +
    "  \"builder_share_percent\": Numeric builder's/developer's share of the JV/JD deal in percent or null,\n" +
    "  \"goodwill_amount\": Numeric non-refundable upfront goodwill paid to the landowner in a JV/JD deal in INR or null,\n" +
    "  \"floor_tenancies\": For commercial buildings sold with a floor-wise / unit-wise breakdown (rent roll), an array with one entry per floor or unit that has any rent, tenant, or usage detail: [{\"floor\": \"Ground + First Floor\", \"area_sqft\": 20000 or null, \"tenant_name\": \"tenant/business name or null\", \"monthly_rent\": monthly rent in INR excluding GST (e.g. '₹8,00,000' -> 800000) or null, \"advance\": interest-free security deposit for this floor in INR, resolving multiples against that floor's rent (e.g. '6 months deposit' on ₹8,00,000 -> 4800000) or null, \"lease_start\": \"YYYY-MM-DD\" or null, \"lease_end\": \"YYYY-MM-DD\" or null, \"lock_in_months\": numeric or null, \"maintenance\": \"maintenance terms or null\", \"notes\": \"usage, e.g. 'Hypermarket' or '3-Star Hotel, 27 rooms'\"}]. Empty array when the input has no floor-wise breakdown\n" +
    "  \"floor_plans\": Floors the document draws a PLAN or LAYOUT for (a line drawing of rooms/walls, not a photograph), in the order they appear: [{\"floor\": \"Ground Floor\", \"area_sqft\": built-up area labelled on that plan (numeric) or null, \"notes\": \"what the plan shows, e.g. '3 BHK + pooja room'\", \"page\": 1-based page number the plan is printed on, or null}]. Include one entry per floor drawing. Empty array when the document contains no floor plan\n" +
    "}\n\n" +
    "Important parsing rules:\n" +
    "0. CRITICAL: The 'title' field is a human-readable summary and will often restate details — like BHK count, area, or location — that ALSO belong in their own structured fields below. NEVER treat a detail as 'already handled' just because it appears in the title. You MUST still populate every matching structured field (bedrooms, area_sqft, land_area, location, type, etc.) independently and completely whenever that information is present anywhere in the input, even if it's redundant with the title.\n" +
    "1. For Price, Rent, Advance/Deposit: Convert terms like 'Crore', 'Cr', 'Lakhs', 'L', 'k' to standard numeric integer values (e.g., '80 Lakhs' -> 8000000, '1.5 Cr' -> 15000000, '2.5 L' -> 250000, '25k' -> 25000).\n" +
    "1b. A shared map pin arrives as a Google Maps URL or a bare coordinate pair (e.g. '12.8669,77.5565483'). That is NOT an address: put the URL in 'google_map_link' and leave 'location'/'sublocality'/'city' null unless the input also names the area in words — the system reverse-geocodes the pin into the address itself.\n" +
    "2. For Location: ALWAYS populate the top-level 'location' field with the primary area/neighborhood/address text mentioned anywhere in the input (e.g. if the text says '...for sale in Jayanagar 17th Main' or 'Location - Jayanagar 17th Main', set location to 'Jayanagar 17th Main'). Never leave 'location' null just because the same text is already part of the 'title' — 'location' is a separate required field. Additionally, if a distinct sublocality/layout name (e.g. HSR Layout, Koramangala) is identifiable, also set 'sublocality' — but 'location' must be filled whenever ANY area/address is mentioned, even if it's identical to 'sublocality'.\n" +
    "3. For Bedrooms: 'X BHK' or 'X bhk' means bedrooms = X (numeric). Always set 'bedrooms' whenever a BHK count is mentioned anywhere in the input, even if that same count already appears in the title (e.g. title '5 BHK old house...' still requires bedrooms: 5).\n" +
    "4. For Area vs Land Area: 'area_sqft' is the BUILT-UP / carpet / super built-up area of a structure (a flat's interior, a house's floor area, etc). 'land_area' (with 'land_area_unit') is the SITE/PLOT size the property sits on, or vacant land itself. If the input mentions a 'plot', 'site', or land size figure (e.g. '3870 sqft plot', '30x40 site'), put it in 'land_area', NOT 'area_sqft' — even when the listing is a house/villa built on that plot. Only put a figure in 'area_sqft' when it's explicitly described as built-up/carpet/floor area.\n" +
    "4a. A plot size given as dimensions ('Size - 60*40', '30 x 40', '40x60 site') is in FEET: record it in 'dimensions' AND set 'land_area' to the product in Sq.Ft. with 'land_area_unit' of 'Sq.Ft.' (e.g. '60*40' -> dimensions '60x40', land_area 2400).\n" +
    "4b. A price quoted per unit area ('10500 per sqft', '₹4,500/sq.ft.', '1.2 Cr per acre') is a RATE, not the total: put the rate converted to rupees per Sq.Ft. in 'price_per_sqft' and leave 'price' null unless a separate total amount is also stated. Never put a per-unit rate in 'price'.\n" +
    "5. For vacant land/plot without building details (e.g., no bedrooms/bathrooms/apartment mention), map 'type' intelligently based on keywords to 'Residential Land/ Plot', 'Commercial Land', 'Industrial Land', or 'Agricultural Land'. For example, commercial plots go to 'Commercial Land'.\n" +
    "6. For PG/Hostel listings: if the input mentions 'PG', 'paying guest', or 'hostel', map 'type' to 'PG/ Hostel' (or 'Residential PG building' if it's clearly a whole building run as a PG business, not a single room/bed being offered).\n" +
    "7. Set any fields that cannot be found or reasonably inferred to null.\n" +
    "8. For Amenities/Features: Extract any amenities, specifications, or internal/external building features of the property (such as wood flooring, modular kitchen, power backup, gym, pool, gated community, library, basement, water supply, fenced boundary, security, etc.) into the `features` array.\n" +
    "9. For Nearby Highlights/Landmark information: Extract any nearby landmarks, highlights, or proximity information (such as near metro station, opposite Starbucks, near shopping mall, hospital, school, tech park, etc.) into the `nearby_highlights` array. Do NOT confuse building details/features with nearby landmarks/highlights.\n" +
    "10. For Listing/Owner Contact details: If the message/image details have any contact person or sender's name (e.g., 'Regards, Ramesh (Agent)' or 'Contact Suresh on 9876543210'), extract their name, phone (if present), and role ('Agent' or 'Owner'). If not mentioned, set to null.\n" +
    "11. For whole commercial buildings / mixed-use developments (multiple floors with different uses like hypermarket + hotel + gym): set 'type' to 'Commercial Building', capture each floor/unit in 'floor_tenancies', and set 'rental_income' to the TOTAL monthly rent when stated.\n" +
    "11b. A JD/JV offer is priced in shares, not rupees. When land is offered for joint development, set 'listing_type' to 'JV/JD' and leave 'price' null unless a total project value is explicitly stated — a JD listing without a price is complete, not incomplete. Capture the split in 'owner_share_percent'/'builder_share_percent' (a ratio like '60:40' is owner:builder unless the input names the other order) and the basis in 'jv_structure'.\n" +
    "11c. A JD/JV goodwill or advance quoted per unit of land ('goodwill and advance 2.5 Cr per acre' on a 12-acre site) is a rate on the deal: multiply it by the land area and write the total into EVERY field the phrase names — that example sets 'goodwill_amount' AND 'advance' alike. Such a rate is never 'price' or 'price_per_sqft': those describe land being sold, which a JD is not.\n" +
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

    const draft: ParsedPropertyDraft = {
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
      price_per_sqft: parsed.price_per_sqft || null,
      description: parsed.description || null,
      features: normalizeListingFeatures(parsed.features),
      nearby_highlights: parsed.nearby_highlights || [],
      dimensions: parsed.dimensions || null,
      facing_direction: parsed.facing_direction || null,
      rental_income: parsed.rental_income || null,
      roi: null,
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
      jv_structure: parsed.jv_structure || null,
      owner_share_percent: parsed.owner_share_percent ?? null,
      builder_share_percent: parsed.builder_share_percent ?? null,
      goodwill_amount: parsed.goodwill_amount ?? null,
      floor_tenancies: sanitizeFloorTenancies(parsed.floor_tenancies),
      floor_plans: sanitizeFloorPlans(parsed.floor_plans)
    };

    return applyListingDerivations(draft, text);
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
    "A shared map pin arrives as a Google Maps URL or a bare coordinate pair (e.g. '12.8669,77.5565483'): set 'google_map_link' to the URL and never write coordinates into 'location' — the system reverse-geocodes the pin into an address.\n" +
    "Handle updates to location intelligently: if the user says 'location is X', 'Location - X', 'located in X', or similar, set the top-level 'location' field to X. 'location' is a required primary address field, separate from 'sublocality' — never leave it unset when the user has given any area/address text, even if you also record a more specific 'sublocality'.\n" +
    "Handle updates to property type intelligently: if the user says 'type is X', 'Type - X', or describes the property category in any way, map it to the closest matching value from this exact list: 'Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Residential Land/ Plot', 'Penthouse', 'Studio Apartment', 'Residential PG building', 'PG/ Hostel', 'Commercial Office Space', 'Office in IT Park/ SEZ', 'Commercial Shop', 'Commercial Showroom', 'Commercial Building', 'Commercial Land', 'Warehouse/ Godown', 'Industrial Land', 'Industrial Building', 'Industrial Shed', 'Agricultural Land', 'Farm House', 'Others'. For example, 'Type - Residential old house' or 'its an old independent house' both map to 'Residential House'; 'PG for girls' or 'paying guest accommodation' maps to 'PG/ Hostel'. Never leave 'type' null when the user has specified any property category — always pick the closest match from the list above rather than leaving it unset.\n" +
    "Handle updates to bedrooms intelligently: 'X BHK' or 'X bhk' means bedrooms = X. Always update 'bedrooms' when a BHK count is given.\n" +
    "Handle updates to area intelligently: 'area_sqft' is the BUILT-UP/carpet area of a structure; 'land_area' (with 'land_area_unit') is the SITE/PLOT size. If the user gives a 'plot'/'site'/land size figure, set 'land_area', not 'area_sqft' — even for a house/villa on that plot.\n" +
    "A plot size given as dimensions ('Size - 60*40', '30 x 40') is in FEET: set 'dimensions' AND set 'land_area' to the product in Sq.Ft. with 'land_area_unit' of 'Sq.Ft.' (e.g. '60*40' -> dimensions '60x40', land_area 2400).\n" +
    "A price quoted per unit area ('10500 per sqft', '1.2 Cr per acre') is a RATE, not the total: set 'price_per_sqft' to the rate in rupees per Sq.Ft. and leave 'price' unchanged unless the user states a separate total amount. Never put a per-unit rate in 'price'.\n" +
    "Include fields for rental vertical updates: listing_type ('Sale' or 'Rent'), rent_per_month, maintenance, advance, and gst.\n" +
    "Handle joint development updates intelligently: 'it's a JD', 'offered for joint venture', 'area share 60:40' or 'goodwill 20 lakhs' all mean listing_type 'JV/JD' — set jv_structure ('Revenue Share', 'Area Share' or 'Hybrid'), owner_share_percent, builder_share_percent (a ratio is owner:builder unless stated otherwise) and goodwill_amount. A JV/JD deal has no asking price: never invent one, and if the user later gives a plain sale price, switch listing_type back to 'Sale'.\n" +
    "A JV/JD goodwill or advance quoted per unit of land ('goodwill and advance 2.5 Cr per acre' against a 12-acre site) is a rate on the deal: multiply it by the draft's land area and write the total into EVERY field the phrase names — that example sets both goodwill_amount and advance. Never put such a rate in price or price_per_sqft; a JD's land is not being sold.\n" +
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
      // A correction never re-reads the brochure, so plans the intake
      // already pinned survive it untouched.
      floor_plans: currentDraft.floor_plans ?? null,
      // Normalize features whether the update touched them or not.
      features: normalizeListingFeatures(parsed.features ?? currentDraft.features),
      // A correction that doesn't mention the plot size or the per-unit
      // rate must not blank them out — both feed the price derivation.
      dimensions: parsed.dimensions ?? currentDraft.dimensions ?? null,
      price_per_sqft: parsed.price_per_sqft ?? currentDraft.price_per_sqft ?? null,
      // Retain images and other fields if they were omitted in the response
      images: currentDraft.images || []
    };

    return applyListingDerivations(updatedDraft, updateRequest, currentDraft);
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
    "to be saved, or requests to add, create, or save a contact/lead in a contact database. " +
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
  /** Short qualifier shown next to the name inside the Engine only
   *  (e.g. 'Advocate', 'Bank DSA') — kept out of outbound messages. */
  name_tag: string | null;
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
  // 'Broker' is what an agent is called locally, and a 'Builder' is a
  // developer — the words the trade actually uses for two roles the
  // Engine only names one way.
  if (norm === "agent" || norm === "broker") return "Agent";
  if (norm === "developer" || norm === "builder") return "Developer";
  if (norm === "owner & buyer" || norm === "owner and buyer" || norm === "ownerbuyer") return "Owner & Buyer";
  return "Others";
}

/**
 * A name tag holding a classification value is the contact's role, not a
 * name qualifier. The draft preview labels the field "Role/Classification",
 * so an owner correcting it answers in that vocabulary ("Role - agent") —
 * and the prompt describes `name_tag` as a "profession or role tag", which
 * catches it first. Promote the value to where the user meant it to go.
 *
 * A genuine tag ('Advocate', 'CA', 'Bank DSA') normalizes to 'Others' and
 * is left alone.
 */
export function promoteClassificationFromNameTag(
  nameTag: string | null,
  classification: ParsedContactDraft["classification"]
): { name_tag: string | null; classification: ParsedContactDraft["classification"] } {
  if (!nameTag) return { name_tag: nameTag, classification };
  const promoted = normalizeClassification(nameTag);
  if (promoted === "Others") return { name_tag: nameTag, classification };
  return { name_tag: null, classification: promoted };
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
    "      \"name_tag\": \"Short qualifier/label for the name — a profession or role tag like 'Advocate', 'CA', 'Bank DSA', 'Site Engineer' — when the input states one (e.g. 'Tag - Advocate') or appends it to the name. null otherwise.\",\n" +
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
    "4b. For `name_tag`: an explicitly stated tag (e.g. 'Tag - Advocate', 'tag him as CA') always goes to `name_tag`, and a profession/role qualifier stuck onto the name (e.g. 'Vijay Sarthi Advocate') is split out — name 'Vijay Sarthi', name_tag 'Advocate'. Never leave a stated tag only in `notes`.\n" +
    "4c. `name_tag` NEVER holds one of the `classification` values. When the stated label is 'Owner', 'Seller', 'Buyer', 'Agent', 'Developer' or 'Owner & Buyer' — however it is phrased ('Role - agent', 'he is an agent', 'tag as owner') — it belongs in `classification` and `name_tag` stays null. 'Broker' means 'Agent' and 'Builder' means 'Developer'. `name_tag` is only for professions outside that list, like 'Advocate' or 'CA'.\n" +
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
        const { name_tag, classification } = promoteClassificationFromNameTag(
          c.name_tag || null,
          normalizeClassification(c.classification)
        );
        return {
          name: c.name || null,
          name_tag,
          phone: c.phone ? (normalizePhoneWithCountryCode(c.phone) || null) : null,
          email: c.email || null,
          company: c.company || null,
          classification: inferBuyerFromRequirements(classification, requirements),
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

/** A client's status reply about an already-shared property, read out of
 *  a forwarded chat screenshot (or pasted text). All fields nullable —
 *  matching against the Engine's contacts/properties happens downstream. */
export interface ParsedClientReply {
  client_name: string | null;
  client_phone: string | null;
  property_code: string | null;
  property_title: string | null;
  response_summary: string | null;
  next_action: string | null;
  timeline_hint: string | null;
}

/**
 * Parses the client's response out of a forwarded conversation screenshot
 * and/or text. The "client" is the OTHER party in the thread — not the
 * agent who forwarded it.
 */
export async function parseClientReplyFromImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<ParsedClientReply> {
  const systemInstruction =
    "You are reading a WhatsApp chat between a real-estate agent and their client about a property that was already shared. Extract what the CLIENT (the other party, not the agent) replied.\n" +
    "Return a JSON object with this structure:\n" +
    "{\n" +
    "  \"client_name\": \"The client's name — from the chat header/contact name if visible, or as addressed in the messages (e.g. 'Hi Surya' -> 'Surya') — or null\",\n" +
    "  \"client_phone\": \"The client's phone number if visible (numeric digits only) or null\",\n" +
    "  \"property_code\": \"The property reference code if one appears, exactly as printed (e.g. 'PROP-1138') or null\",\n" +
    "  \"property_title\": \"The property's title/description as it appears in the thread (e.g. 'About 3 acres for an outright sale in Sarjapur') or null\",\n" +
    "  \"response_summary\": \"One short third-person sentence stating the client's latest response about the property (e.g. 'Will speak to the chairman in person and get back') or null\",\n" +
    "  \"next_action\": \"What the client said they will do next, if anything (e.g. 'Speak to the chairman') or null\",\n" +
    "  \"timeline_hint\": \"When the client said they will get back, if stated (e.g. 'tomorrow', 'next week') or null\"\n" +
    "}\n\n" +
    "Rules:\n" +
    "1. In a WhatsApp screenshot the agent's own messages are right-aligned (green bubbles); the client's are left-aligned. The client is the left side.\n" +
    "2. Summarize only the client's LATEST reply about the property — earlier small talk or unrelated messages do not belong in response_summary.\n" +
    "3. Never invent a name, code, or timeline that is not visible. null is the correct answer for anything not present.\n" +
    "4. Output MUST be valid JSON.";

  const parts: GeminiPart[] = [];
  if (buffer && mimeType) {
    parts.push({ inlineData: { mimeType, data: buffer.toString("base64") } });
  }
  parts.push({
    text: text
      ? `Extract the client's response:\n\n"${text}"`
      : "Extract the client's response from the provided chat screenshot.",
  });

  const rawResult = await generateContentRaw([{ parts }], systemInstruction, true, { feature: 'contact_parse' });
  const parsed = parseGeminiResponse(rawResult) as unknown as Partial<ParsedClientReply>;
  return {
    client_name: parsed.client_name || null,
    client_phone: parsed.client_phone ? (normalizePhoneWithCountryCode(parsed.client_phone) || null) : null,
    property_code: parsed.property_code || null,
    property_title: parsed.property_title || null,
    response_summary: parsed.response_summary || null,
    next_action: parsed.next_action || null,
    timeline_hint: parsed.timeline_hint || null,
  };
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
    "For example, if the user says 'name of second contact is Vaishali', update the name of the second contact. If they say 'change classification to Agent for all', update the classification field to 'Agent' for all contacts in the list. If they say 'referred by Ramesh', update referrer_name. If they say 'Tag - Advocate' or 'name tag is CA', update `name_tag` (a short profession label shown next to the name). If they add buying criteria (e.g. 'budget is 90L', 'wants a plot in Whitefield', 'looking for 2 acres near Hosur'), merge it into the `requirements` field, preserving any requirements already captured.\n" +
    "The draft preview shown to the user labels `classification` as \"Role/Classification\", so any instruction naming a role — 'Role - agent', 'role is owner', 'he is a developer', 'mark as buyer' — updates `classification` and leaves `name_tag` untouched. 'Broker' means 'Agent' and 'Builder' means 'Developer'. `name_tag` NEVER holds 'Owner', 'Seller', 'Buyer', 'Agent', 'Developer' or 'Owner & Buyer'; it is only for professions outside that list, like 'Advocate' or 'CA'.\n" +
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
        const { name_tag, classification } = promoteClassificationFromNameTag(
          c.name_tag || null,
          normalizeClassification(c.classification)
        );
        return {
          name: c.name || null,
          name_tag,
          phone: c.phone ? (normalizePhoneWithCountryCode(c.phone) || null) : null,
          email: c.email || null,
          company: c.company || null,
          classification: inferBuyerFromRequirements(classification, requirements),
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

