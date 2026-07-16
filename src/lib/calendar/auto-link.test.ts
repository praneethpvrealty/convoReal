import { describe, it, expect } from 'vitest';
import {
  autoLinkContactProperty,
  linkedPropertyForContacts,
  linkedContactForProperty,
} from './auto-link';

const properties = [
  { id: 'prop-1', title: 'JP Nagar Plot' },
  { id: 'prop-2', title: 'Whitefield Villa' },
];

const contacts = [
  { id: 'c-1', name: 'Varun', last_inquired_property_id: 'prop-1' },
  { id: 'c-2', name: 'Snigdha', last_inquired_property_id: null },
  { id: 'c-3', name: 'Ravi', last_inquired_property_id: 'prop-missing' },
];

describe('autoLinkContactProperty', () => {
  it('fills the property from the contact inquiry', () => {
    const { contact, property } = autoLinkContactProperty(contacts[0], null, contacts, properties);
    expect(contact?.id).toBe('c-1');
    expect(property?.id).toBe('prop-1');
  });

  it('fills the contact from the property', () => {
    const { contact, property } = autoLinkContactProperty(null, properties[0], contacts, properties);
    expect(contact?.id).toBe('c-1');
    expect(property?.id).toBe('prop-1');
  });

  it('never overrides an already-resolved pair', () => {
    const { contact, property } = autoLinkContactProperty(
      contacts[1],
      properties[1],
      contacts,
      properties,
    );
    expect(contact?.id).toBe('c-2');
    expect(property?.id).toBe('prop-2');
  });

  it('ignores an inquiry pointing at an unknown property', () => {
    const { property } = autoLinkContactProperty(contacts[2], null, contacts, properties);
    expect(property).toBeNull();
  });

  it('resolves nothing when both sides are missing', () => {
    const { contact, property } = autoLinkContactProperty(null, null, contacts, properties);
    expect(contact).toBeNull();
    expect(property).toBeNull();
  });
});

describe('linkedPropertyForContacts', () => {
  it('returns the first selected contact with a known linked property', () => {
    const hit = linkedPropertyForContacts(['c-2', 'c-3', 'c-1'], contacts, properties);
    expect(hit?.contact.id).toBe('c-1');
    expect(hit?.property.id).toBe('prop-1');
  });

  it('returns null when no selected contact has a resolvable link', () => {
    expect(linkedPropertyForContacts(['c-2', 'c-3'], contacts, properties)).toBeNull();
  });
});

describe('linkedContactForProperty', () => {
  it('finds the contact who inquired about the property', () => {
    expect(linkedContactForProperty('prop-1', contacts)?.id).toBe('c-1');
  });

  it('returns null when nobody inquired', () => {
    expect(linkedContactForProperty('prop-2', contacts)).toBeNull();
  });
});
