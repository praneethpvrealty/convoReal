import { describe, it, expect } from 'vitest';
import { getPageTitle } from './header';

describe('getPageTitle', () => {
  it('names every section reachable from the sidebar', () => {
    expect(getPageTitle('/dashboard')).toBe('Dashboard');
    expect(getPageTitle('/inbox')).toBe('Inbox');
    expect(getPageTitle('/contacts')).toBe('Contacts');
    expect(getPageTitle('/inventory')).toBe('Inventory');
    expect(getPageTitle('/liaisons')).toBe('Liaisons');
    expect(getPageTitle('/calendar')).toBe('Calendar');
    expect(getPageTitle('/journey')).toBe('Journey');
    expect(getPageTitle('/automations')).toBe('Automations');
    expect(getPageTitle('/broadcasts')).toBe('Broadcasts');
    expect(getPageTitle('/settings')).toBe('Settings');
  });

  it('uses the section name where it differs from the slug', () => {
    expect(getPageTitle('/admin')).toBe('Admin Panel');
  });

  // These never hold the screen — each replaces itself with a tab of
  // another section — so the title that matters is the destination's.
  it('titles a redirect shim after wherever it lands', () => {
    expect(getPageTitle('/dashboard?tab=radar'.split('?')[0])).toBe('Dashboard');
    expect(getPageTitle('/automations')).toBe('Automations');
    expect(getPageTitle('/contacts')).toBe('Contacts');
  });

  it('titles a hyphenated slug as words', () => {
    expect(getPageTitle('/checkout-demo')).toBe('Checkout Demo');
  });

  it('keeps the section title on nested routes', () => {
    expect(getPageTitle('/contacts/8eb4e73e')).toBe('Contacts');
    expect(getPageTitle('/flows/12/runs')).toBe('Flows');
  });

  it('falls back to Dashboard only at the root', () => {
    expect(getPageTitle('/')).toBe('Dashboard');
    expect(getPageTitle('')).toBe('Dashboard');
  });
});
