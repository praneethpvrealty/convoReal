import type { FloorPlanDraft } from '@/components/inventory/floor-plans-editor';
import {
  hasBedsBaths as typeHasBedsBaths,
  hasCommercialBuildingFields as typeHasCommercialBuildingFields,
  hasTotalFloors,
  hasUnitFloor,
  isApartmentType,
  isLandType,
  isRawLandType,
} from '@/lib/inventory/property-options';
import type { Contact, Property } from '@/types';

export type PropertyFormListingType =
  'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit';

export type PropertyFormJvStructure = 'Revenue Share' | 'Area Share' | 'Hybrid';

// Floor-wise tenancy (rent roll) for pre-leased commercial buildings
// under sale — string drafts of lib/inventory/floor-tenancies rows.
export interface FloorTenancyDraft {
  floor: string;
  tenant_name: string;
  area_sqft: string;
  monthly_rent: string;
  advance: string;
  lease_start: string;
  lease_end: string;
  lock_in_months: string;
  maintenance: string;
  notes: string;
  floor_plan: string;
}

export const emptyFloorTenancy: FloorTenancyDraft = {
  floor: '',
  tenant_name: '',
  area_sqft: '',
  monthly_rent: '',
  advance: '',
  lease_start: '',
  lease_end: '',
  lock_in_months: '',
  maintenance: '',
  notes: '',
  floor_plan: '',
};

export interface PropertyFormGeoPick {
  latitude: number;
  longitude: number;
  place_id: string;
  canonical: string;
}

export interface PropertyFormDocument {
  url: string;
  title: string;
}

export interface PropertyFormValues {
  title: string;
  description: string;
  price: string; // Whole rupee amount (INR)
  // Final sale price, captured only when status is Sold. Optional —
  // feeds the anonymized market-stats aggregation, never shown to buyers.
  soldPrice: string;
  // What the seller will actually accept, as a total and/or a per-Sq.Ft.
  // rate. Distinct from `price`, which is the advertised figure — this
  // one never reaches a public surface.
  sellerFinalPrice: string;
  sellerFinalPricePerSqft: string;
  listingType: PropertyFormListingType;
  rentPerMonth: string;
  maintenance: string;
  advance: string;
  gst: string;
  // JV/JD deal terms
  jvStructure: PropertyFormJvStructure;
  ownerSharePercent: string;
  builderSharePercent: string;
  goodwillAmount: string;
  // Built to Suit lease terms
  btsLeaseYears: string;
  btsLockInYears: string;
  btsEscalationPercent: string;
  type: string;
  status: string;
  bedrooms: string;
  bathrooms: string;
  areaSqft: string;
  areaUnit: string;
  landArea: string;
  landAreaUnit: string;
  superBuiltArea: string;
  frontage: string;
  depth: string;
  sublocality: string;
  city: string;
  stateVal: string;
  address: string;
  // Coordinates of the picked place. Declared with the rest of the
  // location fields because the match preview reads them too, well
  // above the autocomplete handlers that set them.
  geoPick: PropertyFormGeoPick | null;
  project: string;
  landZone: string;
  idealFor: string;
  // Land/JV deal notes — prefill source for the "Share via Email" draft
  ownershipStatus: string;
  landUseZoning: string;
  legalStatus: string;
  conversionType: string;
  dealRemarks: string;
  dimensions: string;
  roadWidth: string;
  roadWidthUnit: string;
  facingDirection: string;
  khataEpid: string;
  khataForm: string;
  yearBuilt: string;
  furnishing: string;
  possessionDate: string;
  floorNumber: string;
  totalFloors: string;
  balconies: string;
  flooring: string;
  powerBackup: string;
  isPublished: boolean;
  features: string[];
  nearbyHighlights: string[];
  images: string[];
  privateImages: string[];
  defaultImageIndex: number;
  videoRemoved: boolean;
  documents: PropertyFormDocument[];
  googleMapLink: string;
  locationPrivacy: '' | 'exact' | 'locality';
  showcaseVisibility: '' | 'teaser';
  notes: string;
  tags: string[];
  rentalIncome: string;
  floorTenancies: FloorTenancyDraft[];
  floorPlans: FloorPlanDraft[];
  ownerContactId: string | null;
  listingSource: 'owner' | 'agent';
  interestedContactIds: string[];
  searchQuery: string;
}

