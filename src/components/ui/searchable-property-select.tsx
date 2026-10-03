'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check, Tag, ImageOff } from 'lucide-react';
import { useAnchoredDropdown } from '@/hooks/use-anchored-dropdown';
import { formatCurrencyShort } from '@/lib/currency-utils';
import { storagePublicUrl } from '@/lib/storage/url';

interface PropertyOption {
  id: string;
  title: string;
  property_code?: string | null;
  location?: string | null;
  sublocality?: string | null;
  project?: string | null;
  tags?: string[] | null;
  price?: number | null;
  type?: string | null;
  bedrooms?: number | null;
  area_sqft?: number | null;
  area_unit?: string | null;
  images?: string[] | null;
}

interface SearchablePropertySelectProps {
  properties: PropertyOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchablePropertySelect({
  properties,
  value,
  onChange,
  placeholder = 'Select property...',
  className = '',
  disabled = false,
}: SearchablePropertySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownPosition = useAnchoredDropdown(isOpen, containerRef);

  // Find the selected property
  const selectedProperty = useMemo(() => {
    if (!value) return null;
    return properties.find((p) => p.id === value) || null;
  }, [value, properties]);

  // Filter properties based on search query
  const filteredProperties = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return properties;

    return properties.filter((p) => {
      const code = (p.property_code || '').toLowerCase();
      const title = (p.title || '').toLowerCase();
      const location = (p.location || '').toLowerCase();
      const sublocality = (p.sublocality || '').toLowerCase();
      const project = (p.project || '').toLowerCase();
      const tags = (p.tags || []).join(' ').toLowerCase();

      return (
        code.includes(query) ||
        title.includes(query) ||
        location.includes(query) ||
        sublocality.includes(query) ||
        project.includes(query) ||
        tags.includes(query)
      );
    });
  }, [search, properties]);

  // Close dropdown on click outside — excludes both the trigger container
  // and the portal-rendered dropdown content.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else if (!isOpen) {
      setTimeout(() => {
        setSearch('');
      }, 0);
    }
  }, [isOpen]);

  const triggerLabel = selectedProperty
    ? `${selectedProperty.property_code ? `[${selectedProperty.property_code}] ` : ''}${selectedProperty.title}`
    : placeholder;

  const dropdownContent =
    isOpen && dropdownPosition ? (
      <div
        ref={dropdownRef}
        className="animate-in fade-in fixed z-[100] flex flex-col rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl duration-150"
        style={{
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
          maxHeight: dropdownPosition.maxHeight,
        }}
      >
        {/* Search Box */}
        <div className="relative mb-1.5 shrink-0">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by title, code, locality or tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus:ring-primary h-8.5 w-full rounded-lg border border-slate-800 bg-slate-950 pr-7 pl-8 text-xs text-white placeholder:text-slate-500 focus:ring-1 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* Options List */}
        <div className="min-h-0 flex-1 scrollbar-thin scrollbar-thumb-slate-800 space-y-0.5 overflow-y-auto pr-0.5">
          {/* Clear Selection Option */}
          <div
            onClick={() => {
              onChange(null);
              setIsOpen(false);
            }}
            className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors select-none hover:bg-slate-800 ${
              !value
                ? 'bg-primary/10 text-primary hover:bg-primary/15 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{value ? 'Clear Selection' : 'None'}</span>
            {!value && <Check className="text-primary size-3" />}
          </div>

          {/* Separator */}
          <div className="my-1 h-px bg-slate-800/80" />

          {filteredProperties.length === 0 ? (
            <div className="py-6 text-center text-xs font-medium text-slate-500">
              No matching properties found
            </div>
          ) : (
            filteredProperties.map((prop) => {
              const isSelected = value === prop.id;
              const thumb =
                prop.images && prop.images.length > 0
                  ? storagePublicUrl(prop.images[0])
                  : '';
              const meta = [
                typeof prop.price === 'number' && prop.price > 0
                  ? formatCurrencyShort(prop.price)
                  : null,
                prop.type || null,
                typeof prop.bedrooms === 'number' && prop.bedrooms > 0
                  ? `${prop.bedrooms} BHK`
                  : null,
                typeof prop.area_sqft === 'number' && prop.area_sqft > 0
                  ? `${prop.area_sqft.toLocaleString('en-IN')} ${prop.area_unit || 'Sq.Ft.'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <div
                  key={prop.id}
                  onClick={() => {
                    onChange(prop.id);
                    setIsOpen(false);
                  }}
                  className={`flex cursor-pointer items-start justify-between rounded-lg px-2.5 py-2 text-xs transition-colors select-none hover:bg-slate-800 ${
                    isSelected
                      ? 'bg-primary/10 text-primary hover:bg-primary/15 font-bold'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  {prop.images !== undefined && (
                    <div className="mr-2.5 flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-800 bg-slate-950">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageOff className="size-4 text-slate-700" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {prop.property_code && (
                        <span className="py-0.2 shrink-0 rounded border border-slate-800 bg-slate-950 px-1 font-mono text-[10px] font-bold text-slate-400">
                          {prop.property_code}
                        </span>
                      )}
                      <span className="truncate font-bold">{prop.title}</span>
                    </div>
                    {meta && (
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-300">
                        {meta}
                      </p>
                    )}
                    {prop.location && (
                      <p className="text-slate-450 mt-0.5 truncate text-[10px] font-medium">
                        📍 {prop.location}
                      </p>
                    )}
                    {prop.tags && prop.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {prop.tags.map((tag, idx) => (
                          <span
                            key={`${tag}-${idx}`}
                            className="bg-primary/10 border-primary/20 text-primary inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                          >
                            <Tag className="size-2" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="text-primary mt-0.5 size-3.5 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    ) : null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="hover:bg-slate-750 focus:ring-primary flex h-9.5 w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-left text-xs font-medium text-white shadow-sm transition-colors focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate pr-4 select-none">{triggerLabel}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu rendered via portal to escape overflow constraints */}
      {typeof document !== 'undefined' &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
}
