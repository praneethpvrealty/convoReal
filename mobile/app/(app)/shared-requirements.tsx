import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState, FilterChip, SearchBar } from '@/components/ui';
import { areasMatchSearch } from '@/lib/contact-area-options';
import {
  fetchRequirementShares,
  requirementBudget,
  requirementShareStatus,
  type RequirementShare,
  type RequirementShareBox,
} from '@/lib/requirement-shares';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';

export default function SharedRequirementsScreen() {
  const { colors } = useTheme();
  const [box, setBox] = useState<RequirementShareBox>('received');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['requirement-account-shares', box],
    queryFn: () => fetchRequirementShares(box),
  });
  const pull = usePullRefresh(query.refetch);

  const shown = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return query.data ?? [];
    return (query.data ?? []).filter(
      (share) =>
        [
          share.reference,
          share.senderName,
          share.senderAccountName,
          share.brief.requirements,
          ...share.brief.areas,
          ...share.brief.projects,
          ...share.brief.propertyTypes,
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(value)) ||
        // Web parity: a typed locality stands for every spelling of it.
        areasMatchSearch(search, share.brief.areas)
    );
  }, [query.data, search]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Shared requirements' }} />
      <View style={styles.header}>
        <View style={styles.tabs}>
          <FilterChip
            label="Received"
            active={box === 'received'}
            onPress={() => setBox('received')}
          />
          <FilterChip
            label="Sent"
            active={box === 'sent'}
            onPress={() => setBox('sent')}
          />
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search reference, area or brief"
        />
      </View>

      {query.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Could not load shared requirements"
          subtitle="Check your connection and pull to try again."
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(share) => share.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="swap-horizontal-outline"
              title={
                search ? 'No matching requirements' : `No ${box} requirements`
              }
              subtitle={
                box === 'received'
                  ? 'Masked briefs shared directly with your account appear here.'
                  : 'Open a buyer’s requirements to share a brief with a registered agent.'
              }
            />
          }
          renderItem={({ item }) => (
            <ShareCard
              share={item}
              box={box}
              onPress={() =>
                router.push({
                  pathname: '/(app)/shared-requirement/[id]',
                  params: { id: item.id, box },
                })
              }
            />
          )}
        />
      )}
    </View>
  );
}

function ShareCard({
  share,
  box,
  onPress,
}: {
  share: RequirementShare;
  box: RequirementShareBox;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open requirement ${share.reference}`}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: colors.text, fontFamily: f.bold, fontSize: 15 }}
          >
            {share.reference}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: colors.textMuted, fontSize: 11.5, marginTop: 2 }}
          >
            {box === 'received'
              ? [share.senderAccountName, share.senderName]
                  .filter(Boolean)
                  .join(' · ')
              : 'Shared buyer brief'}
          </Text>
        </View>
        <View style={[styles.status, { backgroundColor: colors.primarySoft }]}>
          <Text
            style={{ color: colors.primary, fontFamily: f.bold, fontSize: 10 }}
          >
            {requirementShareStatus(share.status).toUpperCase()}
          </Text>
        </View>
      </View>

      {share.brief.requirements ? (
        <Text
          numberOfLines={3}
          style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 18 }}
        >
          {share.brief.requirements}
        </Text>
      ) : null}

      <View style={styles.row}>
        <Text
          style={{
            color: colors.primary,
            fontFamily: f.semibold,
            fontSize: 12,
          }}
        >
          {requirementBudget(share.brief)}
        </Text>
        {share.responseCount > 0 ? (
          <Text
            style={{ color: colors.success, fontFamily: f.bold, fontSize: 12 }}
          >
            {share.responseCount} match{share.responseCount === 1 ? '' : 'es'}
          </Text>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        )}
      </View>
      {share.brief.areas.length ? (
        <Text
          numberOfLines={1}
          style={{ color: colors.textFaint, fontSize: 11.5 }}
        >
          {share.brief.areas.join(', ')}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  status: {
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
