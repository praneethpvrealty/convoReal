import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import {
  restorePhoto,
  uploadEach,
  uploadProgressLabel,
} from '@/lib/photo-upload';
import { storagePublicUrl } from '@/lib/storage-url';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';

const BUCKET = 'property-images';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadOriginal(base64: string): Promise<string> {
  const accountId = useAuthStore.getState().profile?.account_id;
  if (!accountId) throw new Error('Not signed in');
  const rand = Math.random().toString(36).substring(2, 7);
  const path = `${accountId}/img-${Date.now()}-${rand}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decodeBase64(base64).buffer as ArrayBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    });
  if (error) throw new Error(error.message);
  return `${BUCKET}/${path}`;
}

async function resize(path: string): Promise<string> {
  const { data } = await apiFetch<{ data: { path: string } }>(
    '/api/properties/images',
    { method: 'POST', body: JSON.stringify({ path }) }
  );
  return data.path;
}

async function uploadAsset(base64: string): Promise<string> {
  const original = await uploadOriginal(base64);
  try {
    return await resize(original);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 429) throw e;
    const waitSeconds = Math.min(e.retryAfterSeconds ?? 60, 60);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return resize(original);
  }
}

/**
 * Property photos editor: pick from the library, upload the original to
 * `property-images`, have `/api/properties/images` resize it to the same
 * 1200px the web form stores, then keep the returned bucket-relative
 * paths in the images array. Index 0 is the cover; tapping ☆ moves a
 * photo to the front. Removing just drops it from the array — the row is
 * saved with the parent form.
 */
export function PropertyPhotoEditor({
  images,
  onChange,
  onBusyChange,
}: {
  images: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [removed, setRemoved] = useState<{
    photo: string;
    index: number;
  } | null>(null);
  const { show, close, dialogProps } = useAppDialog();
  const busy = progress !== null;

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(timer);
  }, [removed]);

  async function uploadBase64s(items: string[]) {
    setProgress({ done: 0, total: items.length });
    onBusyChange?.(true);
    haptic.tap();
    const result = await uploadEach(
      items,
      uploadAsset,
      (done, total) => setProgress({ done, total }),
      (path) => onChange((prev) => [...prev, path])
    );
    setProgress(null);
    onBusyChange?.(false);
    if (result.failed.length === 0) {
      haptic.success();
      return;
    }
    haptic.warn();
    show({
      title:
        result.uploaded.length > 0
          ? 'Some photos did not upload'
          : 'Upload failed',
      message: `${result.uploaded.length} of ${items.length} added. ${result.lastError ?? 'Please try again.'}`,
      actions: [
        { label: 'Dismiss', variant: 'muted', onPress: close },
        {
          label: 'Retry failed',
          variant: 'primary',
          onPress: () => {
            close();
            void uploadBase64s(result.failed);
          },
        },
      ],
    });
  }

  async function addPhotos() {
    if (busy) return;
    // Loaded lazily so an older installed build that predates this
    // native module degrades to a friendly prompt instead of crashing
    // the whole editor at import time.
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      show({
        title: 'Update the app',
        message:
          'Adding photos needs the latest ConvoReal build. Install the newest version, then try again.',
      });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show({
        title: 'Permission needed',
        message: 'Allow photo access to add listing images.',
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;
    const items = result.assets
      .map((asset) => asset.base64)
      .filter((b64): b64 is string => Boolean(b64));
    if (items.length === 0) return;
    await uploadBase64s(items);
  }

  function remove(index: number) {
    haptic.tap();
    setRemoved({ photo: images[index], index });
    onChange((prev) => prev.filter((_, i) => i !== index));
  }

  function undoRemove() {
    if (!removed) return;
    haptic.tap();
    onChange((prev) => restorePhoto(prev, removed.photo, removed.index));
    setRemoved(null);
  }

  function setCover(index: number) {
    if (index === 0) return;
    haptic.tap();
    onChange((prev) => [prev[index], ...prev.filter((_, i) => i !== index)]);
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Photos" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {images.map((img, i) => (
          <View key={`${img}-${i}`} style={styles.thumbWrap}>
            <Image
              source={{ uri: storagePublicUrl(img) }}
              style={styles.thumb}
              resizeMode="cover"
            />
            {i === 0 ? (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text
                  style={[
                    styles.badgeText,
                    { fontFamily: f.bold, color: colors.onPrimary },
                  ]}
                >
                  Cover
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={() => setCover(i)}
                accessibilityRole="button"
                accessibilityLabel="Set as cover photo"
                hitSlop={11}
                style={styles.starBtn}
              >
                <Ionicons name="star-outline" size={13} color="#fff" />
              </Pressable>
            )}
            <Pressable
              onPress={() => remove(i)}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              hitSlop={11}
              style={styles.removeBtn}
            >
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={addPhotos}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          style={[
            styles.addTile,
            {
              borderColor: colors.primary,
              backgroundColor: colors.primarySoft,
            },
          ]}
        >
          {progress ? (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={{
                  fontSize: 10.5,
                  fontFamily: f.semibold,
                  color: colors.primary,
                  textAlign: 'center',
                }}
              >
                {uploadProgressLabel(progress.done, progress.total)}
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="camera" size={22} color={colors.primary} />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: f.semibold,
                  color: colors.primary,
                }}
              >
                Add
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
      {removed ? (
        <View
          style={[styles.undoRow, { backgroundColor: colors.surface }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ flex: 1, fontSize: 13, color: colors.text }}>
            Photo removed
          </Text>
          <Pressable
            onPress={undoRemove}
            accessibilityRole="button"
            accessibilityLabel="Undo remove photo"
            hitSlop={12}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              Undo
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
        Tap ☆ to make a photo the cover — the first photo leads the listing and
        shares.
      </Text>
      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  thumb: { width: 96, height: 96 },
  badge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10 },
  starBtn: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.full,
    padding: 5,
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.full,
    padding: 4,
  },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
