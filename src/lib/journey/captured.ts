import type { JourneyItem, JourneyItemSource } from '@/types';

export const JOURNEY_ITEM_SOURCE_LABELS: Record<JourneyItemSource, string> = {
  manual: 'Added manually',
  whatsapp_share: 'WhatsApp share',
  chat_import: 'Chat import',
  inquiry_import: 'Inquiry import',
};

export function capturedItemTitle(
  item: Pick<JourneyItem, 'contact' | 'property'>,
  mode: 'buyer' | 'property'
): string {
  return mode === 'buyer'
    ? item.property?.title || 'Unknown property'
    : item.contact?.name || item.contact?.phone || 'Unknown contact';
}
