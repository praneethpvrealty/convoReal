'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { GST_STATE_CODES } from '@/lib/invoices/gst';
import type {
  GstMode,
  InvoiceSettings,
  SignatureMode,
} from '@/lib/invoices/types';

/**
 * The letterhead every invoice prints from.
 *
 * Admin-and-above, because these fields decide where a customer is told
 * to send money — the API enforces that too.
 */
export function InvoiceSettingsCard() {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    legal_name: '',
    address_lines: '',
    rera_number: '',
    pan: '',
    gstin: '',
    state_code: '',
    default_sac: '',
    default_particulars: '',
    default_share_percent: '50',
    gst_mode: 'nil' as GstMode,
    gst_rate: '0',
    gst_note: '',
    bank_account_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    signatory_label: '',
    signatory_name: '',
    signatory_designation: '',
    signature_place: '',
    signature_mode: 'image' as SignatureMode,
    number_prefix: '',
    starting_number: '1',
    number_resets_yearly: true,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['invoice-settings'],
    queryFn: async (): Promise<InvoiceSettings> => {
      const response = await fetch('/api/invoice-settings');
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load settings');
      return json.data;
    },
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      legal_name: settings.legal_name ?? '',
      address_lines: (settings.address_lines ?? []).join('\n'),
      rera_number: settings.rera_number ?? '',
      pan: settings.pan ?? '',
      gstin: settings.gstin ?? '',
      state_code: settings.state_code ?? '',
      default_sac: settings.default_sac ?? '',
      default_particulars: settings.default_particulars ?? '',
      default_share_percent: String(settings.default_share_percent ?? 50),
      gst_mode: settings.gst_mode ?? 'nil',
      gst_rate: String(settings.gst_rate ?? 0),
      gst_note: settings.gst_note ?? '',
      bank_account_name: settings.bank_account_name ?? '',
      bank_name: settings.bank_name ?? '',
      bank_account_number: settings.bank_account_number ?? '',
      bank_ifsc: settings.bank_ifsc ?? '',
      signatory_label: settings.signatory_label ?? '',
      signatory_name: settings.signatory_name ?? '',
      signatory_designation: settings.signatory_designation ?? '',
      signature_place: settings.signature_place ?? '',
      signature_mode: settings.signature_mode ?? 'image',
      number_prefix: settings.number_prefix ?? '',
      starting_number: String(settings.starting_number ?? 1),
      number_resets_yearly: settings.number_resets_yearly ?? true,
    });
  }, [settings]);

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/invoice-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          address_lines: form.address_lines
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          gst_rate: Number(form.gst_rate) || 0,
          default_share_percent: Number(form.default_share_percent) || 50,
          starting_number: Number(form.starting_number) || 1,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Could not save');
      toast.success('Invoice settings saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invoice settings…
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-center gap-2">
        <Receipt className="text-primary h-5 w-5" />
        <div>
          <h3 className="text-sm font-semibold text-white">Invoicing</h3>
          <p className="text-xs text-slate-400">
            Printed on every brokerage invoice you raise.
          </p>
        </div>
      </div>

      <Section title="Letterhead">
        <Field label="Firm name" id="legal_name">
          <Input
            id="legal_name"
            value={form.legal_name}
            onChange={(e) => set('legal_name', e.target.value)}
          />
        </Field>
        <Field label="Address (one line per row)" id="address_lines">
          <Textarea
            id="address_lines"
            rows={2}
            value={form.address_lines}
            onChange={(e) => set('address_lines', e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="RERA No." id="rera_number">
            <Input
              id="rera_number"
              value={form.rera_number}
              onChange={(e) => set('rera_number', e.target.value)}
            />
          </Field>
          <Field label="PAN" id="pan">
            <Input
              id="pan"
              value={form.pan}
              onChange={(e) => set('pan', e.target.value)}
            />
          </Field>
          <Field label="Your state" id="state_code">
            <select
              id="state_code"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
              value={form.state_code}
              onChange={(e) => set('state_code', e.target.value)}
            >
              <option value="">Not set</option>
              {GST_STATE_CODES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Tax">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="GST" id="gst_mode">
            <select
              id="gst_mode"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
              value={form.gst_mode}
              onChange={(e) => set('gst_mode', e.target.value)}
            >
              <option value="nil">Not registered / NIL</option>
              <option value="intra">Registered</option>
            </select>
          </Field>
          <Field label="Rate (%)" id="gst_rate">
            <Input
              id="gst_rate"
              type="number"
              value={form.gst_rate}
              disabled={form.gst_mode === 'nil'}
              onChange={(e) => set('gst_rate', e.target.value)}
            />
          </Field>
          <Field label="GSTIN" id="gstin">
            <Input
              id="gstin"
              value={form.gstin}
              disabled={form.gst_mode === 'nil'}
              onChange={(e) => set('gstin', e.target.value)}
            />
          </Field>
        </div>
        {form.gst_mode === 'nil' && (
          <Field label="Exemption note printed on the invoice" id="gst_note">
            <Textarea
              id="gst_note"
              rows={2}
              value={form.gst_note}
              onChange={(e) => set('gst_note', e.target.value)}
            />
          </Field>
        )}
        <p className="text-[11px] text-slate-500">
          Whether a supply is CGST+SGST or IGST is decided per invoice by
          comparing your state with the place of supply.
        </p>
      </Section>

      <Section title="Defaults">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="SAC code" id="default_sac">
            <Input
              id="default_sac"
              value={form.default_sac}
              onChange={(e) => set('default_sac', e.target.value)}
            />
          </Field>
          <Field label="Service description" id="default_particulars">
            <Input
              id="default_particulars"
              value={form.default_particulars}
              onChange={(e) => set('default_particulars', e.target.value)}
            />
          </Field>
          <Field label="Share billed per side (%)" id="default_share_percent">
            <Input
              id="default_share_percent"
              type="number"
              min="1"
              max="100"
              value={form.default_share_percent}
              onChange={(e) => set('default_share_percent', e.target.value)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">
          50 means each invoice bills half the deal&apos;s brokerage, so buyer
          and seller get one each. Set 100 if you charge one side only.
        </p>
      </Section>

      <Section title="Numbering">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Prefix (optional)" id="number_prefix">
            <Input
              id="number_prefix"
              value={form.number_prefix}
              placeholder="e.g. PVC"
              onChange={(e) => set('number_prefix', e.target.value)}
            />
          </Field>
          <Field label="Series starts at" id="starting_number">
            <Input
              id="starting_number"
              type="number"
              min="1"
              value={form.starting_number}
              onChange={(e) => set('starting_number', e.target.value)}
            />
          </Field>
          <Field label="Restart each year" id="number_resets_yearly">
            <select
              id="number_resets_yearly"
              className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
              value={form.number_resets_yearly ? 'yes' : 'no'}
              onChange={(e) =>
                set('number_resets_yearly', e.target.value === 'yes')
              }
            >
              <option value="yes">Yes — restart each April</option>
              <option value="no">No — one running series</option>
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-slate-500">
          Numbers come out as{' '}
          <span className="text-slate-300">
            {form.number_prefix ? `${form.number_prefix}/` : ''}
            {form.starting_number || '1'}/2026-27
          </span>
          . The next number is worked out from the invoices you have already
          issued, so it can never collide.
        </p>
      </Section>

      <Section title="Signature">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Signatory name" id="signatory_name">
            <Input
              id="signatory_name"
              value={form.signatory_name}
              onChange={(e) => set('signatory_name', e.target.value)}
            />
          </Field>
          <Field label="Designation" id="signatory_designation">
            <Input
              id="signatory_designation"
              value={form.signatory_designation}
              onChange={(e) => set('signatory_designation', e.target.value)}
            />
          </Field>
          <Field label="Place" id="signature_place">
            <Input
              id="signature_place"
              value={form.signature_place}
              onChange={(e) => set('signature_place', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Signature type" id="signature_mode">
          <select
            id="signature_mode"
            className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
            value={form.signature_mode}
            onChange={(e) => set('signature_mode', e.target.value)}
          >
            <option value="image">Electronic signature with audit trail</option>
            <option value="none">Unsigned — I print and sign by hand</option>
          </select>
        </Field>
        <p className="text-[11px] text-slate-500">
          An electronic signature records who issued each invoice, when, and a
          SHA-256 of the exact document. A Class 3 DSC or Aadhaar eSign needs a
          certificate from a licensed provider — see
          docs/invoice-digital-signature.md.
        </p>
      </Section>

      <Section title="Bank details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name" id="bank_account_name">
            <Input
              id="bank_account_name"
              value={form.bank_account_name}
              onChange={(e) => set('bank_account_name', e.target.value)}
            />
          </Field>
          <Field label="Bank" id="bank_name">
            <Input
              id="bank_name"
              value={form.bank_name}
              onChange={(e) => set('bank_name', e.target.value)}
            />
          </Field>
          <Field label="Account number" id="bank_account_number">
            <Input
              id="bank_account_number"
              value={form.bank_account_number}
              onChange={(e) => set('bank_account_number', e.target.value)}
            />
          </Field>
          <Field label="IFSC" id="bank_ifsc">
            <Input
              id="bank_ifsc"
              value={form.bank_ifsc}
              onChange={(e) => set('bank_ifsc', e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <div className="flex justify-end border-t border-slate-800 pt-4">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save invoice settings
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-slate-800 pt-4 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
