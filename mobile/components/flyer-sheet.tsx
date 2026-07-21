import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { FilterChip, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { storagePublicUrl } from '@/lib/storage-url';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';
import { useAppConfig } from '@/lib/use-app-config';
import { useDebounced } from '@/lib/use-debounced';

type FlyerTemplate = 'minimalist' | 'glassmorphism' | 'vignette';

const TEMPLATES: { value: FlyerTemplate; label: string }[] = [
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'glassmorphism', label: 'Glass card' },
  { value: 'vignette', label: 'Vignette' },
];

function defaultAiPrompt(property: Property): string {
  return `A high-end, professional architectural photograph of a luxury ${(property.type || 'property').toLowerCase()} in ${property.sublocality || property.city || 'Bangalore'}, clean composition, beautiful morning sunlight, modern real estate marketing photography style`;
}

/** Decode the enhance-image data URL and park it in storage once, so
 *  every preview render sends a short URL instead of megabytes of
 *  base64. The web draws client-side and never needs this hop. */
async function uploadAiBackground(dataUrl: string): Promise<string> {
  const accountId = useAuthStore.getState().profile?.account_id;
  if (!accountId) throw new ApiError(401, 'Not signed in');
  const [head, b64] = dataUrl.split(',');
  if (!head?.startsWith('data:') || !b64) throw new Error('Unexpected AI image format');
  const contentType = head.slice(5).split(';')[0] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = contentType.split('/')[1] || 'jpg';
  const path = `${accountId}/flyer-bg-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('property-images')
    .upload(path, bytes.buffer as ArrayBuffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from('property-images').getPublicUrl(path).data.publicUrl;
}

/**
 * Mobile port of the web's AI-Powered Flyer Creator
 * (flyer-creator-dialog.tsx). The drawing itself happens server-side —
 * POST /api/properties/[id]/flyer renders the same three templates via
 * next/og — so the preview here is the actual output, and "Save" is the
 * web's "Save to Property Photos" (flyer becomes the first photo).
 */
export function FlyerSheet({
  property,
  visible,
  onClose,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const config = useAppConfig();
  const brandDefault = config?.branding.name ?? 'ConvoReal';
  const aiCredits = config?.ai_costs.image_enhance ?? 25;
  const hasOriginal = Boolean(property.images && property.images.length > 0);

  const [template, setTemplate] = useState<FlyerTemplate>('minimalist');
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showBranding, setShowBranding] = useState(true);
  const [brandName, setBrandName] = useState('ConvoReal');
  const [brandContact, setBrandContact] = useState('');
  const [imageSource, setImageSource] = useState<'original' | 'ai'>('original');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill on open, same defaults as the web dialog.
  const openedForRef = useRef<string | null>(null);
  const brandTouchedRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      openedForRef.current = null;
      return;
    }
    if (openedForRef.current === property.id) return;
    openedForRef.current = property.id;
    brandTouchedRef.current = false;
    setImageSource(hasOriginal ? 'original' : 'ai');
    setAiPrompt(defaultAiPrompt(property));
    setAiImageUrl(null);
    setPreviewUri(null);
    setPreviewError(null);
    setBrandName(brandDefault);
    setBrandContact(session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : '');
  }, [visible, property, hasOriginal, session, brandDefault]);

  // Config can land after the very first open (cold cache) — adopt the
  // deployment brand name as long as the user hasn't edited the field.
  useEffect(() => {
    if (!brandTouchedRef.current) setBrandName(brandDefault);
  }, [brandDefault]);

  const dBrandName = useDebounced(brandName, 400);
  const dBrandContact = useDebounced(brandContact, 400);

  const useAi = imageSource === 'ai' && Boolean(aiImageUrl);
  const optionsBody = {
    template,
    show_price: showPrice,
    show_code: showCode,
    show_location: showLocation,
    show_branding: showBranding,
    brand_name: dBrandName,
    brand_contact: dBrandContact,
    image_source: useAi ? 'ai' : 'original',
    ai_image: useAi ? aiImageUrl : undefined,
  };
  const optionsKey = JSON.stringify(optionsBody);

  // Live preview: re-render on the server whenever a knob changes.
  // A request counter drops out-of-order responses.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!visible) return;
    const req = ++reqRef.current;
    setRendering(true);
    apiFetch<{ data: { image: string } }>(`/api/properties/${property.id}/flyer`, {
      method: 'POST',
      body: optionsKey,
    })
      .then((res) => {
        if (reqRef.current !== req) return;
        setPreviewUri(res.data.image);
        setPreviewError(null);
      })
      .catch((e) => {
        if (reqRef.current !== req) return;
        setPreviewError(friendlyError(e instanceof ApiError ? e.message : 'Preview failed.'));
      })
      .finally(() => {
        if (reqRef.current === req) setRendering(false);
      });
  }, [visible, property.id, optionsKey]);

  async function generateAiImage() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await apiFetch<{ image: string }>('/api/ai/enhance-image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: aiPrompt.trim() || defaultAiPrompt(property),
          aspectRatio: '1:1',
          image: hasOriginal ? property.images![0] : null,
        }),
      });
      const url = await uploadAiBackground(res.image);
      setAiImageUrl(url);
      setImageSource('ai');
      haptic.success();
    } catch (e) {
      haptic.warn();
      if (e instanceof ApiError && e.status === 402) {
        Alert.alert('Not enough credits', e.message, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'View credits',
            onPress: () => {
              onClose();
              router.push('/(app)/credits');
            },
          },
        ]);
      } else {
        Alert.alert(
          'Could not generate image',
          friendlyError(e instanceof ApiError ? e.message : 'Try again.')
        );
      }
    } finally {
      setGenerating(false);
    }
  }

  async function saveToProperty() {
    setSaving(true);
    try {
      await apiFetch(`/api/properties/${property.id}/flyer`, {
        method: 'POST',
        body: JSON.stringify({ ...optionsBody, save: true }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['property', property.id] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      onClose();
      Alert.alert('Flyer saved', 'The flyer is now the first photo on this property.');
    } catch (e) {
      haptic.warn();
      Alert.alert(
        'Could not save flyer',
        friendlyError(e instanceof ApiError ? e.message : 'Try again.')
      );
    } finally {
      setSaving(false);
    }
  }

  const toggles = [
    { label: 'Price', active: showPrice, set: setShowPrice },
    { label: 'Property code', active: showCode, set: setShowCode },
    { label: 'Location', active: showLocation, set: setShowLocation },
    { label: 'Branding', active: showBranding, set: setShowBranding },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Flyer creator">
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
          paddingBottom: spacing.sm,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.preview,
            { backgroundColor: colors.surfaceSunken, borderColor: colors.glassBorder },
          ]}
        >
          {previewUri ? (
            <Image source={{ uri: storagePublicUrl(previewUri) }} style={styles.previewImage} resizeMode="cover" />
          ) : (
            <View style={styles.previewEmpty}>
              <Ionicons name="image-outline" size={36} color={colors.textFaint} />
            </View>
          )}
          {rendering || generating ? (
            <View style={styles.previewOverlay}>
              <ActivityIndicator color="#fff" />
              {generating ? (
                <Text style={[styles.previewOverlayText, { fontFamily: f.semibold }]}>
                  Generating AI image…
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {previewError ? (
          <Text style={{ fontSize: 12.5, color: colors.danger, textAlign: 'center' }}>
            {previewError}
          </Text>
        ) : null}

        <SectionLabel text="Background" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {hasOriginal ? (
            <FilterChip
              label="Original photo"
              active={!useAi}
              onPress={() => setImageSource('original')}
            />
          ) : null}
          <FilterChip
            label={aiImageUrl ? '✨ AI image' : `✨ Generate with AI (${aiCredits} cr)`}
            active={useAi}
            onPress={() => {
              if (aiImageUrl) setImageSource('ai');
              else generateAiImage();
            }}
          />
        </View>

        {imageSource === 'ai' || !hasOriginal ? (
          <View style={{ gap: spacing.sm }}>
            <TextField
              label="AI prompt"
              multiline
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="Describe the background image…"
            />
            <Pressable
              onPress={generateAiImage}
              disabled={generating}
              accessibilityRole="button"
              accessibilityLabel="Regenerate AI image"
              style={[
                styles.regenerate,
                { borderColor: colors.border, opacity: generating ? 0.5 : 1 },
              ]}
            >
              <Ionicons name="refresh" size={15} color={colors.primary} />
              <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.primary }}>
                {aiImageUrl ? 'Regenerate' : 'Generate'} ({aiCredits} credits)
              </Text>
            </Pressable>
          </View>
        ) : null}

        <SectionLabel text="Template" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TEMPLATES.map((t) => (
            <FilterChip
              key={t.value}
              label={t.label}
              active={template === t.value}
              onPress={() => setTemplate(t.value)}
            />
          ))}
        </View>

        <SectionLabel text="Show on flyer" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {toggles.map((t) => (
            <FilterChip
              key={t.label}
              label={t.label}
              active={t.active}
              onPress={() => t.set(!t.active)}
            />
          ))}
        </View>

        {showBranding ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Brand name"
                value={brandName}
                onChangeText={(v) => {
                  brandTouchedRef.current = true;
                  setBrandName(v);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Phone"
                value={brandContact}
                onChangeText={setBrandContact}
                keyboardType="phone-pad"
              />
            </View>
          </View>
        ) : null}

        <PrimaryButton
          label="Save to property photos"
          icon="save-outline"
          busy={saving}
          disabled={rendering || generating}
          onPress={saveToProperty}
        />
        <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
          Saving adds the flyer as the first photo, so it leads showcase pages and shares.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  previewImage: { width: '100%', height: '100%' },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(2,6,23,0.45)',
  },
  previewOverlayText: { color: '#fff', fontSize: 13 },
  regenerate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 40,
  },
});
