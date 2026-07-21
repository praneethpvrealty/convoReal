// Classifies an inbound WhatsApp text as a request to enter a
// property/contact update session. Governs who can hijack the
// conversation into an update flow, so the matching must be tight:
// only an explicit "update ..." verb triggers it, and a bare "update"
// defaults to updating the conversation's current contact.

export function parseUpdateIntent(text: string): {
  type: 'property' | 'contact' | null
  identifier?: string
} | null {
  const cleaned = text.trim().toLowerCase()

  // Match patterns like "update property PROP-1018", "update contact", "update PROP-1018"
  const propertyWithCode = /\bupdate\s+(?:property\s+)?(prop-?\d+)\b/i.exec(cleaned)
  if (propertyWithCode) {
    return { type: 'property', identifier: propertyWithCode[1].toUpperCase() }
  }

  const propertyGeneric = /\bupdate\s+property\b/i.test(cleaned)
  if (propertyGeneric) {
    return { type: 'property' }
  }

  const contactUpdate = /\bupdate\s+contact\b/i.test(cleaned)
  if (contactUpdate) {
    return { type: 'contact' }
  }

  // Generic "update" might default to contact update for the current conversation
  const genericUpdate = /^update$/i.test(cleaned)
  if (genericUpdate) {
    return { type: 'contact' }
  }

  return null
}
