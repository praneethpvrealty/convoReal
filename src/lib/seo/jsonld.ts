import type { Property } from '@/types';
import type { PublicBusinessProfile } from './business-profile';

type JsonLd = Record<string, unknown>;

export function propertyJsonLd(
  property: Property,
  url: string,
  imageUrl: string,
  businessId?: string
): JsonLd {
  const isRent = property.listing_type === 'Rent';
  const price = isRent
    ? (property.rent_per_month ?? property.price)
    : property.price;

  const propertyEntityId = `${url}#property`;
  const additionalProperty = [
    ...(property.area_sqft
      ? [
          {
            '@type': 'PropertyValue',
            name: 'Area',
            value: property.area_sqft,
            unitText: 'sq ft',
          },
        ]
      : []),
    ...(property.bedrooms
      ? [
          {
            '@type': 'PropertyValue',
            name: 'Bedrooms',
            value: property.bedrooms,
          },
        ]
      : []),
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: property.title,
    ...(property.description ? { description: property.description } : {}),
    url,
    image: imageUrl,
    datePosted: property.created_at,
    ...(property.updated_at ? { dateModified: property.updated_at } : {}),
    inLanguage: 'en-IN',
    ...(businessId ? { publisher: { '@id': businessId } } : {}),
    contentLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...((property.sublocality || property.city) && {
          addressLocality: [property.sublocality, property.city]
            .filter(Boolean)
            .join(', '),
        }),
        ...(property.state ? { addressRegion: property.state } : {}),
        addressCountry: 'IN',
      },
    },
    mainEntity: {
      '@type': 'Product',
      '@id': propertyEntityId,
      name: property.title,
      category: property.type,
      ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
    },
    ...(price
      ? {
          offers: {
            '@type': 'Offer',
            url,
            price,
            priceCurrency: 'INR',
            itemOffered: { '@id': propertyEntityId },
            ...(businessId ? { offeredBy: { '@id': businessId } } : {}),
            availability:
              property.status === 'Available'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/SoldOut',
          },
        }
      : {}),
  };
}

export function realEstateAgentJsonLd({
  name,
  url,
  telephone,
  profile,
}: {
  name: string;
  url: string;
  telephone?: string | null;
  profile: PublicBusinessProfile;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    '@id': `${url}#business`,
    name,
    url,
    description: profile.description,
    ...(telephone ? { telephone } : {}),
    ...(profile.areasServed.length > 0
      ? {
          areaServed: profile.areasServed.map((area) => ({
            '@type': 'Place',
            name: area,
          })),
        }
      : {}),
    ...(profile.propertyTypes.length > 0
      ? { knowsAbout: profile.propertyTypes }
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

export function serviceJsonLd({
  name,
  description,
  url,
  providerId,
  areasServed,
}: {
  name: string;
  description: string;
  url: string;
  providerId: string;
  areasServed: string[];
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    description,
    url,
    provider: { '@id': providerId },
    ...(areasServed.length > 0
      ? {
          areaServed: areasServed.map((area) => ({
            '@type': 'Place',
            name: area,
          })),
        }
      : {}),
  };
}

export function faqJsonLd(
  entries: Array<{ question: string; answer: string }>
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

// </script> inside a JSON string would terminate the tag early — escape
// the one character sequence that can break out of the script context.
export function jsonLdScript(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