export type PropertyFormField = keyof PropertyFormValues;

export type PropertyFormUpdate<K extends PropertyFormField> =
  | PropertyFormValues[K]
  | ((prev: PropertyFormValues[K]) => PropertyFormValues[K]);

export type PropertyFormAction =
  | {
      [K in PropertyFormField]: {
        type: 'set';
        field: K;
        value: PropertyFormUpdate<K>;
      };
    }[PropertyFormField]
  | { type: 'reset'; values: PropertyFormValues };

export function emptyPropertyFormValues(
  defaultOwnerId: string | null
): PropertyFormValues {
  return {
    title: '',
    description: '',
    price: '',
    soldPrice: '',
    sellerFinalPrice: '',
    sellerFinalPricePerSqft: '',
    listingType: 'Sale',
    rentPerMonth: '',
    maintenance: '',
    advance: '',
    gst: '',
    jvStructure: 'Revenue Share',
    ownerSharePercent: '',
    builderSharePercent: '',
    goodwillAmount: '',
    btsLeaseYears: '',
    btsLockInYears: '',
    btsEscalationPercent: '',
    rentalIncome: '',
    floorTenancies: [],
    floorPlans: [],
    type: 'Flat/ Apartment',
    status: 'Available',
    bedrooms: '',
    bathrooms: '',
    areaSqft: '',
    areaUnit: 'Sq.Ft.',
    landArea: '',
    landAreaUnit: 'Sq.Ft.',
    superBuiltArea: '',
    sublocality: '',
    city: '',
    stateVal: '',
    address: '',
    project: '',
    landZone: '',
    idealFor: '',
    ownershipStatus: '',
    landUseZoning: '',
    legalStatus: '',
    conversionType: '',
    dealRemarks: '',
    dimensions: '',
    frontage: '',
    depth: '',
    roadWidth: '',
    roadWidthUnit: 'Feet',
    facingDirection: '',
    khataEpid: '',
    khataForm: '',
    yearBuilt: '',
    furnishing: '',
    possessionDate: '',
    floorNumber: '',
    totalFloors: '',
    balconies: '',
    flooring: '',
    powerBackup: '',
    isPublished: false,
    features: [],
    nearbyHighlights: [],
    images: [''],
    privateImages: [],
    defaultImageIndex: 0,
    videoRemoved: false,
    documents: [{ url: '', title: '' }],
    searchQuery: '',
    googleMapLink: '',
    locationPrivacy: '',
    showcaseVisibility: '',
    notes: '',
    tags: [],
    geoPick: null,
    ownerContactId: defaultOwnerId ?? null,
    listingSource: 'owner',
    interestedContactIds: [],
  };
}

