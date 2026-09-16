import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import {
  DEAL_DOCUMENT_MIME_TYPES,
  dealDocumentRejection,
  documentSizeLabel,
  type DealDocumentRow,
} from '@/lib/deal-workspace';
import {
  deleteDealDocument,
  fetchDealDocumentUrl,
  fetchDealDocuments,
  uploadDealDocument,
} from '@/lib/deal-workspace-api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Brokerage paperwork on the phone, mirroring the web's DealInvoices.
 *
 * Invoice files are one category of the deal's document folder rather
 * than a store of their own, so this reads and writes deal_documents.
 * The bucket is private: nothing here holds a URL, and a link is minted
 * per open and never cached.
 */
export function DealInvoices({ dealId }: { dealId: string }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const { show, close, dialogProps } = useAppDialog();

  const queryKey = ['deal-documents', dealId, 'invoice'];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchDealDocuments(dealId, 'invoice'),
  });
  const invoices = data ?? [];

  async function addFile() {
    if (busy) return;
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = await import('expo-document-picker');
    } catch {
      show({
        title: 'Update the app',
        message:
          'Attaching an invoice needs the latest ConvoReal build. Install the newest version, then try again.',
      });
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: [...DEAL_DOCUMENT_MIME_TYPES],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType || 'application/pdf';
    // Some document providers report no size at all. Treating that as
    // zero rejected a perfectly good file as empty, so an unknown size
    // is left to the server, which measures the bytes it receives.
    const rejection = dealDocumentRejection(mimeType, asset.size ?? null);
    if (rejection) {
      show({ title: 'Cannot attach that', message: rejection });
      return;
    }

    setBusy(true);
    haptic.tap();
    try {
      await uploadDealDocument(
        dealId,
        {
          uri: asset.uri,
          name: asset.name || 'invoice.pdf',
          mimeType,
        },
        'invoice'
      );
      await queryClient.invalidateQueries({ queryKey });
      haptic.success();
    } catch (err) {
      haptic.warn();
      show({
        title: 'Upload failed',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: DealDocumentRow) {
    try {
      await Linking.openURL(await fetchDealDocumentUrl(dealId, doc.id));
    } catch (err) {
      show({
        title: 'Could not open it',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }

  async function remove(docId: string) {
    setRemoving(docId);
    try {
      await deleteDealDocument(dealId, docId);
      await queryClient.invalidateQueries({ queryKey });
      haptic.success();
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not remove it',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    } finally {
      setRemoving(null);
    }
  }

  function confirmRemove(invoice: DealDocumentRow) {
    show({
      title: 'Remove this invoice?',
      message: `“${invoice.title}” stops being attached to this deal, and the file is deleted.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => {
            close();
            void remove(invoice.id);
          },
        },
      ],
    });
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Invoices" />

      {isLoading ? (
        <ActivityIndicator size="small" color={colors.textFaint} />
      ) : invoices.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          No invoice attached yet. Add the brokerage invoice or its receipt — it
          is filed in the deal&apos;s document folder.
        </Text>
      ) : (
        invoices.map((invoice) => (
          <Pressable
            key={invoice.id}
            onPress={() => void open(invoice)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${invoice.title}`}
            style={[
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons name="receipt-outline" size={18} color={colors.primary} />
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 13.5,
                fontFamily: f.medium,
                color: colors.text,
              }}
            >
              {invoice.title}
            </Text>
            {(invoice.size_bytes ?? 0) > 0 ? (
              <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
                {documentSizeLabel(invoice.size_bytes ?? 0)}
              </Text>
            ) : null}
            {removing === invoice.id ? (
              <ActivityIndicator size="small" color={colors.textFaint} />
            ) : (
              <Pressable
                onPress={() => confirmRemove(invoice)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${invoice.title}`}
              >
                <Ionicons name="close" size={17} color={colors.textFaint} />
              </Pressable>
            )}
          </Pressable>
        ))
      )}

      <Pressable
        onPress={() => void addFile()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Upload an invoice"
        style={[
          styles.action,
          { backgroundColor: colors.primarySoft, opacity: busy ? 0.5 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="attach-outline" size={16} color={colors.primary} />
        )}
        <Text
          style={{
            fontSize: 12.5,
            fontFamily: f.semibold,
            color: colors.primary,
          }}
        >
          {busy ? 'Uploading…' : 'Upload invoice'}
        </Text>
      </Pressable>

      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
});
