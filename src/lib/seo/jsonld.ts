import type { Property } from '@/types';

type JsonLd = Record<string, unknown>;

export function propertyJsonLd(
  property: Property,
  url: string,
  imageUrl: string
): JsonLd {
  const isRent = property.listing_type === 'Rent';
  const price = isRent
    ? (property.rent_per_month ?? property.price)
    : property.price;

  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: property.title,
    ...(property.description ? { description: property.description } : {}),
    url,
    image: imageUrl,
    datePosted: property.created_at,
    address: {
      '@type': 'PostalAddress',
      ...(property.sublocality ? { streetAddress: property.sublocality } : {}),
      ...(property.city ? { addressLocality: property.city } : {}),
      ...(property.state ? { addressRegion: property.state } : {}),
      addressCountry: 'IN',
    },
    ...(property.area_sqft
      ? {
          floorSize: {
            '@type': 'QuantitativeValue',
            value: property.area_sqft,
            unitText: 'sq ft',
          },
        }
      : {}),
    ...(property.bedrooms ? { numberOfRooms: property.bedrooms } : {}),
    ...(price
      ? {
          offers: {
            '@type': 'Offer',
            price,
            priceCurrency: 'INR',
            availability:
              property.status === 'Available'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/SoldOut',
          },
        }
      : {}),
  };
}

export function itemListJsonLd(
  name: string,
  items: Array<{ name: string; url: string }>
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

export function breadcrumbJsonLd(
  crumbs: Array<{ name: string; url: string }>
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

// </script> inside a JSON string would terminate the tag early — escape
// the one character sequence that can break out of the script context.
export function jsonLdScript(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
