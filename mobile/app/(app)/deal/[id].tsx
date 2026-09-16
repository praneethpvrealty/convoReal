import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { InvoiceEditorSheet } from '@/components/invoice-editor-sheet';
import { EmptyState, FilterChip } from '@/components/ui';
import { apiBase, authHeaders } from '@/lib/api';
import {
  categoryLabel,
  extractionEntries,
  isReadable,
  DEAL_DOCUMENT_CATEGORIES,
  INVOICE_STATUS_LABELS,
  type DealDocumentCategory,
  type DealDocumentRow,
  type InvoiceRow,
} from '@/lib/deal-workspace';
import {
  createInvoice,
  deleteDealDocument,
  extractDocument,
  fetchDealDocumentUrl,
  fetchDealDocuments,
  fetchInvoices,
  invoiceAction,
  uploadDealDocument,
} from '@/lib/deal-workspace-api';
import { friendlyError } from '@/lib/errors';
import { auditDate, formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme, fonts } from '@/lib/theme';

type TabId = 'invoices' | 'documents';

/** `friendlyError` takes the message text, and a rejected fetch can throw
 *  anything — so narrow it once here rather than at every call site. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function DealWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dealId = typeof id === 'string' ? id : '';
  const { colors } = useTheme();
  const [tab, setTab] = useState<TabId>('invoices');

  return (
    <>
      <Stack.Screen options={{ title: 'Deal folder' }} />
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.tabs}>
          <FilterChip
            label="Invoices"
            active={tab === 'invoices'}
            onPress={() => setTab('invoices')}
          />
          <FilterChip
            label="Documents"
            active={tab === 'documents'}
            onPress={() => setTab('documents')}
          />
        </View>
        {tab === 'invoices' ? (
          <InvoicesTab dealId={dealId} />
        ) : (
          <DocumentsTab dealId={dealId} />
        )}
      </View>
    </>
  );
}

function InvoicesTab({ dealId }: { dealId: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['deal-invoices', dealId],
    queryFn: () => fetchInvoices(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-invoices', dealId] });

  async function create() {
    setBusy('new');
    try {
      const draft = await createInvoice(dealId);
      await refresh();
      void haptic.success();
      // Straight into the editor: an agent has to be able to correct
      // the prefill before issuing makes it immutable.
      setEditingId(draft.id);
    } catch (err) {
      dialog.show({
        title: 'Could not create',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function act(
    invoice: InvoiceRow,
    action: 'issue' | 'cancel' | 'mark-paid' | 'send',
    body: Record<string, unknown>,
    successTitle: string
  ) {
    setBusy(invoice.id);
    try {
      await invoiceAction(invoice.id, action, body);
      await refresh();
      void haptic.success();
      dialog.show({ title: successTitle, message: '' });
    } catch (err) {
      dialog.show({
        title: 'That did not work',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Download the PDF through the authed route and hand it to the share
   * sheet. The bucket is private, so there is no URL a viewer could open
   * directly — the bearer token has to travel with the request.
   */
  async function sharePdf(invoice: InvoiceRow) {
    setBusy(invoice.id);
    try {
      const file = await File.downloadFileAsync(
        `${apiBase()}/api/invoices/${invoice.id}/pdf?download=1`,
        new File(Paths.cache, `invoice-${invoice.id}.pdf`),
        { headers: await authHeaders(), idempotent: true }
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf' });
      }
    } catch (err) {
      dialog.show({
        title: 'Could not open',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return <Loading />;
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Pressable
        onPress={create}
        disabled={busy === 'new'}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
      >
        {busy === 'new' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name="add" size={18} color="#fff" />
        )}
        <Text style={styles.primaryButtonText}>New invoice</Text>
      </Pressable>

      {invoices.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No invoices yet"
          subtitle="A new invoice fills itself in from this deal's value, brokerage rate and property."
        />
      ) : (
        invoices.map((invoice) => (
          <View
            key={invoice.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {invoice.invoice_number ?? 'Draft'}
                </Text>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  {INVOICE_STATUS_LABELS[invoice.status]} · {invoice.side} ·{' '}
                  {invoice.share_percent}%
                </Text>
                <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                  {invoice.bill_to?.name ?? 'No customer name'} ·{' '}
                  {auditDate(invoice.invoice_date)}
                </Text>
              </View>
              <Text style={[styles.amount, { color: colors.text }]}>
                {formatInr(invoice.grand_total)}
              </Text>
            </View>

            <View style={styles.actions}>
              {invoice.status === 'draft' && (
                <>
                  <ActionButton
                    label="Review"
                    icon="create-outline"
                    busy={false}
                    onPress={() => setEditingId(invoice.id)}
                  />
                  <ActionButton
                    label="Issue"
                    icon="checkmark-circle-outline"
                    busy={busy === invoice.id}
                    onPress={() =>
                      act(invoice, 'issue', {}, 'Issued and numbered')
                    }
                  />
                </>
              )}
              {invoice.status !== 'draft' && (
                <ActionButton
                  label="PDF"
                  icon="document-outline"
                  busy={busy === invoice.id}
                  onPress={() => sharePdf(invoice)}
                />
              )}
              {(invoice.status === 'issued' || invoice.status === 'sent') && (
                <>
                  <ActionButton
                    label="WhatsApp"
                    icon="logo-whatsapp"
                    busy={busy === invoice.id}
                    onPress={() =>
                      act(invoice, 'send', { channel: 'whatsapp' }, 'Sent')
                    }
                  />
                  <ActionButton
                    label="Mark paid"
                    icon="wallet-outline"
                    busy={busy === invoice.id}
                    onPress={() => act(invoice, 'mark-paid', {}, 'Marked paid')}
                  />
                </>
              )}
              {invoice.status !== 'draft' && invoice.status !== 'cancelled' && (
                <ActionButton
                  label="Cancel"
                  icon="ban-outline"
                  busy={busy === invoice.id}
                  onPress={() =>
                    dialog.show({
                      title: `Cancel ${invoice.invoice_number}?`,
                      message:
                        'The number stays in your series so the books have no gap.',
                      actions: [
                        {
                          label: 'Keep it',
                          onPress: dialog.close,
                          variant: 'muted',
                        },
                        {
                          label: 'Cancel invoice',
                          variant: 'destructive',
                          onPress: () => {
                            dialog.close();
                            void act(
                              invoice,
                              'cancel',
                              {},
                              'Invoice cancelled'
                            );
                          },
                        },
                      ],
                    })
                  }
                />
              )}
            </View>
          </View>
        ))
      )}
      <InvoiceEditorSheet
        invoiceId={editingId}
        visible={editingId !== null}
        onClose={() => setEditingId(null)}
        onSaved={refresh}
      />
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function DocumentsTab({ dealId }: { dealId: string }) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const dialog = useAppDialog();
  const [category, setCategory] = useState<DealDocumentCategory>('identity');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['deal-documents', dealId],
    queryFn: () => fetchDealDocuments(dealId),
    enabled: Boolean(dealId),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });

  async function pickAndUpload() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    setBusy('upload');
    try {
      await uploadDealDocument(
        dealId,
        {
          uri: asset.uri,
          name: asset.name || 'document',
          mimeType: asset.mimeType || 'application/octet-stream',
        },
        category
      );
      await refresh();
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Upload failed',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function openDocument(doc: DealDocumentRow) {
    setBusy(`open:${doc.id}`);
    try {
      await Linking.openURL(await fetchDealDocumentUrl(dealId, doc.id));
    } catch (err) {
      dialog.show({
        title: 'Could not open it',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function read(doc: DealDocumentRow) {
    setBusy(doc.id);
    try {
      await extractDocument(dealId, doc.id);
      await refresh();
      setExpanded(doc.id);
      void haptic.success();
    } catch (err) {
      dialog.show({
        title: 'Could not read',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(doc: DealDocumentRow) {
    setBusy(doc.id);
    try {
      await deleteDealDocument(dealId, doc.id);
      await refresh();
    } catch (err) {
      dialog.show({
        title: 'Could not delete',
        message: friendlyError(errorText(err)),
      });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {DEAL_DOCUMENT_CATEGORIES.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={category === option.value}
            onPress={() => setCategory(option.value)}
          />
        ))}
      </ScrollView>

      <Pressable
        onPress={pickAndUpload}
        disabled={busy === 'upload'}
        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
      >
        {busy === 'upload' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
        )}
        <Text style={styles.primaryButtonText}>Upload document</Text>
      </Pressable>

      {documents.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title="Nothing filed yet"
          subtitle="Aadhaars, agreement drafts and old sale deeds. Stored privately."
        />
      ) : (
        documents.map((doc) => {
          const entries = extractionEntries(doc.extracted);
          return (
            <View
              key={doc.id}
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                {doc.title}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                {categoryLabel(doc.category)}
                {doc.size_bytes
                  ? ` · ${Math.max(1, Math.round(doc.size_bytes / 1024))} KB`
                  : ''}
              </Text>

              <View style={styles.actions}>
                <ActionButton
                  label="Open"
                  icon="open-outline"
                  busy={busy === `open:${doc.id}`}
                  onPress={() => openDocument(doc)}
                />
                {isReadable(doc.mime_type) && (
                  <ActionButton
                    label={doc.extracted ? 'Read again' : 'Read with AI'}
                    icon="sparkles-outline"
                    busy={busy === doc.id}
                    onPress={() => read(doc)}
                  />
                )}
                {entries.length > 0 && (
                  <ActionButton
                    label={expanded === doc.id ? 'Hide' : 'Show read-out'}
                    icon="list-outline"
                    busy={false}
                    onPress={() =>
                      setExpanded(expanded === doc.id ? null : doc.id)
                    }
                  />
                )}
                <ActionButton
                  label="Delete"
                  icon="trash-outline"
                  busy={busy === doc.id}
                  onPress={() =>
                    dialog.show({
                      title: `Delete "${doc.title}"?`,
                      message: 'This cannot be undone.',
                      actions: [
                        {
                          label: 'Keep',
                          onPress: dialog.close,
                          variant: 'muted',
                        },
                        {
                          label: 'Delete',
                          variant: 'destructive',
                          onPress: () => {
                            dialog.close();
                            void remove(doc);
                          },
                        },
                      ],
                    })
                  }
                />
              </View>

              {doc.extraction_status === 'failed' && (
                <Text style={[styles.cardMeta, { color: colors.danger }]}>
                  Could not read this one. Your credits were refunded.
                </Text>
              )}

              {expanded === doc.id && entries.length > 0 && (
                <View style={styles.extraction}>
                  <Text style={[styles.warning, { color: colors.warning }]}>
                    Check every value against the document before using it.
                  </Text>
                  {entries.map((entry) => (
                    <View key={entry.key} style={styles.extractionRow}>
                      <Text
                        style={[
                          styles.extractionLabel,
                          { color: colors.textMuted },
                        ]}
                      >
                        {entry.label}
                      </Text>
                      <Text
                        style={[styles.extractionValue, { color: colors.text }]}
                      >
                        {entry.value}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })
      )}
      <AppDialog {...dialog.dialogProps} />
    </ScrollView>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[styles.actionButton, { borderColor: colors.border }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Ionicons name={icon} size={15} color={colors.textMuted} />
      )}
      <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Loading() {
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  chipRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: '#fff',
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  amount: { fontFamily: fonts.bold, fontSize: 16 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  actionLabel: { fontFamily: fonts.medium, fontSize: 12 },
  extraction: { marginTop: spacing.sm, gap: spacing.sm },
  warning: { fontFamily: fonts.medium, fontSize: 11 },
  extractionRow: { gap: 2 },
  extractionLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  extractionValue: { fontFamily: fonts.regular, fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
