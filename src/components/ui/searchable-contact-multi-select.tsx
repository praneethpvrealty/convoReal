'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import { NameTagBadge } from '@/components/contacts/name-tag-badge';

interface Contact {
  id: string;
  name: string;
  phone: string;
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
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedContacts = useMemo(
    () => value.map((id) => contacts.find((c) => c.id === id)).filter((c): c is Contact => !!c),
    [value, contacts]
  );

  // Filter contacts based on search query
  const filteredContacts = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return contacts;

    return contacts.filter((c) => {
      const name = (c.name || '').toLowerCase();
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

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 6,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    } else {
      setDropdownPosition(null);
    }
  }, [isOpen]);

  const toggleContact = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const dropdownContent = isOpen && dropdownPosition ? (
    <div
      ref={dropdownRef}
      className="fixed z-[100] rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150 max-h-[360px] flex flex-col"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }}
    >
      {/* Search Box */}
      <div className="relative mb-1.5 shrink-0">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search contacts by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8.5 w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-7 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Options List */}
      <div className="flex-1 overflow-y-auto pr-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-slate-800 max-h-[250px]">
        {/* Clear Selection Option */}
        <div
          onClick={() => {
            onChange([]);
            setIsOpen(false);
          }}
          className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs cursor-pointer select-none transition-colors hover:bg-slate-800 ${
            value.length === 0 ? 'bg-primary/10 text-primary hover:bg-primary/15 font-semibold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>{value.length > 0 ? 'Clear Selection' : 'None'}</span>
          {value.length === 0 && <Check className="size-3 text-primary" />}
        </div>

        {/* Separator */}
        <div className="h-px bg-slate-800/80 my-1" />

        {filteredContacts.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 font-medium">
            No matching contacts found
          </div>
        ) : (
          filteredContacts.map((contact) => {
            const isSelected = value.includes(contact.id);
            return (
              <div
                key={contact.id}
                onClick={() => toggleContact(contact.id)}
                className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs cursor-pointer select-none transition-colors hover:bg-slate-800 ${
                  isSelected
                    ? 'bg-primary/10 text-primary hover:bg-primary/15 font-bold'
                    : 'text-slate-200 hover:text-white'
                }`}
              >
                <div className="min-w-0 pr-3 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-bold truncate block min-w-0 flex-1">{contact.name}</span>
                    <NameTagBadge tag={contact.name_tag} />
                  </div>
                  <p className="text-[10px] text-slate-450 mt-0.5 truncate font-medium">
                    📞 {contact.phone}
                  </p>
                </div>
                {isSelected && <Check className="size-3.5 text-primary shrink-0 mt-0.5" />}
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
        className="flex min-h-9.5 w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white shadow-sm transition-colors hover:bg-slate-750 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed font-medium text-left"
      >
        {selectedContacts.length === 0 ? (
          <span className="truncate pr-4 select-none text-slate-400">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1 pr-2 min-w-0">
            {selectedContacts.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-400 max-w-full"
              >
                <span className="truncate">{c.name}</span>
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
                  className="text-violet-400/70 hover:text-white shrink-0"
                >
                  <X className="size-2.5" />
                </span>
              </span>
            ))}
          </span>
        )}
        <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu rendered via portal */}
      {typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </div>
  );
}
