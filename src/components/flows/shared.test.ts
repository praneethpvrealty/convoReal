import { describe, expect, it } from 'vitest';
import { ADD_NODE_TYPES, NODE_META, summarizeNode } from './shared';
import { defaultConfigFor } from './flow-editor-state';

describe('ADD_NODE_TYPES', () => {
  it('offers every node type in the add menus, including the property nodes', () => {
    expect([...ADD_NODE_TYPES].sort()).toEqual(Object.keys(NODE_META).sort());
    expect(ADD_NODE_TYPES).toContain('send_property_listings');
    expect(ADD_NODE_TYPES).toContain('start_property_intake');
  });

  it('gives every offered type a default config', () => {
    for (const type of ADD_NODE_TYPES) {
      expect(typeof defaultConfigFor(type)).toBe('object');
    }
  });
});

describe('summarizeNode for property listings', () => {
  it('names the multi-type filter when one is set', () => {
    expect(
      summarizeNode({
        node_key: 'l',
        node_type: 'send_property_listings',
        config: {
          filter_types: ['Villa', 'Plot'],
          filter_listing_type: 'Sale',
        },
      })
    ).toBe('Listings · Villa, Plot / Sale');
  });
});