export function propertyToFormValues(
  property: Property,
  contacts: Contact[]
): PropertyFormValues {
  const dims = property.dimensions ?? '';
  let frontage = '';
  let depth = '';
  if (dims && dims.includes('x')) {
    const parts = dims.split('x');
    if (parts.length === 2) {
      frontage = parts[0].trim();
      depth = parts[1].trim();
    }
  }

  const dbDocs =
    property.documents && property.documents.length > 0
      ? property.documents
      : [];
  const parsed = dbDocs.map((doc: unknown) => {
    if (typeof doc === 'string') {
      if (doc.trim().startsWith('{')) {
        try {
          const parsedDoc = JSON.parse(doc);
          return {
            url: (parsedDoc?.url as string) || '',
            title: (parsedDoc?.title as string) || '',
          };
        } catch {
          // fall through
        }
      }
      return { url: doc, title: '' };
    }
    const typedDoc = doc as { url?: string; title?: string } | null;
    return { url: typedDoc?.url || '', title: typedDoc?.title || '' };
  });

  let interestedContactIds: string[];
  if (contacts && contacts.length > 0) {
    interestedContactIds = contacts
      .filter((c) => c.last_inquired_property_id === property.id)
      .map((c) => c.id);
  } else if (property.interested_contacts) {
    interestedContactIds = property.interested_contacts.map((c) => c.id);
  } else {
    interestedContactIds = [];
  }

  // Recover `address` from the stored location by removing the
  // parts that get re-appended on save (sublocality, city, state).
  //
  // Each of those is expanded into its OWN segments before the
  // comparison. Comparing a whole location segment against the
  // raw field breaks whenever `sublocality` spans more than one
  // segment — "Agara, HSR Layout" never equals "Agara" or "HSR
  // Layout", so nothing was stripped, and the save path then
  // appended the sublocality a second time. Worse, it compounded:
  // the next edit recovered the doubled text as `address` and
  // appended again, which is how a row reached "JP Nagar, 5th
  // phase" three times over.
  const dropSegments = new Set(
    [property.sublocality, property.city, property.state]
      .filter((v): v is string => Boolean(v))
      .flatMap((v) => v.split(',').map((s) => s.trim().toLowerCase()))
      .filter(Boolean)
  );

  const seenSegments = new Set<string>();
  const addrSegments = property.location
    .split(',')
    .map((s) => s.trim())
    .filter((seg) => {
      const key = seg.toLowerCase();
      // Also drop repeats, so opening and saving a row that was
      // already corrupted heals it instead of growing it again.
      if (!key || dropSegments.has(key) || seenSegments.has(key)) return false;
      seenSegments.add(key);
      return true;
    });

  return {
    title: property.title,
    description: property.description ?? '',
    price:
      property.price !== null && property.price !== undefined
        ? String(property.price)
        : '',
    listingType: property.listing_type ?? 'Sale',
    rentPerMonth:
      property.rent_per_month !== null && property.rent_per_month !== undefined
        ? String(property.rent_per_month)
        : '',
    maintenance:
      property.maintenance !== null && property.maintenance !== undefined
        ? String(property.maintenance)
        : '',
    advance:
      property.advance !== null && property.advance !== undefined
        ? String(property.advance)
        : '',
    gst:
      property.gst !== null && property.gst !== undefined
        ? String(property.gst)
        : '',
    jvStructure: property.jv_structure ?? 'Revenue Share',
    ownerSharePercent:
      property.owner_share_percent !== null &&
      property.owner_share_percent !== undefined
        ? String(property.owner_share_percent)
        : '',
    builderSharePercent:
      property.builder_share_percent !== null &&
      property.builder_share_percent !== undefined
        ? String(property.builder_share_percent)
        : '',
    goodwillAmount:
      property.goodwill_amount !== null &&
      property.goodwill_amount !== undefined
        ? String(property.goodwill_amount)
        : '',
    btsLeaseYears:
      property.bts_lease_years !== null &&
      property.bts_lease_years !== undefined
        ? String(property.bts_lease_years)
        : '',
    btsLockInYears:
      property.bts_lock_in_years !== null &&
      property.bts_lock_in_years !== undefined
        ? String(property.bts_lock_in_years)
        : '',
    btsEscalationPercent:
      property.bts_escalation_percent !== null &&
      property.bts_escalation_percent !== undefined
        ? String(property.bts_escalation_percent)
        : '',
    rentalIncome:
      property.rental_income !== null && property.rental_income !== undefined
        ? String(property.rental_income)
        : '',
    floorTenancies: (property.floor_tenancies || []).map((ft) => ({
      floor: ft.floor || '',
      tenant_name: ft.tenant_name || '',
      area_sqft:
        ft.area_sqft !== null && ft.area_sqft !== undefined
          ? String(ft.area_sqft)
          : '',
      monthly_rent:
        ft.monthly_rent !== null && ft.monthly_rent !== undefined
          ? String(ft.monthly_rent)
          : '',
      advance:
        ft.advance !== null && ft.advance !== undefined
          ? String(ft.advance)
          : '',
      lease_start: ft.lease_start || '',
      lease_end: ft.lease_end || '',
      lock_in_months:
        ft.lock_in_months !== null && ft.lock_in_months !== undefined
          ? String(ft.lock_in_months)
          : '',
      maintenance: ft.maintenance || '',
      notes: ft.notes || '',
      floor_plan: ft.floor_plan || '',
    })),
    floorPlans: (property.floor_plans || []).map((fp) => ({
      floor: fp.floor || '',
      image: fp.image || '',
      area_sqft:
        fp.area_sqft !== null && fp.area_sqft !== undefined
          ? String(fp.area_sqft)
          : '',
      notes: fp.notes || '',
    })),
    type: property.type,
    status: property.status,
    soldPrice:
      property.sold_price !== null && property.sold_price !== undefined
        ? String(property.sold_price)
        : '',
    sellerFinalPrice:
      property.seller_final_price !== null &&
      property.seller_final_price !== undefined
        ? String(property.seller_final_price)
        : '',
    sellerFinalPricePerSqft:
      property.seller_final_price_per_sqft !== null &&
      property.seller_final_price_per_sqft !== undefined
        ? String(property.seller_final_price_per_sqft)
        : '',
    bedrooms:
      property.bedrooms !== null && property.bedrooms !== undefined
        ? String(property.bedrooms)
        : '',
    bathrooms:
      property.bathrooms !== null && property.bathrooms !== undefined
        ? String(property.bathrooms)
        : '',
    areaSqft:
      property.area_sqft !== null && property.area_sqft !== undefined
        ? String(property.area_sqft)
        : '',
    areaUnit: property.area_unit ?? 'Sq.Ft.',
    landArea:
      property.land_area !== null && property.land_area !== undefined
        ? String(property.land_area)
        : '',
    landAreaUnit: property.land_area_unit ?? 'Sq.Ft.',
    superBuiltArea:
      property.super_built_area !== null &&
      property.super_built_area !== undefined
        ? String(property.super_built_area)
        : '',
    sublocality: property.sublocality ?? '',
    city: property.city ?? '',
    stateVal: property.state ?? '',
    project: property.project ?? '',
    landZone: property.land_zone ?? '',
    idealFor: property.ideal_for ?? '',
    ownershipStatus: property.ownership_status ?? '',
    landUseZoning: property.land_use_zoning ?? '',
    legalStatus: property.legal_status ?? '',
    conversionType: property.conversion_type ?? '',
    dealRemarks: property.deal_remarks ?? '',
    dimensions: dims,
    frontage,
    depth,
    roadWidth:
      property.road_width !== null && property.road_width !== undefined
        ? String(property.road_width)
        : '',
    roadWidthUnit: property.road_width_unit ?? 'Feet',
    facingDirection: property.facing_direction ?? '',
    khataEpid: property.khata_epid ?? '',
    khataForm: property.khata_form ?? '',
    yearBuilt: property.year_built != null ? String(property.year_built) : '',
    furnishing: property.furnishing ?? '',
    possessionDate: property.possession_date ?? '',
    floorNumber:
      property.floor_number !== null && property.floor_number !== undefined
        ? String(property.floor_number)
        : '',
    totalFloors:
      property.total_floors !== null && property.total_floors !== undefined
        ? String(property.total_floors)
        : '',
    balconies:
      property.balconies !== null && property.balconies !== undefined
        ? String(property.balconies)
        : '',
    flooring: property.flooring ?? '',
    powerBackup: property.power_backup ?? '',
    isPublished: property.is_published,
    features: property.features || [],
    nearbyHighlights: property.nearby_highlights || [],
    images:
      property.images && property.images.length > 0 ? property.images : [''],
    privateImages: property.private_images || [],
    videoRemoved: false,
    defaultImageIndex: 0, // Default image is always at index 0
    documents: parsed.length > 0 ? parsed : [{ url: '', title: '' }],
    ownerContactId: property.owner_contact_id ?? null,
    // The form's Owner/Agent toggle only models Engine-internal referral
    // source; a WhatsApp self-listing is displayed as "Owner" here
    // (the "Submitted via WhatsApp" badge in the list view already
    // distinguishes it) rather than adding a third toggle state.
    listingSource: property.listing_source === 'agent' ? 'agent' : 'owner',
    googleMapLink: property.google_map_link ?? '',
    locationPrivacy:
      property.location_privacy === 'exact' ||
      property.location_privacy === 'locality'
        ? property.location_privacy
        : '',
    showcaseVisibility:
      property.showcase_visibility === 'teaser' ? 'teaser' : '',
    notes: property.notes ?? '',
    tags: property.tags || [],
    // Preserve saved coordinates unless the agent re-touches the location
    geoPick:
      property.latitude != null && property.longitude != null
        ? {
            latitude: Number(property.latitude),
            longitude: Number(property.longitude),
            place_id: property.locality_place_id || '',
            canonical: property.locality_canonical || '',
          }
        : null,
    interestedContactIds,
    // Set unified query string on open
    searchQuery: property.project
      ? property.project
      : (property.sublocality ?? ''),
    address: addrSegments.join(', ') || '',
  };
}

