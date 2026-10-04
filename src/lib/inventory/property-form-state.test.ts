import { describe, expect, it } from 'vitest';

import type { Contact, Property } from '@/types';

import {
  buildPropertyPayload,
  emptyPropertyFormValues,
  propertyFormReducer,
  propertyToFormValues,
  validatePropertyForm,
  type PropertyFormValues,
} from './property-form-state';

const saleFlat = {
  id: 'prop-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  property_code: 'PROP-1001',
  title: 'Prestige Lakeside 3BHK',
  description: 'Corner unit facing the lake',
  price: 12000000,
  listing_type: 'Sale',
  location: 'Tower B, Whitefield, Bengaluru, Karnataka',
  sublocality: 'Whitefield',
  city: 'Bengaluru',
  state: 'Karnataka',
  project: 'Prestige Lakeside',
  type: 'Flat/ Apartment',
  status: 'Available',
  bedrooms: 3,
  bathrooms: 3,
  area_sqft: 1650,
  area_unit: 'Sq.Ft.',
  super_built_area: 1900,
  furnishing: 'Semi-Furnished',
  floor_number: 4,
  total_floors: 12,
  balconies: 2,
  flooring: 'Vitrified',
  power_backup: 'Full',
  facing_direction: 'East',
  khata_epid: 'EP-123',
  khata_form: 'A',
  year_built: 2018,
  possession_date: '2026-12-01',
  road_width_unit: 'Feet',
  features: ['Gym', 'Swimming Pool'],
  nearby_highlights: ['Metro Station'],
  images: ['property-images/a.jpg', 'property-images/b.jpg'],
  private_images: ['property-images-private/c.jpg'],
  documents: [
    JSON.stringify({
      url: 'property-documents/deed.pdf',
      title: 'Sale deed',
    }),
  ],
  is_published: true,
  owner_contact_id: 'contact-owner',
  listing_source: 'agent',
  google_map_link: 'https://maps.google.com/?q=12.97,77.75',
  location_privacy: 'exact',
  showcase_visibility: null,
  notes: 'Keys with the guard',
  tags: ['hot'],
  latitude: 12.97,
  longitude: 77.75,
  locality_place_id: 'place-whitefield',
  locality_canonical: 'Whitefield',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
} as unknown as Property;

function validValues(
  overrides: Partial<PropertyFormValues> = {}
): PropertyFormValues {
  return {
    ...emptyPropertyFormValues(null),
    title: 'Prestige Lakeside 3BHK',
    price: '12000000',
    sublocality: 'Whitefield',
    city: 'Bengaluru',
    stateVal: 'Karnataka',
    ...overrides,
  };
}

