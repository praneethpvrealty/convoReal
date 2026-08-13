import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet } from '@/components/sheet';
import { PrimaryButton } from '@/components/ui';
import { TagsField } from '@/components/tags-field';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Web parity: the bulk tag bar on the inventory list.
 *
 * A project's listings all want the same label, and applying it one
 * listing at a time is one trip through the editor each — plus one
 * chance each to type it differently. A tag spelled two ways is worse
 * than no tag: the search still returns results, so nothing looks broken
 * while half the project is missing from them.
 *
 * The merge runs server-side against each row's current tags
 * (bulk_tag_properties, migration 266), so this never overwrites a tag
 * another agent added to one of the selected listings.
 */
export function BulkTagBar({
  selectedIds,
  onClear,
  onTagged,
}: {
  selectedIds: string[];
  onClear: () => void;
  onTagged: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { show, dialogProps } = useAppDialog();

  if (selectedIds.length === 0) return null;

  async function apply() {
    // A tag typed but not committed to a chip is still what the agent
    // meant to apply — TagsField commits on blur, but the button can be
    // tapped without the input ever losing focus.
    const pending = input.trim();
    const add =
      pending && !tags.some((t) => t.toLowerCase() === pending.toLowerCase())
        ? [...tags, pending]
        : tags;
    if (add.length === 0) return;

    setBusy(true);
    try {
      const { data } = await apiFetch<{
        data: { updated: number; requested: number };
      }>('/api/properties/bulk-tags', {
        method: 'POST',
        body: JSON.stringify({ propertyIds: selectedIds, add }),
      });
      haptic.success();
      setOpen(false);
      setTags([]);
      setInput('');
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['property-tag-suggestions'] });
      show({
        title: 'Tagged',
        message:
          `${add.join(', ')} applied to ${data.updated} listing${data.updated === 1 ? '' : 's'}.` +
          (data.updated < data.requested
            ? ` ${data.requested - data.updated} could not be updated.`
            : ''),
      });
      onTagged();
    } catch (e) {
      haptic.warn();
      show({
        title: 'Could not tag',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.surfaceWell,
            borderColor: colors.glassBorder,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          },
        ]}
      >
        <Pressable
          onPress={() => {
            haptic.tap();
            onClear();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear selection"
        >
          <Ionicons name="close" size={22} color={colors.textMuted} />
        </Pressable>
        <Text
          style={{
            flex: 1,
            fontSize: 14.5,
            fontFamily: f.bold,
            color: colors.text,
          }}
        >
          {selectedIds.length} selected
        </Text>
        <Pressable
          onPress={() => {
            haptic.tap();
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Tag ${selectedIds.length} selected listings`}
          style={[styles.tagButton, { backgroundColor: colors.primary }]}
        >
          <Ionicons name="pricetag" size={15} color={colors.onPrimary} />
          <Text
            style={{
              fontSize: 14,
              fontFamily: f.bold,
              color: colors.onPrimary,
            }}
          >
            Tag
          </Text>
        </Pressable>
      </View>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={`Tag ${selectedIds.length} listing${selectedIds.length === 1 ? '' : 's'}`}
      >
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <TagsField
            tags={tags}
            onChange={setTags}
            input={input}
            onInputChange={setInput}
          />
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Added to whatever each listing already carries — nothing is
            replaced.
          </Text>
          <PrimaryButton
            label={busy ? 'Tagging…' : 'Apply'}
            onPress={apply}
            disabled={busy || (tags.length === 0 && !input.trim())}
          />
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </BottomSheet>

      <AppDialog {...dialogProps} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    elevation: 12,
  },
  tagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.full,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