export function propertyFormReducer(
  state: PropertyFormValues,
  action: PropertyFormAction
): PropertyFormValues {
  if (action.type === 'reset') return action.values;
  const prev: unknown = state[action.field];
  const update: unknown = action.value;
  const next =
    typeof update === 'function'
      ? (update as (prev: unknown) => unknown)(prev)
      : update;
  if (Object.is(next, prev)) return state;
  return { ...state, [action.field]: next } as PropertyFormValues;
}

function finalSublocalityOf(values: PropertyFormValues): string {
  let finalSublocality = values.sublocality.trim();
  if (!finalSublocality && values.searchQuery.trim()) {
    finalSublocality = values.searchQuery.trim();
  }
  return finalSublocality;
}

export function validatePropertyForm(
  values: PropertyFormValues
): string | null {
  const {
    title,
    listingType,
    rentPerMonth,
    maintenance,
    advance,
    gst,
    price,
    ownerSharePercent,
    builderSharePercent,
    goodwillAmount,
    btsLeaseYears,
    btsLockInYears,
    btsEscalationPercent,
    city,
    stateVal,
    landArea,
  } = values;
  const isLand = isLandType(values.type);

  if (!title.trim()) {
    return 'Title is required';
  }

  const isRent = listingType === 'Rent';
  const isJV = listingType === 'JV/JD';
  const isBTS = listingType === 'Built to Suit';
  // BTS is leased out like Rent — same rent/maintenance/advance/gst fields.
  const isRentLike = isRent || isBTS;

  if (isRentLike) {
    if (
      !rentPerMonth.trim() ||
      isNaN(Number(rentPerMonth)) ||
      Number(rentPerMonth) < 0
    ) {
      return isBTS
        ? 'Expected rent must be a valid non-negative number'
        : 'Rent per month must be a valid non-negative number';
    }
    if (
      maintenance &&
      (isNaN(Number(maintenance)) || Number(maintenance) < 0)
    ) {
      return 'Maintenance must be a valid non-negative number';
    }
    if (advance && (isNaN(Number(advance)) || Number(advance) < 0)) {
      return 'Advance must be a valid non-negative number';
    }
    if (gst && (isNaN(Number(gst)) || Number(gst) < 0)) {
      return 'GST must be a valid non-negative number';
    }
  } else if (isJV) {
    if (price && (isNaN(Number(price)) || Number(price) < 0)) {
      return 'Expected project value must be a valid non-negative number';
    }
    if (
      !ownerSharePercent.trim() ||
      isNaN(Number(ownerSharePercent)) ||
      Number(ownerSharePercent) <= 0 ||
      Number(ownerSharePercent) >= 100
    ) {
      return 'Owner share % must be a valid number between 0 and 100';
    }
    if (
      !builderSharePercent.trim() ||
      isNaN(Number(builderSharePercent)) ||
      Number(builderSharePercent) <= 0 ||
      Number(builderSharePercent) >= 100
    ) {
      return 'Builder share % must be a valid number between 0 and 100';
    }
    if (
      Math.round(Number(ownerSharePercent) + Number(builderSharePercent)) !==
      100
    ) {
      return 'Owner share % and Builder share % must add up to 100';
    }
    if (
      goodwillAmount &&
      (isNaN(Number(goodwillAmount)) || Number(goodwillAmount) < 0)
    ) {
      return 'Goodwill amount must be a valid non-negative number';
    }
    if (advance && (isNaN(Number(advance)) || Number(advance) < 0)) {
      return 'Advance must be a valid non-negative number';
    }
  } else {
    if (!price.trim() || isNaN(Number(price)) || Number(price) < 0) {
      return 'Price must be a valid non-negative number';
    }
  }

  if (isBTS) {
    if (
      !btsLeaseYears.trim() ||
      isNaN(Number(btsLeaseYears)) ||
      Number(btsLeaseYears) <= 0
    ) {
      return 'Lease term (years) must be a valid positive number';
    }
    if (
      btsLockInYears &&
      (isNaN(Number(btsLockInYears)) || Number(btsLockInYears) < 0)
    ) {
      return 'Lock-in period must be a valid non-negative number';
    }
    if (btsLockInYears && Number(btsLockInYears) > Number(btsLeaseYears)) {
      return 'Lock-in period cannot exceed the total lease term';
    }
    if (
      btsEscalationPercent &&
      (isNaN(Number(btsEscalationPercent)) || Number(btsEscalationPercent) < 0)
    ) {
      return 'Rent escalation % must be a valid non-negative number';
    }
  }

  const finalSublocality = finalSublocalityOf(values);

  if (!finalSublocality || !city.trim() || !stateVal.trim()) {
    return 'Location search query, City, and State are required';
  }

  if (
    isLand &&
    (!landArea.trim() || isNaN(Number(landArea)) || Number(landArea) <= 0)
  ) {
    return 'Land Area is required and must be a valid positive number';
  }

  return null;
}

