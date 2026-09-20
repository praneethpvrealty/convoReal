import type { JourneyItem, JourneyItemSource } from '@/lib/types';

export const JOURNEY_ITEM_SOURCE_LABELS: Record<JourneyItemSource, string> = {
  manual: 'Added manually',
  whatsapp_share: 'WhatsApp share',
  chat_import: 'Chat import',
  inquiry_import: 'Inquiry import',
};

type CapturedPair = Pick<JourneyItem, 'contact' | 'property'>;

export function capturedItemTitle(
  item: CapturedPair,
  mode: 'buyer' | 'property'
): string {
  return mode === 'buyer'
    ? item.property?.title || 'Unknown property'
    : item.contact?.name || item.contact?.phone || 'Unknown contact';
}

export function capturedItemSubtitle(
  item: CapturedPair,
  mode: 'buyer' | 'property'
): string {
  const parts =
    mode === 'buyer'
      ? [item.property?.property_code, item.property?.location]
      : [item.contact?.phone, item.contact?.classification];
  return parts.filter(Boolean).join(' · ');
}
