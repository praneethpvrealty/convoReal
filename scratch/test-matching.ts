import { getMatchingContacts } from '../src/lib/matching';
import type { Contact, Property } from '../src/types';

const contact: Contact = {
  id: 'c-1',
  user_id: 'u-1',
  phone: '+919876543210',
  name: 'Test Contact',
  classification: 'Buyer',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  min_roi: null,
  no_budget: true
};

const property: Property = {
  id: 'p-1',
  account_id: 'a-1',
  user_id: 'u-1',
  title: 'Test Property',
  price: 10000000,
  location: 'HSR Layout, Bangalore',
  type: 'Commercial Office',
  status: 'Available',
  is_published: true,
  features: [],
  images: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  roi: 4
};

console.log("Input Contact:", contact);
console.log("Input Property:", property);

const results = getMatchingContacts(property, [contact]);
console.log("Results length:", results.length);
console.log("Results details:", JSON.stringify(results, null, 2));