describe('propertyToFormValues', () => {
  it('hydrates an existing Sale flat into the form drafts', () => {
    const contacts = [
      { id: 'c-1', last_inquired_property_id: 'prop-1' },
      { id: 'c-2', last_inquired_property_id: 'prop-9' },
    ] as unknown as Contact[];

    const values = propertyToFormValues(saleFlat, contacts);

    expect(values).toMatchObject({
      title: 'Prestige Lakeside 3BHK',
      description: 'Corner unit facing the lake',
      price: '12000000',
      listingType: 'Sale',
      rentPerMonth: '',
      jvStructure: 'Revenue Share',
      type: 'Flat/ Apartment',
      status: 'Available',
      bedrooms: '3',
      bathrooms: '3',
      areaSqft: '1650',
      superBuiltArea: '1900',
      floorNumber: '4',
      totalFloors: '12',
      balconies: '2',
      yearBuilt: '2018',
      khataForm: 'A',
      possessionDate: '2026-12-01',
      address: 'Tower B',
      sublocality: 'Whitefield',
      city: 'Bengaluru',
      stateVal: 'Karnataka',
      searchQuery: 'Prestige Lakeside',
      images: ['property-images/a.jpg', 'property-images/b.jpg'],
      privateImages: ['property-images-private/c.jpg'],
      defaultImageIndex: 0,
      videoRemoved: false,
      documents: [{ url: 'property-documents/deed.pdf', title: 'Sale deed' }],
      listingSource: 'agent',
      locationPrivacy: 'exact',
      showcaseVisibility: '',
      geoPick: {
        latitude: 12.97,
        longitude: 77.75,
        place_id: 'place-whitefield',
        canonical: 'Whitefield',
      },
      interestedContactIds: ['c-1'],
      floorTenancies: [],
      floorPlans: [],
    });
  });

  it('hydrates a Rent listing into its rent fields', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        listing_type: 'Rent',
        price: 45000,
        rent_per_month: 45000,
        maintenance: 5000,
        advance: 200000,
        gst: null,
      },
      []
    );
    expect(values).toMatchObject({
      listingType: 'Rent',
      price: '45000',
      rentPerMonth: '45000',
      maintenance: '5000',
      advance: '200000',
      gst: '',
    });
  });

  it('hydrates JV/JD deal terms', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        type: 'Residential Land',
        listing_type: 'JV/JD',
        price: 50000000,
        jv_structure: 'Area Share',
        owner_share_percent: 40,
        builder_share_percent: 60,
        goodwill_amount: 2000000,
        advance: 1000000,
      },
      []
    );
    expect(values).toMatchObject({
      listingType: 'JV/JD',
      price: '50000000',
      jvStructure: 'Area Share',
      ownerSharePercent: '40',
      builderSharePercent: '60',
      goodwillAmount: '2000000',
      advance: '1000000',
    });
  });

  it('hydrates Built to Suit lease terms', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        type: 'Commercial Building',
        listing_type: 'Built to Suit',
        price: 250000,
        rent_per_month: 250000,
        bts_lease_years: 9,
        bts_lock_in_years: 3,
        bts_escalation_percent: 5,
      },
      []
    );
    expect(values).toMatchObject({
      listingType: 'Built to Suit',
      rentPerMonth: '250000',
      btsLeaseYears: '9',
      btsLockInYears: '3',
      btsEscalationPercent: '5',
    });
  });

  it('splits plot dimensions into frontage and depth', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        type: 'Residential Plot',
        dimensions: '30x40',
        land_area: 1200,
      },
      []
    );
    expect(values).toMatchObject({
      dimensions: '30x40',
      frontage: '30',
      depth: '40',
      landArea: '1200',
    });
  });

  it('recovers the address from a location whose sublocality spans segments and repeats', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        project: '',
        sublocality: 'Agara, HSR Layout',
        location:
          '12th Main, Agara, HSR Layout, 12th Main, Agara, HSR Layout, Bengaluru, Karnataka',
      },
      []
    );
    expect(values.address).toBe('12th Main');
    expect(values.searchQuery).toBe('Agara, HSR Layout');
  });

  it('reads legacy plain-string documents and falls back to interested_contacts', () => {
    const values = propertyToFormValues(
      {
        ...saleFlat,
        documents: ['property-documents/plan.pdf'],
        interested_contacts: [{ id: 'c-7' }] as unknown as Contact[],
      },
      []
    );
    expect(values.documents).toEqual([
      { url: 'property-documents/plan.pdf', title: '' },
    ]);
    expect(values.interestedContactIds).toEqual(['c-7']);
  });
});

describe('emptyPropertyFormValues', () => {
  it('starts a new listing with the default owner and one blank photo and document row', () => {
    const values = emptyPropertyFormValues('contact-9');
    expect(values).toMatchObject({
      ownerContactId: 'contact-9',
      listingType: 'Sale',
      type: 'Flat/ Apartment',
      status: 'Available',
      areaUnit: 'Sq.Ft.',
      roadWidthUnit: 'Feet',
      images: [''],
      documents: [{ url: '', title: '' }],
      listingSource: 'owner',
      geoPick: null,
    });
  });
});

describe('buildPropertyPayload', () => {
  it('reproduces the persisted fields of the property it was hydrated from', () => {
    const payload = buildPropertyPayload(propertyToFormValues(saleFlat, []), {
      isEdit: true,
    });
    expect(payload).toMatchObject({
      title: saleFlat.title,
      description: saleFlat.description,
      price: 12000000,
      listing_type: 'Sale',
      rent_per_month: null,
      maintenance: null,
      advance: null,
      gst: null,
      jv_structure: null,
      owner_share_percent: null,
      bts_lease_years: null,
      location: saleFlat.location,
      type: 'Flat/ Apartment',
      status: 'Available',
      sold_price: null,
      seller_final_price: null,
      bedrooms: 3,
      bathrooms: 3,
      furnishing: 'Semi-Furnished',
      possession_date: '2026-12-01',
      floor_number: 4,
      total_floors: 12,
      balconies: 2,
      flooring: 'Vitrified',
      power_backup: 'Full',
      area_sqft: 1650,
      area_unit: 'Sq.Ft.',
      land_area: null,
      land_area_unit: null,
      super_built_area: 1900,
      sublocality: 'Whitefield',
      city: 'Bengaluru',
      state: 'Karnataka',
      project: 'Prestige Lakeside',
      land_zone: null,
      dimensions: null,
      road_width: null,
      road_width_unit: 'Feet',
      facing_direction: 'East',
      khata_epid: 'EP-123',
      khata_form: 'A',
      year_built: 2018,
      features: saleFlat.features,
      nearby_highlights: saleFlat.nearby_highlights,
      images: saleFlat.images,
      documents: saleFlat.documents,
      is_published: true,
      owner_contact_id: 'contact-owner',
      listing_source: 'agent',
      google_map_link: saleFlat.google_map_link,
      location_privacy: 'exact',
      showcase_visibility: null,
      notes: 'Keys with the guard',
      tags: ['hot'],
      rental_income: null,
      floor_tenancies: [],
      floor_plans: [],
      latitude: 12.97,
      longitude: 77.75,
      locality_place_id: 'place-whitefield',
      locality_canonical: 'Whitefield',
      interested_contact_ids: [],
    });
    expect(typeof payload.updated_at).toBe('string');
  });

  it('prices a Rent listing from its monthly rent', () => {
    const payload = buildPropertyPayload(
      validValues({
        listingType: 'Rent',
        price: '',
        rentPerMonth: '45000',
        maintenance: '5000',
        advance: '',
        gst: '1800',
      }),
      { isEdit: true }
    );
    expect(payload).toMatchObject({
      price: 45000,
      rent_per_month: 45000,
      maintenance: 5000,
      advance: null,
      gst: 1800,
    });
  });

  it('forces a new listing to Available and moves the default photo first', () => {
    const payload = buildPropertyPayload(
      validValues({
        status: 'Sold',
        soldPrice: '9000000',
        images: [' a.jpg ', '', 'b.jpg', 'c.jpg'],
        defaultImageIndex: 2,
      }),
      { isEdit: false }
    );
    expect(payload.status).toBe('Available');
    expect(payload.sold_price).toBe(9000000);
    expect(payload.images).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);
  });

  it('joins a plot frontage and depth and falls back to the search query for the sublocality', () => {
    const payload = buildPropertyPayload(
      validValues({
        type: 'Residential Plot',
        sublocality: '',
        searchQuery: ' Sarjapur Road ',
        landArea: '1200',
        frontage: '30',
        depth: '40',
        areaSqft: '999',
        yearBuilt: '2010',
      }),
      { isEdit: true }
    );
    expect(payload).toMatchObject({
      sublocality: 'Sarjapur Road',
      location: 'Sarjapur Road, Bengaluru, Karnataka',
      dimensions: '30x40',
      land_area: 1200,
      area_sqft: null,
      area_unit: null,
      year_built: null,
    });
  });
});

