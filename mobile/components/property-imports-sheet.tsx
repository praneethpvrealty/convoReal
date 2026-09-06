import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { spacing, useTheme } from '@/lib/theme';
import type { InventoryImportsResponse } from '@shared/lib/inventory/import-activity';

export function PropertyImportsSheet({
  propertyId,
  propertyTitle,
  onClose,
}: {
  propertyId: string;
  propertyTitle: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const accountId = useAuthStore((state) => state.profile?.account_id);
  const query = useInfiniteQuery({
    queryKey: ['properties', 'imports', accountId, propertyId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<InventoryImportsResponse>(
        `/api/properties/${propertyId}/imports?page=${pageParam}`
      ),
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: Boolean(accountId),
    staleTime: 0,
  });
  const imports = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <BottomSheet visible onClose={onClose} title="Added to inventories">
      <ScrollView
        style={sheetScrollArea}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      >
        <Text style={{ color: colors.text, fontWeight: '600' }}>
          {propertyTitle}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          Agents and agencies with a direct copy of this listing. Pending review
          is shown separately from an accepted import.
        </Text>
        {query.isPending && (
          <ActivityIndicator
            accessibilityLabel="Loading inventory activity"
            color={colors.primary}
          />
        )}
        {query.isError && (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityRole="alert" style={{ color: colors.text }}>
              Could not load inventory activity.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading inventory activity"
              disabled={query.isFetching}
              onPress={() =>
                query.isFetchNextPageError
                  ? query.fetchNextPage()
                  : query.refetch()
              }
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.primary }}>Retry</Text>
            </Pressable>
          </View>
        )}
        {query.isSuccess && imports.length === 0 && (
          <Text style={{ color: colors.textMuted }}>
            No linked imports yet. Sharing a link alone does not add a property
            to another inventory.
          </Text>
        )}
        {imports.map((item) => (
          <View
            key={item.id}
            style={{
              padding: spacing.md,
              gap: spacing.sm,
              borderWidth: 1,
              borderColor: colors.glassBorder,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {item.agentName || item.agencyName}
            </Text>
            {item.agentName && (
              <Text style={{ color: colors.textMuted }}>{item.agencyName}</Text>
            )}
            <Text style={{ color: colors.primary }}>{item.status}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              Copy created{' '}
              {new Date(item.recordedAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </Text>
          </View>
        ))}
        {query.hasNextPage && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Load more inventory activity"
            disabled={query.isFetching}
            onPress={() => query.fetchNextPage()}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.primary }}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Text>
          </Pressable>
        )}
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          Includes linked imports and automatic source-agent copies.
          Independently entered listings, onward shares, and deleted copies are
          not included.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}
