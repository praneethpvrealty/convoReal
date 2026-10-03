'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';
import { contactFullName } from '@/lib/contacts/full-name';
import { useAnchoredDropdown } from '@/hooks/use-anchored-dropdown';

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  name_tag?: string | null;
}

interface SearchableContactMultiSelectProps {
  contacts: Contact[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** Multi-pick variant of SearchableContactSelect — attach every party
 *  to a deal (buyer, partner agent, owner…) to one event. Selection
 *  toggles and the dropdown stays open for picking several in a row. */
export function SearchableContactMultiSelect({
  contacts,
  value,
  onChange,
  placeholder = 'Select contacts...',
  className = '',
  disabled = false,
}: SearchableContactMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownPosition = useAnchoredDropdown(isOpen, containerRef);

  const selectedContacts = useMemo(
    () =>
      value
        .map((id) => contacts.find((c) => c.id === id))
        .filter((c): c is Contact => !!c),
    [value, contacts]
  );

  // Filter contacts based on search query
  const filteredContacts = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return contacts;

    return contacts.filter((c) => {
      const name = contactFullName(c).toLowerCase();
      const phone = (c.phone || '').toLowerCase();
      return name.includes(query) || phone.includes(query);
    });
  }, [search, contacts]);

  // Close dropdown on click outside
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

  const toggleContact = (id: string) => {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  };

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
            placeholder="Search contacts by name or phone..."
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
              onChange([]);
              setIsOpen(false);
            }}
            className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors select-none hover:bg-slate-800 ${
              value.length === 0
                ? 'bg-primary/10 text-primary hover:bg-primary/15 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{value.length > 0 ? 'Clear Selection' : 'None'}</span>
            {value.length === 0 && <Check className="text-primary size-3" />}
          </div>

          {/* Separator */}
          <div className="my-1 h-px bg-slate-800/80" />

          {filteredContacts.length === 0 ? (
            <div className="py-6 text-center text-xs font-medium text-slate-500">
              No matching contacts found
            </div>
          ) : (
            filteredContacts.map((contact) => {
              const isSelected = value.includes(contact.id);
              return (
                <div
                  key={contact.id}
                  onClick={() => toggleContact(contact.id)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors select-none hover:bg-slate-800 ${
                    isSelected
                      ? 'bg-primary/10 text-primary hover:bg-primary/15 font-bold'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="block min-w-0 flex-1 truncate font-bold">
                        {contactFullName(contact)}
                      </span>
                      <NameTagBadge tag={contact.name_tag} />
                    </div>
                    <p className="text-slate-450 mt-0.5 truncate text-[10px] font-medium">
                      📞 {contact.phone ?? '—'}
                    </p>
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
      {/* Trigger Button — shows every selected contact as a chip */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="hover:bg-slate-750 focus:ring-primary flex min-h-9.5 w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-left text-xs font-medium text-white shadow-sm transition-colors focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selectedContacts.length === 0 ? (
          <span className="truncate pr-4 text-slate-400 select-none">
            {placeholder}
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-1 pr-2">
            {selectedContacts.map((c) => (
              <span
                key={c.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400"
              >
                <span className="truncate">{contactFullName(c)}</span>
                <NameTagBadge tag={c.name_tag} />
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleContact(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      toggleContact(c.id);
                    }
                  }}
                  className="shrink-0 text-violet-400/70 hover:text-white"
                >
                  <X className="size-2.5" />
                </span>
              </span>
            ))}
          </span>
        )}
        <ChevronDown
          className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu rendered via portal */}
      {typeof document !== 'undefined' &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
}
