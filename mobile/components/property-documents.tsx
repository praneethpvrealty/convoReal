import { Ionicons } from '@expo/vector-icons';
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
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import {
  parsePropertyDocuments,
  DOCUMENT_SIZE_LIMIT,
} from '@/lib/property-documents';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { storagePublicUrl } from '@/lib/storage-url';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';

const BUCKET = 'property-documents';

/**
 * Property documents on the phone: list what is attached, open one, add
 * a file from the device or a photo of a physical paper, remove one.
 *
 * The upload mirrors PropertyPhotoEditor — straight to the Supabase
 * bucket under the account's folder, storing the bucket-relative path
 * the web form writes — and the array is then saved through the same
 * PUT /api/properties/[id] the edit screen uses, which already accepts
 * `documents`.
 *
 * Buyer-facing access requests (approve / deny / 48-hour links) stay on
 * the web dashboard: they are rare, deliberate, and the notification
 * already reaches this phone.
 */
export function PropertyDocuments({
  propertyId,
  documents,
  canEdit,
  onChanged,
}: {
  propertyId: string;
  documents: string[];
  canEdit: boolean;
  onChanged: (next: string[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const { show, close, dialogProps } = useAppDialog();

  async function persist(next: string[]) {
    await apiFetch(`/api/properties/${propertyId}`, {
      method: 'PUT',
      body: JSON.stringify({ documents: next }),
    });
    onChanged(next);
  }

  async function upload(
    bytes: Uint8Array,
    filename: string,
    contentType: string
  ) {
    const accountId = useAuthStore.getState().profile?.account_id;
    if (!accountId) {
      show({ title: 'Not signed in' });
      return;
    }
    if (bytes.byteLength > DOCUMENT_SIZE_LIMIT) {
      show({
        title: 'File too large',
        message: 'Documents can be up to 25 MB. Try a smaller scan.',
      });
      return;
    }
    setBusy(true);
    haptic.tap();
    try {
      const safe = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `${accountId}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes.buffer as ArrayBuffer, {
          contentType,
          upsert: true,
          cacheControl: '3600',
        });
      if (error) throw new Error(error.message);
      await persist([...documents, `${BUCKET}/${path}`]);
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

  async function addFile() {
    if (busy) return;
    // Loaded lazily so an older installed build that predates this
    // native module prompts to update instead of crashing at import.
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = await import('expo-document-picker');
    } catch {
      show({
        title: 'Update the app',
        message:
          'Adding documents needs the latest ConvoReal build. Install the newest version, then try again.',
      });
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const res = await fetch(asset.uri);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await upload(
        bytes,
        asset.name || `document-${Date.now()}.pdf`,
        asset.mimeType || 'application/pdf'
      );
    } catch (err) {
      show({
        title: 'Could not read that file',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }

  async function addScan() {
    if (busy) return;
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      show({
        title: 'Update the app',
        message:
          'Scanning needs the latest ConvoReal build. Install the newest version, then try again.',
      });
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      show({
        title: 'Permission needed',
        message: 'Allow camera access to photograph a document.',
      });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    const bin = atob(asset.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await upload(bytes, `scan-${Date.now()}.jpg`, 'image/jpeg');
  }

  async function remove(path: string) {
    setRemoving(path);
    try {
      await persist(documents.filter((d) => d !== path));
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

  function confirmRemove(path: string) {
    show({
      title: 'Remove this document?',
      message:
        'It stops being attached to this property. Anyone holding a share link loses access.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => {
            close();
            void remove(path);
          },
        },
      ],
    });
  }

  const attached = parsePropertyDocuments(documents);

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Documents" />

      {attached.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          No documents attached yet.
        </Text>
      ) : (
        attached.map((doc) => (
          <Pressable
            key={doc.raw}
            onPress={() => void Linking.openURL(storagePublicUrl(doc.url))}
            accessibilityRole="button"
            accessibilityLabel={`Open ${doc.label}`}
            style={[
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons
              name={
                /\.(jpg|jpeg|png|webp)$/i.test(doc.url)
                  ? 'image-outline'
                  : 'document-text-outline'
              }
              size={18}
              color={colors.primary}
            />
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 13.5,
                fontFamily: f.medium,
                color: colors.text,
              }}
            >
              {doc.label}
            </Text>
            {canEdit ? (
              removing === doc.raw ? (
                <ActivityIndicator size="small" color={colors.textFaint} />
              ) : (
                <Pressable
                  onPress={() => confirmRemove(doc.raw)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${doc.label}`}
                >
                  <Ionicons name="close" size={17} color={colors.textFaint} />
                </Pressable>
              )
            ) : null}
          </Pressable>
        ))
      )}

      {canEdit ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => void addFile()}
            disabled={busy}
            accessibilityRole="button"
            style={[
              styles.action,
              { backgroundColor: colors.primarySoft, opacity: busy ? 0.5 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name="attach-outline"
                size={16}
                color={colors.primary}
              />
            )}
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              Add file
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void addScan()}
            disabled={busy}
            accessibilityRole="button"
            style={[
              styles.action,
              { backgroundColor: colors.primarySoft, opacity: busy ? 0.5 : 1 },
            ]}
          >
            <Ionicons name="camera-outline" size={16} color={colors.primary} />
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              Scan
            </Text>
          </Pressable>
        </View>
      ) : null}

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
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
});
