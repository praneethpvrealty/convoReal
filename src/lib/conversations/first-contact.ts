export const LEAD_FORM_ROW_PREFIXES = [
  'web-inquiry-',
  'ai-agent-inquiry-',
  'web-requirements-',
] as const;

export const FIRST_CONTACT_FILTER = [
  'sender_type.eq.customer',
  ...LEAD_FORM_ROW_PREFIXES.map((prefix) => `message_id.like.${prefix}*`),
].join(',');
