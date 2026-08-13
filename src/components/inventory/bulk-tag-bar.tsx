'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Tag, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Tag every selected listing at once.
 *
 * A project's listings all want the same label, and applying it one at a
 * time is one trip through the editor each — plus one chance each to
 * type it differently. A tag spelled two ways is worse than no tag: the
 * search still returns results, so nothing looks broken while half the
 * project is missing from them.
 *
 * The merge runs server-side against each row's current tags
 * (bulk_tag_properties, migration 266), so this never overwrites a tag
 * another agent added to one of the selected listings.
 */
export function BulkTagBar({
  selectedIds,
  onClear,
  onTagged,
}: {
  selectedIds: string[];
  onClear: () => void;
  onTagged: () => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { tag: string; uses: number }[]
  >([]);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    void (async () => {
      try {
        const res = await fetch('/api/properties/tags');
        if (!res.ok) return;
        const body = await res.json();
        setSuggestions(Array.isArray(body?.data) ? body.data : []);
      } catch {
        // Suggestions are a convenience; typing still works.
      }
    })();
  }, [selectedIds.length]);

  if (selectedIds.length === 0) return null;

  async function apply(tag: string) {
    const next = tag.trim();
    if (!next) return;
    setSaving(true);
    try {
      const res = await fetch('/api/properties/bulk-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyIds: selectedIds, add: [next] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not tag the listings');

      const { updated, requested } = body.data ?? {};
      toast.success(
        `"${next}" applied to ${updated} listing${updated === 1 ? '' : 's'}.` +
          (updated < requested
            ? ` ${requested - updated} could not be updated.`
            : '')
      );
      setValue('');
      onTagged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not tag the listings'
      );
    } finally {
      setSaving(false);
    }
  }

  const unused = suggestions
    .filter((s) => s.tag.toLowerCase() !== value.trim().toLowerCase())
    .slice(0, 6);

  return (
    <div className="border-primary/30 bg-primary/5 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
      <button
        type="button"
        onClick={onClear}
        title="Clear selection"
        className="cursor-pointer text-slate-400 hover:text-white"
      >
        <X className="size-4" />
      </button>
      <span className="text-xs font-bold text-white">
        {selectedIds.length} selected
      </span>

      <div className="flex items-center gap-1.5">
        <Tag className="text-primary size-3.5" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply(value);
            }
          }}
          placeholder="Tag them all — e.g. APM"
          className="h-8 w-48 border-slate-700 bg-slate-900 text-xs text-white"
        />
        <Button
          size="sm"
          disabled={saving || !value.trim()}
          onClick={() => void apply(value)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Apply'}
        </Button>
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {unused.map((s) => (
            <button
              key={s.tag}
              type="button"
              disabled={saving}
              onClick={() => void apply(s.tag)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
            >
              <Plus className="size-2.5" />
              {s.tag}
              <span className="text-slate-600">{s.uses}</span>
            </button>
          ))}
        </div>
      )}

      <span className="text-[10px] text-slate-500">
        Added to what each listing already carries — nothing is replaced.
      </span>
    </div>
  );
}
