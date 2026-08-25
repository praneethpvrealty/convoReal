export type PropertyDetailPrimaryAction =
  | { kind: 'share'; label: string; icon: 'paper-plane' }
  | { kind: 'whatsapp'; label: 'WhatsApp'; icon: 'logo-whatsapp' }
  | { kind: 'maps'; label: 'Open Maps'; icon: 'map-outline' };

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
    return { kind: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' };
  }
  if (args.hasMapLocation) {
    return { kind: 'maps', label: 'Open Maps', icon: 'map-outline' };
  }
  return null;
}
