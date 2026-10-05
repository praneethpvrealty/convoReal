import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
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

async function uploadResized(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<string> {
  const form = new FormData();
  form.append('files', {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
  } as unknown as Blob);
  const { data } = await apiFetch<{ data: { paths: string[] } }>(
    '/api/properties/images',
    { method: 'POST', body: form }
  );
  return data.paths[0];
}

async function uploadAsset(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  base64?: string | null;
}): Promise<string> {
  try {
    return await uploadResized(asset);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 413 && asset.base64) return uploadOriginal(asset.base64);
    if (e.status !== 429) throw e;
    const waitSeconds = Math.min(e.retryAfterSeconds ?? 60, 60);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return uploadResized(asset);
  }
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

/**
 * Property photos editor: pick from the library, upload through
 * `/api/properties/images` (which resizes to the same 1200px the web
 * form stores), then keep the returned bucket-relative paths in the
 * images array. A photo too large for the API's request body falls back
 * to a direct `property-images` upload so it still attaches. Index 0 is the cover;
 * tapping ☆ moves a photo to the front. Removing just drops it from the
 * array — the row is saved with the parent form.
 */
export function PropertyPhotoEditor({
  images,
  onChange,
}: {
  images: string[];
  onChange: (next: string[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const { show, dialogProps } = useAppDialog();

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
    setBusy(true);
    haptic.tap();
    const uploaded: string[] = [];
    try {
      for (const asset of result.assets) {
        uploaded.push(await uploadAsset(asset));
      }
      haptic.success();
    } catch (e) {
      haptic.warn();
      show({
        title:
          uploaded.length > 0 ? 'Some photos did not upload' : 'Upload failed',
        message:
          uploaded.length > 0
            ? `${uploaded.length} of ${result.assets.length} added. ${e instanceof Error ? e.message : 'Please try again.'}`
            : e instanceof Error
              ? e.message
              : 'Please try again.',
      });
    } finally {
      if (uploaded.length > 0) onChange([...images, ...uploaded]);
      setBusy(false);
    }
  }

  function remove(index: number) {
    haptic.tap();
    onChange(images.filter((_, i) => i !== index));
  }

  function setCover(index: number) {
    if (index === 0) return;
    haptic.tap();
    onChange([images[index], ...images.filter((_, i) => i !== index)]);
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
                style={styles.starBtn}
              >
                <Ionicons name="star-outline" size={13} color="#fff" />
              </Pressable>
            )}
            <Pressable
              onPress={() => remove(i)}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
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
          {busy ? (
            <ActivityIndicator color={colors.primary} />
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
