'use client';

// Buyer portal — matching preferences. Edits the same contacts
// columns as the agent form and the WhatsApp preference flow; the
// PUT applies to every linked agency.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useBuyer } from './buyer-provider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface BuyerPreferences {
  min_budget: number | null;
  max_budget: number | null;
  areas_of_interest: string[];
  property_interests: string[];
  min_roi: number | null;
}

interface PreferencesResponse {
  preferences: BuyerPreferences | null;
  property_interest_options: string[];
}

export function BuyerPreferencesContent() {
  const { me } = useBuyer();
  const [data, setData] = useState<PreferencesResponse | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/buyer/preferences');
      if (!res.ok) {
        toast.error('Could not load your preferences');
        return;
      }
      setData((await res.json()) as PreferencesResponse);
    })();
  }, []);

  if (!data) {
    return (
      <p className="text-muted-foreground text-sm">Loading preferences…</p>
    );
  }

  return (
    <BuyerPreferencesForm
      key={me?.buyer_user_id}
      initial={data.preferences}
      options={data.property_interest_options}
      hasLinks={(me?.links.length ?? 0) > 0}
    />
  );
}

function BuyerPreferencesForm({
  initial,
  options,
  hasLinks,
}: {
  initial: BuyerPreferences | null;
  options: string[];
  hasLinks: boolean;
}) {
  const [minBudget, setMinBudget] = useState(
    initial?.min_budget?.toString() ?? ''
  );
  const [maxBudget, setMaxBudget] = useState(
    initial?.max_budget?.toString() ?? ''
  );
  const [areas, setAreas] = useState(
    (initial?.areas_of_interest ?? []).join(', ')
  );
  const [interests, setInterests] = useState<string[]>(
    initial?.property_interests ?? []
  );
  const [minRoi, setMinRoi] = useState(initial?.min_roi?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const toggleInterest = (option: string, checked: boolean) => {
    setInterests((prev) =>
      checked ? [...prev, option] : prev.filter((i) => i !== option)
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch('/api/buyer/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_budget: minBudget.trim() === '' ? null : Number(minBudget),
        max_budget: maxBudget.trim() === '' ? null : Number(maxBudget),
        areas_of_interest: areas
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        property_interests: interests,
        min_roi: minRoi.trim() === '' ? null : Number(minRoi),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error || 'Could not save preferences');
      return;
    }
    toast.success("Preferences saved — we'll match you accordingly.");
  };

  return (
    <form
      onSubmit={handleSave}
      className="mx-auto flex max-w-xl flex-col gap-4"
    >
      <div>
        <h1 className="text-xl font-black tracking-tight">My Preferences</h1>
        <p className="text-muted-foreground text-sm font-medium">
          Tell us what you&apos;re looking for — every agency you work with sees
          the same preferences.
        </p>
      </div>

      {!hasLinks && (
        <Card>
          <CardContent className="text-muted-foreground py-4 text-xs font-medium">
            You&apos;re not linked to an agency yet. Enquire on a property or
            share your requirements on a showcase, then come back to fine-tune
            your preferences.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Budget</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-min-budget" className="text-xs font-bold">
              Minimum (₹)
            </Label>
            <Input
              id="p-min-budget"
              type="number"
              min={0}
              placeholder="e.g. 5000000"
              value={minBudget}
              onChange={(e) => setMinBudget(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-max-budget" className="text-xs font-bold">
              Maximum (₹)
            </Label>
            <Input
              id="p-max-budget"
              type="number"
              min={0}
              placeholder="e.g. 20000000"
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Localities</CardTitle>
          <CardDescription className="text-xs">
            Separate multiple localities with commas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="e.g. JP Nagar, Jayanagar, Koramangala"
            value={areas}
            onChange={(e) => setAreas(e.target.value)}
            rows={2}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Property types</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {options.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2.5 text-xs font-semibold select-none"
            >
              <input
                type="checkbox"
                checked={interests.includes(option)}
                onChange={(e) => toggleInterest(option, e.target.checked)}
                className="border-input text-primary focus:ring-primary/40 h-3.5 w-3.5 cursor-pointer rounded"
              />
              {option}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Returns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-min-roi" className="text-xs font-bold">
              Expected minimum ROI (%)
            </Label>
            <Input
              id="p-min-roi"
              type="number"
              min={0}
              step="0.1"
              placeholder="e.g. 4.5"
              value={minRoi}
              onChange={(e) => setMinRoi(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Button
        type="submit"
        disabled={saving || !hasLinks}
        className="text-xs font-bold"
      >
        {saving ? 'Saving…' : 'Save preferences'}
      </Button>
    </form>
  );
}
