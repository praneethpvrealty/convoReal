'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { GST_STATE_CODES } from '@/lib/invoices/gst';
import { formatIndianDigits } from '@/lib/invoices/pdf-text';
import type { Invoice, InvoiceSide } from '@/lib/invoices/types';

interface InvoiceEditorProps {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function InvoiceEditor({
  invoiceId,
  open,
  onOpenChange,
  onSaved,
}: InvoiceEditorProps) {
  const [saving, setSaving] = useState(false);

  const [invoiceDate, setInvoiceDate] = useState('');
  const [side, setSide] = useState<InvoiceSide>('buyer');
  const [sharePercent, setSharePercent] = useState('50');
  const [billToName, setBillToName] = useState('');
  const [addressLines, setAddressLines] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [placeCode, setPlaceCode] = useState('');
  const [particulars, setParticulars] = useState('');
  const [sac, setSac] = useState('');
  const [taxableValue, setTaxableValue] = useState('');
  const [notes, setNotes] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async (): Promise<Invoice> => {
      const response = await fetch(`/api/invoices/${invoiceId}`);
      const json = await response.json();
      if (!response.ok)
        throw new Error(json?.error || 'Could not load the invoice');
      return json.data;
    },
    enabled: open,
  });

  // Prop-driven sync: the form mirrors the fetched invoice once it
  // arrives, the same pattern deal-form.tsx uses.
  useEffect(() => {
    if (!invoice) return;
    setInvoiceDate(invoice.invoice_date ?? '');
    setSide(invoice.side ?? 'buyer');
    setSharePercent(String(invoice.share_percent ?? 100));
    setBillToName(invoice.bill_to?.name ?? '');
    setAddressLines((invoice.bill_to?.address_lines ?? []).join('\n'));
    setGstin(invoice.bill_to?.gstin ?? '');
    setPan(invoice.bill_to?.pan ?? '');
    setPoNumber(invoice.bill_to?.po_number ?? '');
    setPlaceCode(invoice.place_of_supply_code ?? '');
    const line = invoice.line_items?.[0];
    setParticulars((line?.particulars ?? []).join('\n'));
    setSac(line?.sac ?? '');
    setTaxableValue(String(line?.taxable_value ?? ''));
    setNotes(invoice.notes ?? '');
  }, [invoice]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_date: invoiceDate,
          side,
          share_percent: Number(sharePercent) || 100,
          place_of_supply_code: placeCode,
          notes: notes.trim() || null,
          bill_to: {
            name: billToName,
            address_lines: addressLines
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
            gstin,
            pan,
            po_number: poNumber,
            email: invoice?.bill_to?.email ?? null,
            phone: invoice?.bill_to?.phone ?? null,
          },
          line_items: [
            {
              sac,
              particulars: particulars
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
              taxable_value: Number(taxableValue) || 0,
            },
          ],
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || 'Could not save');
      onSaved();
      toast.success('Draft saved.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const preview = Number(taxableValue) || 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review invoice</SheetTitle>
        </SheetHeader>

        {isLoading || !invoice ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-5 p-4">
            <p className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
              Filled in from the deal. Change anything that is wrong — once you
              issue it, this invoice takes a number and can only be cancelled,
              not edited.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="invoice-date">Invoice date</Label>
                <Input
                  id="invoice-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="invoice-side">Billing</Label>
                <select
                  id="invoice-side"
                  className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                  value={side}
                  onChange={(e) => setSide(e.target.value as InvoiceSide)}
                >
                  <option value="buyer">Buyer side</option>
                  <option value="seller">Seller side</option>
                  <option value="both">Both sides</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="share">
                Share of the deal&apos;s brokerage (%)
              </Label>
              <Input
                id="share"
                type="number"
                min="1"
                max="100"
                value={sharePercent}
                onChange={(e) => setSharePercent(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                50 bills half the brokerage to this side and leaves the rest for
                the other. Changing this does not recalculate the amount below —
                edit that directly.
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Customer
              </p>
              <div>
                <Label htmlFor="bill-to">Name</Label>
                <Input
                  id="bill-to"
                  value={billToName}
                  onChange={(e) => setBillToName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="address">Address (one line per row)</Label>
                <Textarea
                  id="address"
                  rows={3}
                  value={addressLines}
                  onChange={(e) => setAddressLines(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Input
                    id="gstin"
                    value={gstin}
                    placeholder="NA"
                    onChange={(e) => setGstin(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pan">PAN</Label>
                  <Input
                    id="pan"
                    value={pan}
                    placeholder="NA"
                    onChange={(e) => setPan(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="po">Customer PO #</Label>
                  <Input
                    id="po"
                    value={poNumber}
                    placeholder="NA"
                    onChange={(e) => setPoNumber(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="place">Place of supply</Label>
                  <select
                    id="place"
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white"
                    value={placeCode}
                    onChange={(e) => setPlaceCode(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {GST_STATE_CODES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Line item
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="sac">SAC</Label>
                  <Input
                    id="sac"
                    value={sac}
                    onChange={(e) => setSac(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="amount">Taxable value</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={taxableValue}
                    onChange={(e) => setTaxableValue(e.target.value)}
                  />
                  {preview > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Rs. {formatIndianDigits(preview)}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor="particulars">
                  Particulars (one line per row)
                </Label>
                <Textarea
                  id="particulars"
                  rows={4}
                  value={particulars}
                  onChange={(e) => setParticulars(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes on the invoice</Label>
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <a
                href={`/api/invoices/${invoiceId}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline">Preview PDF</Button>
              </a>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save draft
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
