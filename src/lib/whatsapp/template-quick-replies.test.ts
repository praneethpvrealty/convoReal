import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseTemplateQuickReply,
  lastSharedPropertyId,
  buildFullListMessage,
  SEND_MORE_DETAILS_BUTTON,
  INVENTORY_FULL_LIST_BUTTON,
  INVENTORY_SITE_VISIT_BUTTON,
} from './template-quick-replies';
import { buildPropertyAlertTemplatePayload } from './property-alert-template';
import { buildPropertyEnquiryPhotosTemplatePayload } from './property-enquiry-photos-template';
import { buildInventoryUpdateTemplatePayload } from './inventory-update-template';

function sharesDb(propertyId: string | null): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return {
                            maybeSingle: () =>
                              Promise.resolve({
                                data: propertyId ? { property_id: propertyId } : null,
                                error: null,
                              }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function propertiesDb(rows: unknown[]): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { subdomain: null }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: rows, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('parseTemplateQuickReply', () => {
  it('recognises each template button', () => {
    expect(parseTemplateQuickReply(SEND_MORE_DETAILS_BUTTON)).toBe('property_details');
    expect(parseTemplateQuickReply(INVENTORY_FULL_LIST_BUTTON)).toBe('inventory_full_list');
    expect(parseTemplateQuickReply(INVENTORY_SITE_VISIT_BUTTON)).toBe('site_visit');
  });

  it('matches a typed reply the same as a tap', () => {
    expect(parseTemplateQuickReply('  send more details  ')).toBe('property_details');
  });

  it('ignores ordinary messages and long text', () => {
    expect(parseTemplateQuickReply('Hi, is this still available?')).toBeNull();
    expect(parseTemplateQuickReply(null)).toBeNull();
    expect(
      parseTemplateQuickReply(`${SEND_MORE_DETAILS_BUTTON} about the plot in Hoodi please`),
    ).toBeNull();
  });

  it('stays in sync with the button texts the templates actually carry', () => {
    // A button renamed in a template without updating the parser is a
    // dead end again — exactly the bug this module was added to fix.
    const texts = [
      ...(buildPropertyAlertTemplatePayload('https://x.com').buttons ?? []),
      ...(buildPropertyEnquiryPhotosTemplatePayload('https://x.com').buttons ?? []),
      ...(buildInventoryUpdateTemplatePayload('https://x.com').buttons ?? []),
    ]
      .filter((b) => b.type === 'QUICK_REPLY')
      .map((b) => b.text);
    for (const text of texts) {
      expect(parseTemplateQuickReply(text)).not.toBeNull();
    }
  });
});

describe('lastSharedPropertyId', () => {
  it('returns the newest share for this contact', async () => {
    expect(await lastSharedPropertyId(sharesDb('prop-1'), 'acct', 'contact')).toBe('prop-1');
  });

  it('returns null when the contact has no recorded share', async () => {
    expect(await lastSharedPropertyId(sharesDb(null), 'acct', 'contact')).toBeNull();
  });
});

describe('buildFullListMessage', () => {
  it('returns null when there is nothing published to list', async () => {
    expect(await buildFullListMessage(propertiesDb([]), 'acct')).toBeNull();
  });

  it('summarises the published inventory', async () => {
    const msg = await buildFullListMessage(
      propertiesDb([
        {
          id: 'p1',
          title: 'Plot in Hoodi',
          type: 'Residential Land/ Plot',
          price: 5000000,
          location: 'Hoodi',
        },
      ]),
      'acct',
    );
    expect(msg).toContain('Plot in Hoodi');
  });
});
