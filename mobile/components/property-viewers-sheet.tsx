import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet } from '@/components/sheet';
import { Avatar } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { openContactChat } from '@/lib/open-chat';
import { fetchPropertyViewers } from '@/lib/pulse';
import { formatTimeAgo } from '@/lib/pulse-feed';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Web parity: PropertyViewersDialog. The identified viewers of one
 * listing — visitors whose showcase views tied to a contact through a
 * personalized `?v=` tracked link or a later self-identification.
 * Anonymous and forwarded views carry no identity and cannot appear.
 */
export function PropertyViewersSheet({
  propertyId,
  propertyTitle,
  onClose,
}: {
  propertyId: string | null;
  propertyTitle: string;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const { show, dialogProps } = useAppDialog();

  const { data: viewers, isLoading } = useQuery({
    queryKey: ['pulse-viewers', propertyId],
    enabled: Boolean(accountId && propertyId),
    queryFn: () => fetchPropertyViewers(accountId!, propertyId!),
  });

  return (
    <BottomSheet visible={Boolean(propertyId)} onClose={onClose} title="Identified viewers">
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={2}>
          {propertyTitle}
        </Text>

        {isLoading ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !viewers || viewers.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <Ionicons name="person-circle-outline" size={30} color={colors.textFaint} />
            <Text style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}>
              No identified viewers yet
            </Text>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted, textAlign: 'center' }}>
              Views tie to a contact only when you share a personalized tracked link (Send
              personally) or the visitor submits an inquiry.
            </Text>
          </View>
        ) : (
          <>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: spacing.sm }}>
              {viewers.map((v) => {
                const label = v.name || v.phone || 'Unknown';
                return (
                  <View
                    key={v.contactId}
                    style={[
                      styles.row,
                      { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                    ]}
                  >
                    <Avatar name={label} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                        {v.views} view{v.views === 1 ? '' : 's'} · {formatTimeAgo(v.lastAt)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={async () => {
                        const outcome = await openContactChat({
                          id: v.contactId,
                          phone: v.phone ?? '',
                          name: v.name ?? undefined,
                        });
                        if (!outcome.ok && outcome.error) {
                          show({ title: 'Could not open thread', message: outcome.error });
                        } else if (outcome.ok) {
                          onClose();
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Message ${label}`}
                      style={[styles.message, { backgroundColor: colors.primarySoft }]}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
                      <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
                        Message
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
            <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textFaint }}>
              Only viewers who opened a tracked link or identified themselves appear here.
            </Text>
          </>
        )}
      </View>
      <AppDialog {...dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
