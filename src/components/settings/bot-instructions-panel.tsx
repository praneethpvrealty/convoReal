'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import type { BotInstructionInfluence } from '@/lib/ai/bot-instructions';

interface BotInstructionRow {
  id: string;
  directive: string;
  influence: BotInstructionInfluence;
  status: 'proposed' | 'active' | 'paused';
  source: 'typed' | 'learned_from_correction';
  contact_classification: string | null;
  listing_type: string | null;
  language: string | null;
  hit_count: number;
  last_hit_at: string | null;
}

const INFLUENCES: { value: BotInstructionInfluence; label: string }[] = [
  { value: 'tone', label: 'Tone and wording' },
  { value: 'question_order', label: 'Question order' },
  { value: 'volunteering', label: 'What to volunteer' },
  { value: 'collateral', label: 'Collateral to offer' },
  { value: 'handover', label: 'When to hand over' },
];

const CONTACT_CLASSIFICATIONS = [
  'Buyer',
  'Owner',
  'Seller',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
];
const LISTING_TYPES = ['Sale', 'Rent', 'JV/JD', 'Built to Suit'];

export function BotInstructionsPanel() {
  const { canEditSettings } = useAuth();
  const [rules, setRules] = useState<BotInstructionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [directive, setDirective] = useState('');
  const [influence, setInfluence] = useState<BotInstructionInfluence>('tone');
  const [classification, setClassification] = useState('');
  const [listingType, setListingType] = useState('');
  const [language, setLanguage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/bot-instructions');
      const body = (await response.json()) as {
        data?: BotInstructionRow[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || 'Could not load rules');
      setRules(body.data ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not load rules'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addRule() {
    if (!directive.trim()) return;
    setSaving(true);
    try {
      const response = await fetch('/api/bot-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directive,
          influence,
          contact_classification: classification || null,
          listing_type: listingType || null,
          language: language || null,
        }),
      });
      const body = (await response.json()) as {
        data?: BotInstructionRow;
        error?: string;
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error || 'Could not save rule');
      }
      setRules((current) => [body.data!, ...current]);
      setDirective('');
      toast.success('Bot rule activated');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save rule'
      );
    } finally {
      setSaving(false);
    }
  }

  async function setActive(rule: BotInstructionRow, active: boolean) {
    const status = active ? 'active' : 'paused';
    setRules((current) =>
      current.map((item) => (item.id === rule.id ? { ...item, status } : item))
    );
    try {
      const response = await fetch(`/api/bot-instructions/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) return;
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error || 'Could not update rule');
    } catch (error) {
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? rule : item))
      );
      toast.error(
        error instanceof Error ? error.message : 'Could not update rule'
      );
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="text-primary size-4" />
            Bot rule book
          </CardTitle>
          <CardDescription>
            Shape replies without training a model. Rules never initiate a
            message and only apply when their scope matches the conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bot-rule">Instruction</Label>
            <Textarea
              id="bot-rule"
              value={directive}
              onChange={(event) => setDirective(event.target.value)}
              maxLength={1000}
              disabled={!canEditSettings || saving}
              placeholder="Example: Ask for the buyer's budget before offering the brochure."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RuleSelect
              label="Influence"
              value={influence}
              onChange={(value) =>
                setInfluence(value as BotInstructionInfluence)
              }
              options={INFLUENCES}
              disabled={!canEditSettings || saving}
            />
            <RuleSelect
              label="Contact"
              value={classification}
              onChange={setClassification}
              options={CONTACT_CLASSIFICATIONS.map((value) => ({
                value,
                label: value,
              }))}
              disabled={!canEditSettings || saving}
              globalLabel="Any contact"
            />
            <RuleSelect
              label="Listing"
              value={listingType}
              onChange={setListingType}
              options={LISTING_TYPES.map((value) => ({ value, label: value }))}
              disabled={!canEditSettings || saving}
              globalLabel="Any listing"
            />
            <RuleSelect
              label="Language"
              value={language}
              onChange={setLanguage}
              options={Object.entries(SUPPORTED_LANGUAGES).map(
                ([value, entry]) => ({
                  value,
                  label: entry.label,
                })
              )}
              disabled={!canEditSettings || saving}
              globalLabel="Any language"
            />
          </div>
          <Button
            onClick={addRule}
            disabled={!canEditSettings || saving || !directive.trim()}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            Add active rule
          </Button>
          {!canEditSettings && (
            <p className="text-muted-foreground text-xs">
              An account admin can add or pause rules.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            More specific matching rules are applied before global ones, with a
            maximum of 20 per reply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No bot rules yet.
            </p>
          ) : (
            <div className="divide-border divide-y">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm">{rule.directive}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {
                        INFLUENCES.find((item) => item.value === rule.influence)
                          ?.label
                      }
                      {' · '}
                      {scopeLabel(rule)}
                      {' · '}
                      Fired {rule.hit_count.toLocaleString()} times
                    </p>
                  </div>
                  <Switch
                    checked={rule.status === 'active'}
                    onCheckedChange={(checked) => void setActive(rule, checked)}
                    disabled={!canEditSettings || rule.status === 'proposed'}
                    aria-label={`${rule.status === 'active' ? 'Pause' : 'Activate'} rule`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RuleSelect({
  label,
  value,
  onChange,
  options,
  globalLabel,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  globalLabel?: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        className="border-input bg-background text-foreground h-8 w-full rounded-lg border px-2.5 text-sm disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {globalLabel && <option value="">{globalLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function scopeLabel(rule: BotInstructionRow) {
  const parts = [
    rule.contact_classification,
    rule.listing_type,
    rule.language
      ? SUPPORTED_LANGUAGES[rule.language as keyof typeof SUPPORTED_LANGUAGES]
          ?.label
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'All conversations';
}
