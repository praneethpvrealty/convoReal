import Link from 'next/link';
import { AUTHORITY_SERVICES, publishedLocalities } from '@/lib/seo/authority';
import type { Property } from '@/types';

export function AuthorityLinks({
  businessName,
  properties,
}: {
  businessName: string;
  properties: Property[];
}) {
  const localities = Array.from(
    publishedLocalities(properties).entries()
  ).slice(0, 12);

  return (
    <section className="border-t bg-white px-6 py-12 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-2xl font-semibold">
          Property advisory from {businessName}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Explore the consultancy&apos;s services and locations represented by
          currently published inventory.
        </p>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="font-semibold">Services</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {AUTHORITY_SERVICES.map((service) => (
                <li key={service.slug}>
                  <Link
                    className="text-blue-700 hover:underline"
                    href={`/services/${service.slug}`}
                  >
                    {service.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {localities.length > 0 && (
            <div>
              <h3 className="font-semibold">Consultant locations</h3>
              <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                {localities.map(([slug, locality]) => (
                  <li key={slug}>
                    <Link
                      className="inline-block rounded-full border px-3 py-1.5 hover:bg-slate-50"
                      href={`/property-consultants/${slug}`}
                    >
                      {locality.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