describe('validatePropertyForm', () => {
  it('requires a title first', () => {
    expect(validatePropertyForm(emptyPropertyFormValues(null))).toBe(
      'Title is required'
    );
  });

  it('requires a sale price', () => {
    expect(validatePropertyForm(validValues({ price: '' }))).toBe(
      'Price must be a valid non-negative number'
    );
  });

  it('requires the monthly rent for Rent and Built to Suit', () => {
    expect(
      validatePropertyForm(validValues({ listingType: 'Rent', price: '' }))
    ).toBe('Rent per month must be a valid non-negative number');
    expect(
      validatePropertyForm(
        validValues({ listingType: 'Built to Suit', price: '' })
      )
    ).toBe('Expected rent must be a valid non-negative number');
  });

  it('requires JV/JD shares to add up to 100', () => {
    expect(
      validatePropertyForm(
        validValues({
          listingType: 'JV/JD',
          ownerSharePercent: '40',
          builderSharePercent: '50',
        })
      )
    ).toBe('Owner share % and Builder share % must add up to 100');
  });

  it('requires a locality, city and state', () => {
    expect(
      validatePropertyForm(validValues({ sublocality: '', searchQuery: '' }))
    ).toBe('Location search query, City, and State are required');
    expect(
      validatePropertyForm(
        validValues({ sublocality: '', searchQuery: 'Whitefield' })
      )
    ).toBeNull();
  });

  it('requires a positive land area for land', () => {
    expect(
      validatePropertyForm(
        validValues({ type: 'Residential Plot', landArea: '' })
      )
    ).toBe('Land Area is required and must be a valid positive number');
  });

  it('passes a complete listing', () => {
    expect(validatePropertyForm(validValues())).toBeNull();
  });
});

describe('propertyFormReducer', () => {
  it('sets a field from a value or an updater', () => {
    const start = emptyPropertyFormValues(null);
    const titled = propertyFormReducer(start, {
      type: 'set',
      field: 'title',
      value: 'Villa',
    });
    expect(titled.title).toBe('Villa');
    expect(start.title).toBe('');

    const withFeature = propertyFormReducer(titled, {
      type: 'set',
      field: 'features',
      value: (prev) => [...prev, 'Gym'],
    });
    expect(withFeature.features).toEqual(['Gym']);
    expect(withFeature.title).toBe('Villa');
  });

  it('keeps the same state when a field is set to its current value', () => {
    const start = emptyPropertyFormValues(null);
    expect(
      propertyFormReducer(start, { type: 'set', field: 'title', value: '' })
    ).toBe(start);
  });

  it('replaces every value on reset', () => {
    const edited = propertyFormReducer(emptyPropertyFormValues(null), {
      type: 'set',
      field: 'possessionDate',
      value: '2026-12-01',
    });
    const next = emptyPropertyFormValues('contact-1');
    expect(propertyFormReducer(edited, { type: 'reset', values: next })).toBe(
      next
    );
  });
});
