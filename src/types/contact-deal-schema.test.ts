import { describe, expectTypeOf, it } from 'vitest';
import type { Contact, Deal } from '@/types';
import type { Database, Json } from '@/types/database.types';

type ContactRow = Database['public']['Tables']['contacts']['Row'];
type DealRow = Database['public']['Tables']['deals']['Row'];

type ContactJsonColumns = 'areas_of_interest_geo' | 'requirement_profiles';
type ContactHydratedKeys = 'contact_notes' | 'inquired_listing_types';
type ContactWiderThanColumn = 'pref_requires_tenanted';

type DealHydratedKeys = 'property' | 'contact' | 'stage' | 'assignee';
type DealWiderThanColumn = 'co_broker_payout_total';

type SharedKeys<Hand, Row, Skipped extends PropertyKey> = Exclude<
  keyof Hand & keyof Row,
  Skipped
>;

type ContactColumnKeys = SharedKeys<
  Contact,
  ContactRow,
  ContactJsonColumns | ContactWiderThanColumn
>;

type DealColumnKeys = SharedKeys<Deal, DealRow, DealWiderThanColumn>;

describe('Contact agrees with the generated contacts row', () => {
  it('accepts every generated row apart from the columns Contact refines', () => {
    expectTypeOf<Omit<ContactRow, ContactJsonColumns>>().toExtend<
      Omit<Contact, ContactJsonColumns>
    >();
  });

  it('claims nothing about a column the generated row does not allow', () => {
    expectTypeOf<Required<Pick<Contact, ContactColumnKeys>>>().toExtend<
      Pick<ContactRow, ContactColumnKeys>
    >();
  });

  it('only widens pref_requires_tenanted beyond the column', () => {
    expectTypeOf<ContactRow['pref_requires_tenanted']>().toExtend<
      NonNullable<Contact['pref_requires_tenanted']>
    >();
  });

  it('refines only columns the schema leaves as untyped json', () => {
    expectTypeOf<ContactRow[ContactJsonColumns]>().toEqualTypeOf<Json>();
  });

  it('has no property that is neither a column nor a known hydrated field', () => {
    expectTypeOf<
      Exclude<keyof Contact, keyof ContactRow>
    >().toEqualTypeOf<ContactHydratedKeys>();
  });

  it('keeps the nullable columns nullable', () => {
    expectTypeOf<null>().toExtend<Contact['name']>();
    expectTypeOf<null>().toExtend<Contact['email']>();
    expectTypeOf<null>().toExtend<Contact['company']>();
    expectTypeOf<null>().toExtend<Contact['created_at']>();
    expectTypeOf<null>().toExtend<Contact['updated_at']>();
    expectTypeOf<null>().toExtend<Contact['phone']>();
  });

  it('keeps plain text columns plain text', () => {
    expectTypeOf<Contact['classification']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Contact['status']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Contact['lead_temp']>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});

describe('Deal agrees with the generated deals row', () => {
  it('accepts every generated row', () => {
    expectTypeOf<DealRow>().toExtend<Deal>();
  });

  it('claims nothing about a column the generated row does not allow', () => {
    expectTypeOf<Required<Pick<Deal, DealColumnKeys>>>().toExtend<
      Pick<DealRow, DealColumnKeys>
    >();
  });

  it('only widens co_broker_payout_total beyond the column', () => {
    expectTypeOf<DealRow['co_broker_payout_total']>().toExtend<
      NonNullable<Deal['co_broker_payout_total']>
    >();
  });

  it('has no property that is neither a column nor a known hydrated field', () => {
    expectTypeOf<
      Exclude<keyof Deal, keyof DealRow>
    >().toEqualTypeOf<DealHydratedKeys>();
  });

  it('keeps the nullable columns nullable', () => {
    expectTypeOf<null>().toExtend<Deal['created_at']>();
    expectTypeOf<null>().toExtend<Deal['status']>();
    expectTypeOf<null>().toExtend<Deal['notes']>();
    expectTypeOf<null>().toExtend<Deal['currency']>();
    expectTypeOf<null>().toExtend<Deal['expected_close_date']>();
  });

  it('keeps plain text columns plain text', () => {
    expectTypeOf<Deal['status']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Deal['brokerage_type']>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});
