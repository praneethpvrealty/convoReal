export const CONTACT_CLASSIFICATIONS = [
  'Owner',
  'Seller',
  'Buyer',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
] as const;

export type ContactClassification = (typeof CONTACT_CLASSIFICATIONS)[number];

export const DEFAULT_CONTACT_CLASSIFICATION: ContactClassification = 'Others';
