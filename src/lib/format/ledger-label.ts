export interface LedgerLabelSource {
  type: string;
  ai_feature?: string | null;
  description?: string | null;
}

export const FEATURE_LABELS: Record<string, string> = {
  property_description: 'Property description',
  image_enhance: 'Photo enhancement',
  chatbot_classify: 'Chatbot message triage',
  chatbot_auto_reply: 'Chatbot auto-reply',
  contact_parse: 'Contact card read',
  listing_parse: 'Listing read',
  greetings_generate: 'Greeting card',
  ad_copy: 'Ad copy',
  share_email: 'Share email',
  event_parse: 'Event from text',
  voice_transcribe: 'Voice note transcription',
  voice_event_parse: 'Event from voice note',
  image_event_parse: 'Event from image',
  call_analysis: 'Call analysis',
  call_recording_analysis: 'Call recording analysis',
  action_item_events: 'Action items to events',
  listing_video: 'Listing video',
  voice_campaign_call: 'Voice campaign call',
  voice_campaign_call_byo: 'Voice campaign call (own provider)',
  audio_announcement: 'Voice announcement',
  reminder_audio: 'Voice reminder',
  conversation_sweep_thread: 'Daily conversation review',
  deal_document_extract: 'Deal document read',
  guidance_value_lookup: 'Guidance value lookup',
  match_unlock: 'Match unlock',
};

const MACHINE_DESCRIPTION = /^(?:refund:|retry:|[a-z0-9_]+ burn$)/;

function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function featureLabel(feature: string | null): string | null {
  if (!feature) return null;
  return FEATURE_LABELS[feature] ?? humanize(feature);
}

export function ledgerLabel(tx: LedgerLabelSource): string {
  const description = tx.description?.trim() ?? '';
  if (description && !MACHINE_DESCRIPTION.test(description)) return description;

  const feature = featureLabel(tx.ai_feature ?? null);
  if (tx.type === 'refund') return feature ? `Refund — ${feature}` : 'Refund';
  if (tx.type === 'ai_burn') return feature ?? 'AI usage';
  return humanize(tx.type);
}
