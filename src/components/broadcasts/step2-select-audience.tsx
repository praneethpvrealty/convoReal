'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  useAudienceCount,
  type AudienceConfig,
  type CustomFieldFilter,
  type CustomFieldOperator,
} from '@/hooks/useBroadcastSending';
import {
  csvAudienceLine,
  parseCsvAudience,
} from '@/lib/broadcasts/csv-audience';
import { MAX_CSV_CONTACTS } from '@/lib/broadcasts/audience';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';

export function isAudienceComplete(
  audience: AudienceConfig | null
): audience is AudienceConfig {
  if (!audience) return false;
  switch (audience.type) {
    case 'all':
      return true;
    case 'tags':
      return (audience.tagIds?.length ?? 0) > 0;
    case 'contacts':
      return (audience.contactIds?.length ?? 0) > 0;
    case 'custom_field':
      return (
        !!audience.customField?.fieldId &&
        audience.customField.value.trim().length > 0
      );
    case 'csv':
      return (
        (audience.csvContacts?.length ?? 0) > 0 &&
        (audience.csvContacts?.length ?? 0) <= MAX_CSV_CONTACTS
      );
  }
}

interface Step2Props {
  audience: AudienceConfig | null;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const audienceOptions: {
  type: AudienceType;
  label: string;
  description: string;
  icon: typeof Users;
}[] = [
  {
    type: 'all',
    label: 'All Contacts',
    description: 'Send to every contact in your database',
    icon: Users,
  },
  {
    type: 'tags',
    label: 'Filter by Tags',
    description: 'Target contacts with specific tags',
    icon: Tags,
  },
  {
    type: 'custom_field',
    label: 'Custom Field',
    description: 'Filter by a custom field value',
    icon: Filter,
  },
  {
    type: 'csv',
    label: 'Upload CSV',
    description: 'Upload a list of phone numbers',
    icon: Upload,
  },
];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'contains', label: 'contains' },
];

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [csvText, setCsvText] = useState(() =>
    (audience?.csvContacts ?? []).map(csvAudienceLine).join('\n')
  );
  const [csvSkipped, setCsvSkipped] = useState(0);

  const [settledAudience, setSettledAudience] = useState(audience);

  useEffect(() => {
    const timer = setTimeout(() => setSettledAudience(audience), 300);
    return () => clearTimeout(timer);
  }, [audience]);

  const complete = isAudienceComplete(audience);
  const settled = settledAudience === audience;
  const countQuery = useAudienceCount(
    isAudienceComplete(settledAudience) ? settledAudience : null
  );
  const recipientCount = complete && settled ? countQuery.data : undefined;

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience?.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience?.type]);

  function toggleTag(tagId: string) {
    if (!audience) return;
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    if (!audience) return;
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    if (!audience) return;
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  function retainedCsvContacts() {
    if (!csvText.trim()) return undefined;
    const { contacts, skipped } = parseCsvAudience(csvText);
    setCsvSkipped(skipped);
    return contacts;
  }

  function applyCsv(text: string) {
    setCsvText(text);
    const { contacts, skipped } = parseCsvAudience(text);
    setCsvSkipped(skipped);
    onUpdate({
      type: 'csv',
      csvContacts: contacts,
      excludeTagIds: audience?.excludeTagIds,
    });
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    applyCsv(await file.text());
  }

  const csvCount = audience?.csvContacts?.length ?? 0;
  const canContinue =
    complete && recipientCount !== undefined && recipientCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Select Audience</h2>
        <p className="mt-1 text-sm text-slate-400">
          Choose who will receive this broadcast.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option) => {
          const isSelected = audience?.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                onUpdate({
                  type: option.type,
                  excludeTagIds: audience?.excludeTagIds,
                  tagIds: option.type === 'tags' ? audience?.tagIds : undefined,
                  customField:
                    option.type === 'custom_field'
                      ? audience?.customField
                      : undefined,
                  csvContacts:
                    option.type !== 'csv'
                      ? undefined
                      : isSelected
                        ? audience?.csvContacts
                        : retainedCsvContacts(),
                })
              }
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{option.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience?.type === 'tags' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="mb-3 text-sm font-medium text-white">Select Tags</p>
          {loadingTags ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-slate-400">
              No tags found. Create tags in Settings.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience?.type === 'csv' && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-white">Phone numbers</p>
            <label className="focus-within:ring-primary inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 focus-within:ring-2 hover:bg-slate-800">
              <Upload className="h-3.5 w-3.5" />
              Choose .csv file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFile}
                className="sr-only"
              />
            </label>
          </div>
          <Textarea
            value={csvText}
            onChange={(e) => applyCsv(e.target.value)}
            rows={6}
            aria-label="Paste phone numbers"
            placeholder={
              'One per line: phone, name (optional)\n9876543210, Asha\n+91 98765 43211'
            }
            className="border-slate-700 bg-slate-800 font-mono text-xs text-white placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-400" aria-live="polite">
            {csvCount.toLocaleString()} valid, {csvSkipped.toLocaleString()}{' '}
            skipped
          </p>
          {csvCount > MAX_CSV_CONTACTS && (
            <p className="text-xs text-red-400">
              A list can hold up to {MAX_CSV_CONTACTS.toLocaleString()} numbers.
              Split it into smaller broadcasts.
            </p>
          )}
        </div>
      )}

      {audience?.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-sm font-medium text-white">Custom Field Filter</p>
          {loadingFields ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-slate-400">
              No custom fields defined. Create one in Settings → Custom Fields.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="focus:border-primary focus:ring-primary h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:ring-1"
              >
                <option value="">Select field…</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="focus:border-primary focus:ring-primary h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none focus:ring-1"
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder="Value"
                className="focus:border-primary focus:ring-primary h-9 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-1"
              />
            </div>
          )}
        </div>
      )}

      {audience && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <X className="h-4 w-4 text-red-400" />
            <p className="text-sm font-medium text-white">
              Exclude contacts with these tags
            </p>
            <span className="text-xs text-slate-500">(optional)</span>
          </div>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-500">No tags available.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isExcluded = audience.excludeTagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isExcluded}
                    onClick={() => toggleExcludeTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isExcluded
                        ? 'border-red-500/30 bg-red-500/10 text-red-300'
                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
        aria-live="polite"
      >
        <p className="mb-2 text-sm font-medium text-white">Audience Summary</p>
        {!complete ? (
          <p className="text-xs text-slate-500">
            {audience
              ? 'Finish choosing the audience to see who will receive it.'
              : 'Choose an audience to see who will receive it.'}
          </p>
        ) : settled && countQuery.isError ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">
              Couldn&apos;t count the audience.
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => countQuery.refetch()}
              className="border-slate-700 text-slate-300"
            >
              <RefreshCw />
              Retry
            </Button>
          </div>
        ) : recipientCount === undefined || countQuery.isFetching ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
            <span className="text-xs text-slate-400">Calculating…</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="text-primary h-4 w-4" />
              <span className="text-sm text-white">
                {recipientCount.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">
                {recipientCount === 1 ? 'recipient' : 'recipients'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {recipientCount === 0
                ? 'Nobody in this audience can receive a WhatsApp broadcast.'
                : 'Contacts without a WhatsApp number, who opted out, or are archived are left out.'}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-slate-700 text-slate-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canContinue || countQuery.isFetching}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
