import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import {
  fetchInvoice,
  updateInvoice,
  type InvoiceDraftPatch,
} from '@/lib/deal-workspace-api';
import type { InvoiceDetail, InvoiceSide } from '@/lib/deal-workspace';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

const SIDES: { value: InvoiceSide; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'both', label: 'Both' },
];

/**
 * Review a draft before it becomes a legal document.
 *
 * Mobile used to send the agent to the web app for this while still
 * offering Issue, which meant a mobile-only agent could only either
 * issue an imperfect prefill or not invoice at all. Every field the web
 * editor exposes is here, over the same API — no rule is re-implemented
 * natively, and the server re-derives every total (root AGENTS.md §2.8).
 */
export function InvoiceEditorSheet({
  invoiceId,
  visible,
  onClose,
  onSaved,
}: {
  invoiceId: string | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => fetchInvoice(invoiceId as string),
    enabled: visible && Boolean(invoiceId),
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Review invoice">
      {isLoading || !invoice ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        // Keyed on the invoice so opening a different draft remounts the
        // form. The fields below initialise straight from `invoice`,
        // which is why there is no effect copying props into state.
        <InvoiceForm
          key={invoice.id}
          invoice={invoice}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </BottomSheet>
  );
}

function InvoiceForm({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: InvoiceDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const invoiceId = invoice.id;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date ?? '');
  const [side, setSide] = useState<InvoiceSide>(invoice.side ?? 'buyer');
  const [sharePercent, setSharePercent] = useState(
    String(invoice.share_percent ?? 100)
  );
  const [name, setName] = useState(invoice.bill_to?.name ?? '');
  const [address, setAddress] = useState(
    (invoice.bill_to?.address_lines ?? []).join('\n')
  );
  const [gstin, setGstin] = useState(invoice.bill_to?.gstin ?? '');
  const [pan, setPan] = useState(invoice.bill_to?.pan ?? '');
  const [sac, setSac] = useState(invoice.line_items?.[0]?.sac ?? '');
  const [particulars, setParticulars] = useState(
    (invoice.line_items?.[0]?.particulars ?? []).join('\n')
  );
  const [amount, setAmount] = useState(
    String(invoice.line_items?.[0]?.taxable_value ?? '')
  );
  const [chargeGst, setChargeGst] = useState(invoice.gst_mode !== 'nil');
  const [gstRate, setGstRate] = useState(String(invoice.gst_rate || 18));
  const [notes, setNotes] = useState(invoice.notes ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const patch: InvoiceDraftPatch = {
        invoice_date: invoiceDate,
        side,
        share_percent: Number(sharePercent) || 100,
        gst_mode: chargeGst ? 'intra' : 'nil',
        gst_rate: chargeGst ? Number(gstRate) || 0 : 0,
        notes: notes.trim() || null,
        bill_to: {
          name,
          address_lines: address
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          gstin,
          pan,
        },
        line_items: [
          {
            sac,
            particulars: particulars
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
            taxable_value: Number(amount) || 0,
          },
        ],
      };
      await updateInvoice(invoiceId, patch);
      void haptic.success();
      onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={sheetScrollArea} contentContainerStyle={styles.body}>
      <Text
        style={[
          styles.hint,
          { color: colors.textMuted, fontFamily: f.regular },
        ]}
      >
        Filled in from the deal. Once you issue it this invoice takes a number
        and can only be cancelled, not edited.
      </Text>

      <TextField
        label="Invoice date"
        value={invoiceDate}
        onChangeText={setInvoiceDate}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
      />

      <View>
        <SectionLabel text="Billing" style={{ color: colors.textMuted }} />
        <View style={styles.sideRow}>
          {SIDES.map((option) => {
            const active = side === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setSide(option.value)}
                style={[
                  styles.sideChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontFamily: f.semibold,
                    fontSize: 13,
                    color: active ? colors.onPrimary : colors.text,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextField
        label="Share of the deal's brokerage (%)"
        value={sharePercent}
        onChangeText={setSharePercent}
        keyboardType="numeric"
      />
      <Text
        style={[
          styles.hint,
          { color: colors.textFaint, fontFamily: f.regular },
        ]}
      >
        Changing this re-prices the amount below from the deal.
      </Text>

      <TextField label="Customer name" value={name} onChangeText={setName} />
      <TextField
        label="Address (one line per row)"
        value={address}
        onChangeText={setAddress}
        multiline
      />
      <TextField
        label="GSTIN"
        value={gstin}
        onChangeText={setGstin}
        placeholder="NA"
        autoCapitalize="characters"
      />
      <TextField
        label="PAN"
        value={pan}
        onChangeText={setPan}
        placeholder="NA"
        autoCapitalize="characters"
      />

      <View style={styles.toggleRow}>
        <View style={styles.toggleLabel}>
          <Text
            style={{ color: colors.text, fontFamily: f.semibold, fontSize: 14 }}
          >
            Charge GST
          </Text>
          <Text
            style={[
              styles.hint,
              { color: colors.textFaint, fontFamily: f.regular },
            ]}
          >
            {chargeGst
              ? 'CGST + SGST within your state, IGST outside it.'
              : 'Raised without tax, with your exemption note printed.'}
          </Text>
        </View>
        <Switch
          value={chargeGst}
          onValueChange={setChargeGst}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {chargeGst && (
        <TextField
          label="GST rate (%)"
          value={gstRate}
          onChangeText={setGstRate}
          keyboardType="numeric"
        />
      )}

      <TextField label="SAC" value={sac} onChangeText={setSac} />
      <TextField
        label="Taxable value"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
      />
      <TextField
        label="Particulars (one line per row)"
        value={particulars}
        onChangeText={setParticulars}
        multiline
      />
      <TextField
        label="Notes on the invoice"
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      {error ? (
        <Text
          style={{ color: colors.danger, fontFamily: f.regular, fontSize: 13 }}
        >
          {error}
        </Text>
      ) : null}

      <PrimaryButton
        label={saving ? 'Saving…' : 'Save draft'}
        onPress={save}
        disabled={saving}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { padding: spacing.xl, alignItems: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.xl },
  hint: { fontSize: 12, lineHeight: 17 },
  sideRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleLabel: { flex: 1, gap: 2 },
  sideChip: {
    flex: 1,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
});
