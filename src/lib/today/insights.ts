export interface RangeInsights {
  /** Conversations opened in the range — new WhatsApp inquiries. */
  newInquiries: number;
  /** Contacts created in the range. */
  newContacts: number;
  /** Inbound customer messages in the range. */
  messagesReceived: number;
  /** Outbound messages in the range (agent + bot). */
  messagesSent: number;
  /** Conversations with ≥1 customer message in the range. */
  inboundConversations: number;
  /** Of those, how many got an outbound reply after the customer's
   *  first message of the range. */
  respondedConversations: number;
  /** Showcase link opens (Pulse `open` events) in the range. */
  showcaseOpens: number;
}

export interface TodayInsightsRow {
  new_inquiries: number | string | null;
  new_contacts: number | string | null;
  messages_received: number | string | null;
  messages_sent: number | string | null;
  inbound_conversations: number | string | null;
  responded_conversations: number | string | null;
  showcase_opens: number | string | null;
}

function count(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function toRangeInsights(
  row: TodayInsightsRow | null | undefined
): RangeInsights {
  return {
    newInquiries: count(row?.new_inquiries),
    newContacts: count(row?.new_contacts),
    messagesReceived: count(row?.messages_received),
    messagesSent: count(row?.messages_sent),
    inboundConversations: count(row?.inbound_conversations),
    respondedConversations: count(row?.responded_conversations),
    showcaseOpens: count(row?.showcase_opens),
  };
}
