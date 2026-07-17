/**
 * Chat-history property scan — pure matching logic shared by the
 * contact panel's "Shared Properties via WhatsApp" tab and the
 * Journey page's "Import from chat" action.
 *
 * There is no stored "share" record for WhatsApp messages, so shared
 * properties are reconstructed by scanning the agent's outbound
 * message text for three signals, strongest first:
 *   1. a showcase link carrying `property_id=<uuid>`
 *   2. the property code (e.g. "PROP-1002")
 *   3. the exact title — only when longer than 8 chars, so generic
 *      titles ("2 BHK Flat") don't false-positive on everyday chat
 */

export interface ScannableMessage {
  content_text: string | null;
  created_at: string;
}

export interface ScannableProperty {
  id: string;
  property_code?: string | null;
  title: string;
}

/**
 * Returns propertyId → timestamp of the message that mentioned it.
 * When `messages` is sorted newest-first (how both callers query),
 * the recorded timestamp is the LATEST share of that property.
 */
export function scanMessagesForProperties(
  messages: ScannableMessage[],
  properties: ScannableProperty[],
): Map<string, string> {
  const found = new Map<string, string>();
  for (const msg of messages) {
    const text = msg.content_text || "";
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const prop of properties) {
      if (found.has(prop.id)) continue;
      const hasIdLink = text.includes(`property_id=${prop.id}`);
      const hasCode =
        !!prop.property_code && text.includes(prop.property_code);
      const cleanTitle = prop.title.trim();
      const hasTitle =
        cleanTitle.length > 8 && lower.includes(cleanTitle.toLowerCase());
      if (hasIdLink || hasCode || hasTitle) {
        found.set(prop.id, msg.created_at);
      }
    }
  }
  return found;
}
