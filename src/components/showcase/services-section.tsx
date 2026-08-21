'use client';

import * as React from 'react';
import { AgencyService } from '@/types';
import * as LucideIcons from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface ServicesSectionProps {
  services: AgencyService[];
}

export function ServicesSection({
  services,
}: ServicesSectionProps) {
  if (!services || services.length === 0) return null;

  return (
    <section className="py-16 px-4 border-y border-slate-900 bg-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-white tracking-tight sm:text-3xl">
            Our Services
          </h2>
          <p className="mt-3 text-sm text-slate-400 max-w-2xl mx-auto">
            Beyond property matching, we provide end-to-end support for your real estate journey.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const IconComponent = service.icon && (service.icon in LucideIcons)
              ? (LucideIcons as unknown as Record<string, React.ElementType>)[service.icon]
              : LucideIcons.LayoutGrid;

            return (
              <Link
                key={service.id}
                href={`/services/${service.slug}`}
                className="group relative flex flex-col items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-all hover:bg-slate-800 hover:border-slate-700 cursor-pointer overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <IconComponent className="size-6" />
                </div>
                
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-white group-hover:text-primary transition-colors">
                    {service.title}
                  </h3>
                  {service.description && (
                    <p className="mt-2 text-sm text-slate-400 line-clamp-3 leading-relaxed">
                      {service.description}
                    </p>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0">
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
