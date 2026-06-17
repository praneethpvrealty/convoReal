/**
 * Centralized Gemini AI client helper.
 * Uses the Generative Language REST API directly to avoid additional SDK dependencies.
 */

// Define models to try. We prioritize the latest Gemini 2.5 Flash,
// but fall back to the extremely stable Gemini 1.5 Flash if needed.
const MODELS = ["gemini-2.5-flash", "gemini-1.5-flash"];

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
  jsonMode: boolean = false
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured. Please add it to your .env.local file.");
  }

  let lastError: Error | null = null;

  for (const model of MODELS) {
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
      return text.trim();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[Gemini AI] Failed with model ${model}:`, errorMessage);
      lastError = err instanceof Error ? err : new Error(errorMessage);

      // If it is a transient error (rate limit, service unavailable, high demand),
      // we proceed to try the fallback model.
      const isTransientError = 
        errorMessage.includes("high demand") || 
        errorMessage.includes("quota") || 
        errorMessage.includes("429") || 
        errorMessage.includes("503");

      if (isTransientError && model !== MODELS[MODELS.length - 1]) {
        console.log("[Gemini AI] Falling back to the next model due to transient error...");
        continue;
      }
      
      // For non-transient errors (like invalid API keys), fail fast.
      throw err;
    }
  }

  throw lastError || new Error("Failed to generate content with all available models.");
}

/**
 * Standard utility to generate plain text using prompt and system instruction.
 */
export async function generateText(prompt: string, systemInstruction?: string): Promise<string> {
  const contents = [{ parts: [{ text: prompt }] }];
  return generateContentRaw(contents, systemInstruction, false);
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
    const response = await generateText(prompt, systemInstruction);
    return response.toLowerCase().includes("true");
  } catch (err) {
    console.error("[Gemini AI] Error in isListingMessage classification:", err);
    // Fallback search logic in case of API failure
    const keywords = ["bhk", "sqft", "flat", "plot", "villa", "sale", "rent", "layout", "devanahalli", "furnish", "crore", "lakh", "price", "location", "acres", "commercial", "industrial"];
    return keywords.some(kw => cleanText.toLowerCase().includes(kw));
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
    const response = await generateContentRaw(contents, systemInstruction, false);
    const classification = response.toLowerCase().trim();
    if (classification.includes("property")) return "property";
    if (classification.includes("contact")) return "contact";
    return "none";
  } catch (err) {
    console.error("[Gemini AI] Error in classifyImageOrText:", err);
    // Fallback logic
    const lowerText = text?.toLowerCase() || "";
    const contactKeywords = ["add contact", "save contact", "new lead", "create contact", "add lead", "email is", "phone is", "save as contact", "is interested in", "magicbricks", "99acres", "housing.com"];
    if (contactKeywords.some(kw => lowerText.includes(kw))) {
      return "contact";
    }
    const propertyKeywords = ["bhk", "sqft", "flat", "plot", "villa", "sale", "rent", "layout", "crore", "lakh", "price", "location"];
    if (propertyKeywords.some(kw => lowerText.includes(kw))) {
      return "property";
    }
    return "none";
  }
}


export interface ParsedPropertyDraft {
  title: string | null;
  price: number | null;
  location: string | null;
  type: "Flat/ Apartment" | "Villa" | "Residential Land/ Plot" | "Commercial/ Industrial" | "Others" | null;
  sublocality: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  description: string | null;
  features: string[] | null;
  dimensions: string | null;
  facing_direction: string | null;
  rental_income: number | null;
  roi: number | null;
  images: string[];
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
    "  \"type\": \"Must be exactly one of: 'Flat/ Apartment', 'Villa', 'Residential Land/ Plot', 'Commercial/ Industrial', 'Others' or null\",\n" +
    "  \"sublocality\": \"Sublocality or neighborhood name or null\",\n" +
    "  \"city\": \"City name (default 'Bangalore')\",\n" +
    "  \"state\": \"State name (default 'Karnataka')\",\n" +
    "  \"bedrooms\": Number of bedrooms (numeric) or null,\n" +
    "  \"bathrooms\": Number of bathrooms (numeric) or null,\n" +
    "  \"area_sqft\": Area in Sq.Ft. (numeric) or null,\n" +
    "  \"description\": \"A professional description summarizing the listing or null\",\n" +
    "  \"features\": Array of string features/amenities (e.g., ['Fenced Boundary', 'Access Road']) or empty array,\n" +
    "  \"dimensions\": \"Dimensions if land/plot (e.g., '30x40') or null\",\n" +
    "  \"facing_direction\": \"E.g. 'North', 'East', 'West', 'South' or null\",\n" +
    "  \"rental_income\": \"Numeric monthly rental income in INR if specified (e.g., if text says 'rent 2.5 Lakhs/month' or '2.5 L rent', rental_income is 250000) or null\"\n" +
    "}\n\n" +
    "Important parsing rules:\n" +
    "1. For Price and Rental Income: Convert terms like 'Crore', 'Cr', 'Lakhs', 'L' to standard numeric integer values (e.g., '80 Lakhs' -> 8000000, '1.5 Cr' -> 15000000, '2.5 L' -> 250000).\n" +
    "2. For Location/Sublocality: Infer the sublocality / layout name (e.g. HSR Layout, Koramangala) if mentioned.\n" +
    "3. Set any fields that cannot be found or reasonably inferred to null.\n" +
    "4. Output MUST be valid JSON.";

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
    const rawResult = await generateContentRaw(contents, systemInstruction, true);
    const parsed = JSON.parse(rawResult);
    
    const rental_income = parsed.rental_income || null;
    let roi = null;
    if (rental_income && parsed.price) {
      roi = Number(((rental_income * 12) / parsed.price * 100).toFixed(2));
    }

    return {
      title: parsed.title || null,
      price: parsed.price || null,
      location: parsed.location || null,
      type: parsed.type || null,
      sublocality: parsed.sublocality || null,
      city: parsed.city || "Bangalore",
      state: parsed.state || "Karnataka",
      bedrooms: parsed.bedrooms || null,
      bathrooms: parsed.bathrooms || null,
      area_sqft: parsed.area_sqft || null,
      description: parsed.description || null,
      features: parsed.features || [],
      dimensions: parsed.dimensions || null,
      facing_direction: parsed.facing_direction || null,
      rental_income,
      roi,
      images: []
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
    "Convert terms like 'Crore', 'Cr', 'Lakhs', 'L' to standard numeric integer values for the price and rental_income fields.\n" +
    "Output MUST be valid JSON.";

  const prompt = `Current Draft:\n${JSON.stringify(currentDraft, null, 2)}\n\nUser Update Request:\n"${updateRequest}"\n\nApply these updates and return the updated JSON.`;
  const contents = [{ parts: [{ text: prompt }] }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true);
    const parsed = JSON.parse(rawResult);
    
    const updatedDraft = {
      ...currentDraft,
      ...parsed,
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
    const response = await generateText(prompt, systemInstruction);
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
  classification: "Owner" | "Seller" | "Buyer" | "Agent" | "Others";
  notes: string | null;
}

/**
 * Parses contact details from an image buffer (screenshot) and/or text block.
 */
export async function parseContactFromImageOrText(
  text?: string,
  buffer?: Buffer,
  mimeType?: string
): Promise<ParsedContactDraft> {
  const systemInstruction = 
    "You are an expert contact data parser. Extract contact details from the provided text and/or image.\n" +
    "You must return a JSON object conforming to the following structure:\n" +
    "{\n" +
    "  \"name\": \"Full name of the contact or null\",\n" +
    "  \"phone\": \"Phone number (numeric digits only, e.g. '9876543210' or with country code if visible like '919876543210') or null\",\n" +
    "  \"email\": \"Email address or null\",\n" +
    "  \"company\": \"Company name if specified or null\",\n" +
    "  \"classification\": \"Must be exactly one of: 'Owner', 'Seller', 'Buyer', 'Agent', 'Others'\",\n" +
    "  \"notes\": \"Any additional details or requirements found in the text/image (e.g. 'Interested in SJR Blue Waters, Sarjapur Road. Source: Magicbricks') or null\"\n" +
    "}\n\n" +
    "Important parsing rules:\n" +
    "1. Set any fields that cannot be found to null. For classification, choose the best fit based on context. Lead forwards showing interest in buying/renting a property must be classified as 'Buyer'.\n" +
    "2. In lead forwarding messages (e.g. 'VaishaliGaur, 917737932199 is interested in SJR Blue Waters...'), extract the lead's name ('VaishaliGaur'), phone ('917737932199'), classify as 'Buyer', and put their interest ('Interested in SJR Blue Waters, Sarjapur Road Magicbricks') in 'notes'.\n" +
    "3. Output MUST be valid JSON.";

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
    const rawResult = await generateContentRaw(contents, systemInstruction, true);
    const parsed = JSON.parse(rawResult);
    
    return {
      name: parsed.name || null,
      phone: parsed.phone || null,
      email: parsed.email || null,
      company: parsed.company || null,
      classification: parsed.classification || "Others",
      notes: parsed.notes || null
    };
  } catch (err) {
    console.error("[Gemini AI] Error parsing contact details:", err);
    throw err;
  }
}

/**
 * Updates an existing parsed contact draft JSON with a conversational update instruction.
 */
export async function updateContactDraft(
  currentDraft: ParsedContactDraft,
  updateRequest: string
): Promise<ParsedContactDraft> {
  const systemInstruction = 
    "You are an expert contact data updater. You are given a current contact draft JSON object and a natural language instruction from the user.\n" +
    "Your job is to apply the updates requested by the user and return the complete updated JSON object matching the exact structure.\n" +
    "Do not change any other fields unless requested by the user.\n" +
    "Output MUST be valid JSON.";

  const prompt = `Current Draft:\n${JSON.stringify(currentDraft, null, 2)}\n\nUser Update Request:\n"${updateRequest}"\n\nApply these updates and return the updated JSON.`;
  const contents = [{ parts: [{ text: prompt }] }];

  try {
    const rawResult = await generateContentRaw(contents, systemInstruction, true);
    const parsed = JSON.parse(rawResult);
    
    return {
      ...currentDraft,
      ...parsed
    };
  } catch (err) {
    console.error("[Gemini AI] Error updating contact draft:", err);
    return currentDraft; // Return unchanged on error
  }
}

