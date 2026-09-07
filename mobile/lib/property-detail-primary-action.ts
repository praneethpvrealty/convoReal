export type PropertyDetailPrimaryAction =
  | { kind: 'share'; label: string; icon: 'paper-plane' }
  | {
      kind: 'availability';
      label: 'Check availability';
      icon: 'logo-whatsapp';
    }
  | { kind: 'maps'; label: 'Open Maps'; icon: 'map-outline' };

type AvailabilityProperty = {
  property_code?: string | null;
  title?: string | null;
};

// `@shared/` is a types-only alias in the mobile bundle, so keep this tiny
// runtime helper local and in sync with the web implementation.
function cleanInline(value: string): string {
  return value
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function propertyAvailabilityReference(property: AvailabilityProperty): string {
  const code = cleanInline(property.property_code ?? '');
  const title = cleanInline(property.title ?? '');
  return [code, title].filter(Boolean).join(' — ') || 'this property';
}

export function propertyAvailabilityWhatsAppUrl(
  phone: string,
  property: AvailabilityProperty,
  contactName?: string | null
): string {
  const name = cleanInline(contactName ?? '');
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const reference = propertyAvailabilityReference(property);
  const message = [
    greeting,
    '',
    `Could you please confirm whether *${reference}* is still available?`,
    '',
    'If anything has changed, please share the latest price/rent and terms. Thank you.',
  ].join('\n');

  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

export function propertyDetailPrimaryAction(args: {
  selectedCount: number;
  ownerPhone: boolean;
  hasMapLocation: boolean;
}): PropertyDetailPrimaryAction | null {
  if (args.selectedCount > 0) {
    return {
      kind: 'share',
      label: `Share with ${args.selectedCount} contact${args.selectedCount === 1 ? '' : 's'}`,
      icon: 'paper-plane',
    };
  }
  if (args.ownerPhone) {
    return {
      kind: 'availability',
      label: 'Check availability',
      icon: 'logo-whatsapp',
    };
  }
  if (args.hasMapLocation) {
    return { kind: 'maps', label: 'Open Maps', icon: 'map-outline' };
  }
  return null;
}
