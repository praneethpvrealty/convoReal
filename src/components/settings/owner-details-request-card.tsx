'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { ClipboardList, Loader2, RotateCcw } from 'lucide-react';
import {
  OWNER_DETAILS_PLACEHOLDERS,
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerHandoverLink,
  type OwnerDetailsSection,
} from '@/lib/owners/details-request';

/**
 * Account-level wording for the owner property-details request — the
 * first message an agent sends a seller.
 *
 * Two overrides, both optional, and an account that never opens this
 * panel keeps the built-in message forever. The section selection is
 * what the first ask carries; the body is the prose around it. Papers
 * are off by default on purpose, and the panel says why — a brokerage
 * that wants them can still switch them on, but it should be a choice
 * someone made rather than a default nobody noticed.
 *
 * Editing is admin-only (canEditSettings); agents see the current
 * wording read-only, since it is the message they will be sending.
 */

const SAMPLE_ENGINE = { phone: '+91 80 4567 8900', prefix: '' };

export function OwnerDetailsRequestCard() {
  const canEdit = useCan('edit-settings');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<OwnerDetailsSection[]>([]);
  const [bodyTemplate, setBodyTemplate] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/owners/details-request/settings')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const data = json?.data as
          | { sections?: OwnerDetailsSection[]; body_template?: string | null }
          | undefined;
        setSections(data?.sections ?? []);
        setBodyTemplate(data?.body_template ?? '');
      })
      .catch(() => {
        if (!cancelled) toast.error('Could not load the details request');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Empty means "use the built-in default", so the preview has to show
  // that rather than an empty checklist.
  const effectiveSections =
    sections.length > 0 ? sections : defaultOwnerDetailsSections(null);

  const preview = useMemo(
    () =>
      buildOwnerDetailsRequestMessage({
        ownerName: 'Mr Nadeem',
        propertyLabel: 'your site in Koramangala 8th Block',
        propertyType: 'Residential Plot',
        sections: effectiveSections,
        agentName: 'Praneeth',
        agentPhone: '+91 90000 00000',
        brandName: 'your brokerage',
        engineLink: ownerHandoverLink(SAMPLE_ENGINE),
        bodyTemplate: bodyTemplate.trim() || null,
        now: new Date(),
      }),
    [effectiveSections, bodyTemplate]
  );

  function toggleSection(section: OwnerDetailsSection) {
    const current = effectiveSections;
    setSections(
      OWNER_DETAILS_SECTIONS.filter((s) =>
        current.includes(section)
          ? current.includes(s) && s !== section
          : current.includes(s) || s === section
      )
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/owners/details-request/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sections,
          body_template: bodyTemplate.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save');
      toast.success('Details request saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  function resetToBuiltIn() {
    setSections([]);
    setBodyTemplate('');
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-amber-400" />
          Owner details request
        </CardTitle>
        <CardDescription className="text-xs text-slate-400">
          The first message your team sends a seller, from their own WhatsApp.
          It asks for the basics and hands the owner over to the office number,
          which is what starts their updates on buyers, visits and offers. Not a
          WhatsApp template — nothing here goes to Meta for approval.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            Reading your settings…
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                What the first ask carries
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {OWNER_DETAILS_SECTIONS.map((section) => (
                  <button
                    key={section}
                    disabled={!canEdit}
                    onClick={() => toggleSection(section)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      effectiveSections.includes(section)
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-slate-800 text-slate-500 hover:bg-slate-800'
                    )}
                  >
                    {OWNER_DETAILS_SECTION_TITLES[section]}
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-slate-500">
                Papers are off by default: documents change hands after a buyer
                is finalised and the token is paid, and asking a seller for a
                title deed in the opening message reads as distrust. Agents can
                still turn them on for a single send. A section that makes no
                sense for a property is dropped automatically — a plot is never
                asked what is built on it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                Your own wording{' '}
                <span className="font-normal text-slate-500">(optional)</span>
              </Label>
              <Textarea
                value={bodyTemplate}
                disabled={!canEdit}
                onChange={(e) => setBodyTemplate(e.target.value)}
                placeholder="Leave empty to use the built-in message shown below."
                className="focus-visible:border-primary focus-visible:ring-primary min-h-[160px] resize-none border-slate-700 bg-slate-800 text-xs leading-relaxed text-slate-100 focus-visible:ring-1"
              />
              <p className="text-[10px] leading-relaxed text-slate-500">
                Placeholders:{' '}
                {OWNER_DETAILS_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' · ')}.
                Keep <code className="text-slate-400">{'{{checklist}}'}</code>{' '}
                so the questions still follow the property type, and{' '}
                <code className="text-slate-400">{'{{engine_link}}'}</code> so
                the owner can still reach your office number in one tap.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300">
                Preview
              </Label>
              <pre className="max-h-64 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">
                {preview}
              </pre>
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={save}
                  disabled={saving}
                  className="h-9 gap-1.5 rounded-lg text-xs font-bold"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={resetToBuiltIn}
                  disabled={saving}
                  className="h-9 gap-1.5 rounded-lg border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  <RotateCcw className="size-3.5" />
                  Back to the built-in message
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
