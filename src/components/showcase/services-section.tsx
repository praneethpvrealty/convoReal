'use client';

import * as React from 'react';
import { AgencyService } from '@/types';
import * as LucideIcons from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface ServicesSectionProps {
  services: AgencyService[];
}

export function ServicesSection({ services }: ServicesSectionProps) {
  if (!services || services.length === 0) return null;

  return (
    <section className="border-y border-slate-900 bg-slate-950 px-4 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Our Services
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400">
            Beyond property matching, we provide end-to-end support for your
            real estate journey.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const IconComponent =
              service.icon && service.icon in LucideIcons
                ? (LucideIcons as unknown as Record<string, React.ElementType>)[
                    service.icon
                  ]
                : LucideIcons.LayoutGrid;

            return (
              <Link
                key={service.id}
                href={`/services/${service.slug}`}
                className="group relative flex cursor-pointer flex-col items-start gap-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all hover:border-slate-700 hover:bg-slate-800"
              >
                <div className="from-primary/5 absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                <div className="bg-primary/10 text-primary ring-primary/20 flex size-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset">
                  <IconComponent className="size-6" />
                </div>

                <div className="flex-1">
                  <h3 className="group-hover:text-primary text-base font-semibold text-white transition-colors">
                    {service.title}
                  </h3>
                  {service.description && (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">
                      {service.description}
                    </p>
                  )}
                </div>

                <div className="text-primary mt-2 flex -translate-x-2 items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100">
                  View Service
                  <ArrowRight className="size-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
