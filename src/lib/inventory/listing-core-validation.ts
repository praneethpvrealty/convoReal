import { isLandType } from './property-options';

export interface ListingCoreValues {
  title: string;
  type: string;
  listingType: string;
  price: string;
  rentPerMonth: string;
  maintenance: string;
  sublocality: string;
  searchQuery: string;
  city: string;
  stateVal: string;
  landArea: string;
}

function isNonNegative(value: string): boolean {
  return !isNaN(Number(value)) && Number(value) >= 0;
}

export function validateListingAmounts(
  values: Pick<
    ListingCoreValues,
    'title' | 'listingType' | 'price' | 'rentPerMonth' | 'maintenance'
  >
): string | null {
  if (!values.title.trim()) return 'Title is required';

  const isBTS = values.listingType === 'Built to Suit';
  if (values.listingType === 'Rent' || isBTS) {
    if (!values.rentPerMonth.trim() || !isNonNegative(values.rentPerMonth)) {
      return isBTS
        ? 'Expected rent must be a valid non-negative number'
        : 'Rent per month must be a valid non-negative number';
    }
    if (values.maintenance && !isNonNegative(values.maintenance)) {
      return 'Maintenance must be a valid non-negative number';
    }
  } else if (values.listingType === 'JV/JD') {
    if (values.price && !isNonNegative(values.price)) {
      return 'Expected project value must be a valid non-negative number';
    }
  } else if (!values.price.trim() || !isNonNegative(values.price)) {
    return 'Price must be a valid non-negative number';
  }
  return null;
}

export function validateListingPlace(
  values: Pick<
    ListingCoreValues,
    'type' | 'sublocality' | 'searchQuery' | 'city' | 'stateVal' | 'landArea'
  >
): string | null {
  const sublocality = values.sublocality.trim() || values.searchQuery.trim();
  if (!sublocality || !values.city.trim() || !values.stateVal.trim()) {
    return 'Location search query, City, and State are required';
  }

  if (
    isLandType(values.type) &&
    (!values.landArea.trim() ||
      isNaN(Number(values.landArea)) ||
      Number(values.landArea) <= 0)
  ) {
    return 'Land Area is required and must be a valid positive number';
  }
  return null;
}

export function validateListingCore(values: ListingCoreValues): string | null {
  return validateListingAmounts(values) ?? validateListingPlace(values);
}
