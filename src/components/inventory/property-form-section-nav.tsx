import { Check, Circle } from 'lucide-react';
import type { PropertyFormSection } from '@/lib/inventory/property-form-sections';

interface PropertyFormSectionNavProps {
  sections: PropertyFormSection[];
}

export function PropertyFormSectionNav({
  sections,
}: PropertyFormSectionNavProps) {
  return (
    <nav
      aria-label="Listing sections"
      className="sticky top-0 hidden self-start py-1 lg:block"
    >
      <ol className="space-y-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {section.done ? (
                <Check
                  aria-label="Complete"
                  className="size-3.5 shrink-0 text-emerald-400"
                />
              ) : (
                <Circle
                  aria-hidden
                  className="size-3.5 shrink-0 text-slate-600"
                />
              )}
              {section.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
