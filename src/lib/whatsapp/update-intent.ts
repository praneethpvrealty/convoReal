export interface UpdateIntent {
  type: 'property' | 'contact' | null;
  identifier?: string;
}

// Match patterns like "update property PROP-1018", "Update property - prop-1050",
// "edit listing: prop 1050", "update prop-1018", "update contact", "update".
// Shared between the webhook update flow and the owner chatbot, which must
// yield these messages instead of drafting a new listing from them.
export function parseUpdateIntent(text: string): UpdateIntent | null {
  const cleaned = text.trim().toLowerCase();

  const propertyWithCode = /\b(?:update|edit)\s+(?:(?:property|listing)\s*[-:#]?\s*)?prop\s*-?\s*(\d+)\b/i.exec(cleaned);
  if (propertyWithCode) {
    return { type: 'property', identifier: `PROP-${propertyWithCode[1]}` };
  }

  const propertyGeneric = /\b(?:update|edit)\s+(?:property|listing)\b/i.test(cleaned);
  if (propertyGeneric) {
    return { type: 'property' };
  }

  const contactUpdate = /\b(?:update|edit)\s+contact\b/i.test(cleaned);
  if (contactUpdate) {
    return { type: 'contact' };
  }

  // Generic "update" might default to contact update for the current conversation
  const genericUpdate = /^update$/i.test(cleaned);
  if (genericUpdate) {
    return { type: 'contact' };
  }

  return null;
}
