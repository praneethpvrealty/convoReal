import type { Property } from '@/types';

type AvailabilityProperty = Pick<Property, 'property_code' | 'title'>;

function cleanInline(value: string): string {
  return value
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function propertyAvailabilityReference(
  property: AvailabilityProperty
): string {
  const code = cleanInline(property.property_code ?? '');
  const title = cleanInline(property.title ?? '');
  return [code, title].filter(Boolean).join(' — ') || 'this property';
}

export function buildPropertyAvailabilityMessage(
  property: AvailabilityProperty,
  contactName?: string | null
): string {
  const name = cleanInline(contactName ?? '');
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const reference = propertyAvailabilityReference(property);

  return [
    greeting,
    '',
    `Could you please confirm whether *${reference}* is still available?`,
    '',
    'If anything has changed, please share the latest price/rent and terms. Thank you.',
  ].join('\n');
}

export function propertyAvailabilityWhatsAppUrl(
  phone: string,
  property: AvailabilityProperty,
  contactName?: string | null
): string {
  const digits = phone.replace(/\D/g, '');
  const message = buildPropertyAvailabilityMessage(property, contactName);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