export interface PropertyPayloadContext {
  isEdit: boolean;
}

export function buildPropertyPayload(
  values: PropertyFormValues,
  { isEdit }: PropertyPayloadContext
) {
  const {
    title,
    description,
    price,
    soldPrice,
    sellerFinalPrice,
    sellerFinalPricePerSqft,
    listingType,
    rentPerMonth,
    maintenance,
    advance,
    gst,
    jvStructure,
    ownerSharePercent,
    builderSharePercent,
    goodwillAmount,
    btsLeaseYears,
    btsLockInYears,
    btsEscalationPercent,
    type,
    status,
    bedrooms,
    bathrooms,
    areaSqft,
    areaUnit,
    landArea,
    landAreaUnit,
    superBuiltArea,
    frontage,
    depth,
    city,
    stateVal,
    address,
    geoPick,
    project,
    landZone,
    idealFor,
    ownershipStatus,
    landUseZoning,
    legalStatus,
    conversionType,
    dealRemarks,
    dimensions,
    roadWidth,
    roadWidthUnit,
    facingDirection,
    khataEpid,
    khataForm,
    yearBuilt,
    furnishing,
    possessionDate,
    floorNumber,
    totalFloors,
    balconies,
    flooring,
    powerBackup,
    isPublished,
    features,
    nearbyHighlights,
    images,
    defaultImageIndex,
    documents,
    googleMapLink,
    locationPrivacy,
    showcaseVisibility,
    notes,
    tags,
    rentalIncome,
    floorTenancies,
    floorPlans,
    ownerContactId,
    listingSource,
    interestedContactIds,
  } = values;
  const hasBedsBaths = typeHasBedsBaths(type);
  const hasCommercialBuildingFields = typeHasCommercialBuildingFields(type);
  const isLand = isLandType(type);
  const isRawLand = isRawLandType(type);
  const isApartment = isApartmentType(type);
  const showFloorNumber = hasUnitFloor(type);
  const showTotalFloors = hasTotalFloors(type);

  const isRent = listingType === 'Rent';
  const isJV = listingType === 'JV/JD';
  const isBTS = listingType === 'Built to Suit';
  // BTS is leased out like Rent — same rent/maintenance/advance/gst fields.
  const isRentLike = isRent || isBTS;

  const finalSublocality = finalSublocalityOf(values);

  const parsedPrice = isRentLike
    ? Number(rentPerMonth) || 0
    : isJV
      ? price.trim() !== ''
        ? Number(price)
        : 0
      : Number(price);
  const parsedRentPerMonth = isRentLike ? Number(rentPerMonth) : null;
  const parsedMaintenance =
    isRentLike && maintenance.trim() !== '' ? Number(maintenance) : null;
  const parsedAdvance =
    (isRentLike || isJV) && advance.trim() !== '' ? Number(advance) : null;
  const parsedGst = isRentLike && gst.trim() !== '' ? Number(gst) : null;
  const parsedJvStructure = isJV ? jvStructure : null;
  const parsedOwnerSharePercent =
    isJV && ownerSharePercent.trim() !== '' ? Number(ownerSharePercent) : null;
  const parsedBuilderSharePercent =
    isJV && builderSharePercent.trim() !== ''
      ? Number(builderSharePercent)
      : null;
  const parsedGoodwillAmount =
    isJV && goodwillAmount.trim() !== '' ? Number(goodwillAmount) : null;
  const parsedBtsLeaseYears =
    isBTS && btsLeaseYears.trim() !== '' ? Number(btsLeaseYears) : null;
  const parsedBtsLockInYears =
    isBTS && btsLockInYears.trim() !== '' ? Number(btsLockInYears) : null;
  const parsedBtsEscalationPercent =
    isBTS && btsEscalationPercent.trim() !== ''
      ? Number(btsEscalationPercent)
      : null;
  const parsedBedrooms =
    hasBedsBaths && bedrooms.trim() !== '' ? Number(bedrooms) : null;
  const parsedBathrooms =
    hasBedsBaths && bathrooms.trim() !== '' ? Number(bathrooms) : null;
  const parsedFloorNumber =
    showFloorNumber && floorNumber.trim() !== '' ? Number(floorNumber) : null;
  const parsedTotalFloors =
    showTotalFloors && totalFloors.trim() !== '' ? Number(totalFloors) : null;
  const parsedBalconies =
    hasBedsBaths && balconies.trim() !== '' ? Number(balconies) : null;
  const parsedAreaSqft =
    !isLand && areaSqft.trim() !== '' ? Number(areaSqft) : null;
  const parsedLandArea =
    (isLand || !isApartment) && landArea.trim() !== ''
      ? Number(landArea)
      : null;
  const parsedSuperBuiltArea =
    !isLand && superBuiltArea.trim() !== '' ? Number(superBuiltArea) : null;
  const parsedRoadWidth =
    !isApartment && roadWidth.trim() !== '' ? Number(roadWidth) : null;

  const parsedFeatures = features;
  const parsedNearbyHighlights = nearbyHighlights;
  const filteredImages = images
    .map((img) => img.trim())
    .filter((img) => img.length > 0);
  // Reorder images so the default image is at index 0
  const parsedImages =
    filteredImages.length > 0 &&
    defaultImageIndex > 0 &&
    defaultImageIndex < filteredImages.length
      ? [
          filteredImages[defaultImageIndex],
          ...filteredImages.filter((_, i) => i !== defaultImageIndex),
        ]
      : filteredImages;
  const parsedDocuments = documents
    .filter((doc) => doc.url.trim().length > 0)
    .map((doc) => {
      return JSON.stringify({
        url: doc.url.trim(),
        title: doc.title?.trim() || '',
      });
    });

  // Construct formatted complete location string
  const fullLocation = [
    address.trim(),
    finalSublocality,
    city.trim(),
    stateVal.trim(),
  ]
    .filter(Boolean)
    .join(', ');

  let finalDimensions = dimensions.trim();
  if (isLand) {
    if (frontage.trim() && depth.trim()) {
      finalDimensions = `${frontage.trim()}x${depth.trim()}`;
    } else {
      finalDimensions = '';
    }
  } else if (isApartment) {
    finalDimensions = '';
  }

  return {
    title: title.trim(),
    description: description.trim() || null,
    price: parsedPrice,
    listing_type: listingType,
    rent_per_month: parsedRentPerMonth,
    maintenance: parsedMaintenance,
    advance: parsedAdvance,
    gst: parsedGst,
    jv_structure: parsedJvStructure,
    owner_share_percent: parsedOwnerSharePercent,
    builder_share_percent: parsedBuilderSharePercent,
    goodwill_amount: parsedGoodwillAmount,
    bts_lease_years: parsedBtsLeaseYears,
    bts_lock_in_years: parsedBtsLockInYears,
    bts_escalation_percent: parsedBtsEscalationPercent,
    location: fullLocation,
    type,
    status: isEdit ? status : 'Available', // Force Available for additions
    // Only meaningful while Sold; sending null clears a stale value
    // if the status moves away from Sold.
    sold_price:
      status === 'Sold' &&
      soldPrice.trim() !== '' &&
      !Number.isNaN(Number(soldPrice))
        ? Number(soldPrice)
        : null,
    // Ignored by the create route's allowlist — a listing has no
    // negotiated floor on the day it is entered.
    seller_final_price:
      sellerFinalPrice.trim() !== '' && !Number.isNaN(Number(sellerFinalPrice))
        ? Number(sellerFinalPrice)
        : null,
    seller_final_price_per_sqft:
      sellerFinalPricePerSqft.trim() !== '' &&
      !Number.isNaN(Number(sellerFinalPricePerSqft))
        ? Number(sellerFinalPricePerSqft)
        : null,
    bedrooms: parsedBedrooms,
    bathrooms: parsedBathrooms,
    furnishing: !isLand && furnishing ? furnishing : null,
    possession_date: possessionDate || null,
    floor_number: parsedFloorNumber,
    total_floors: parsedTotalFloors,
    balconies: parsedBalconies,
    flooring: !isLand && flooring ? flooring : null,
    power_backup: !isLand && powerBackup ? powerBackup : null,
    area_sqft: parsedAreaSqft,
    area_unit: isLand ? null : areaUnit,
    land_area: parsedLandArea,
    land_area_unit: isApartment ? null : landAreaUnit,
    super_built_area: parsedSuperBuiltArea,
    sublocality: finalSublocality,
    city: city.trim(),
    state: stateVal.trim(),
    project: project.trim() || null,
    land_zone: landZone.trim() || null,
    ideal_for: idealFor.trim() || null,
    ownership_status: ownershipStatus.trim() || null,
    land_use_zoning: landUseZoning.trim() || null,
    legal_status: isRawLand ? legalStatus.trim() || null : null,
    conversion_type: isRawLand ? conversionType.trim() || null : null,
    deal_remarks: dealRemarks.trim() || null,
    dimensions: finalDimensions || null,
    road_width: parsedRoadWidth,
    road_width_unit: roadWidthUnit,
    facing_direction: facingDirection || null,
    khata_epid: khataEpid.trim() || null,
    khata_form: khataForm || null,
    year_built: isLand ? null : yearBuilt.trim() ? Number(yearBuilt) : null,
    nearby_highlights: parsedNearbyHighlights,
    is_published: isPublished,
    features: parsedFeatures,
    images: parsedImages,
    documents: parsedDocuments,
    owner_contact_id: ownerContactId,
    listing_source: listingSource,
    google_map_link: googleMapLink.trim() || null,
    location_privacy: locationPrivacy || null,
    showcase_visibility: showcaseVisibility || null,
    rental_income:
      hasCommercialBuildingFields && rentalIncome.trim() !== ''
        ? Number(rentalIncome)
        : null,
    // Server-side sanitizeFloorTenancies() drops empty rows and
    // re-validates every value.
    floor_tenancies: hasCommercialBuildingFields
      ? floorTenancies.map((ft) => ({
          floor: ft.floor.trim(),
          tenant_name: ft.tenant_name.trim() || null,
          area_sqft:
            ft.area_sqft.trim() !== '' && !Number.isNaN(Number(ft.area_sqft))
              ? Number(ft.area_sqft)
              : null,
          monthly_rent:
            ft.monthly_rent.trim() !== '' &&
            !Number.isNaN(Number(ft.monthly_rent))
              ? Number(ft.monthly_rent)
              : null,
          advance:
            ft.advance.trim() !== '' && !Number.isNaN(Number(ft.advance))
              ? Number(ft.advance)
              : null,
          lease_start: ft.lease_start || null,
          lease_end: ft.lease_end || null,
          lock_in_months:
            ft.lock_in_months.trim() !== '' &&
            !Number.isNaN(Number(ft.lock_in_months))
              ? Number(ft.lock_in_months)
              : null,
          maintenance: ft.maintenance.trim() || null,
          notes: ft.notes.trim() || null,
          floor_plan: ft.floor_plan.trim() || null,
        }))
      : [],
    // Server-side sanitizeFloorPlans() drops rows with neither a
    // label nor a drawing.
    floor_plans: floorPlans.map((fp) => ({
      floor: fp.floor.trim(),
      image: fp.image.trim() || null,
      area_sqft:
        fp.area_sqft.trim() !== '' && !Number.isNaN(Number(fp.area_sqft))
          ? Number(fp.area_sqft)
          : null,
      notes: fp.notes.trim() || null,
    })),
    notes: notes.trim() || null,
    tags,
    // Coordinates from the Google Maps pick; nulls tell the server to
    // geocode the (possibly changed) location text instead.
    latitude: geoPick?.latitude ?? null,
    longitude: geoPick?.longitude ?? null,
    locality_place_id: geoPick?.place_id || null,
    locality_canonical: geoPick?.canonical || null,
    interested_contact_ids: interestedContactIds,
    updated_at: new Date().toISOString(),
  };
}
