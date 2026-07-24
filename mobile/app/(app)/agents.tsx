import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AgentDetail } from '@/components/agent-detail';
import { EnterRow, PressScale } from '@/components/motion';
import {
  Avatar,
  ConversationSkeleton,
  EmptyState,
  SearchBar,
  Tag,
  listCard,
} from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { fonts, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

/** Side-by-side panes need this much width; below it the directory
 *  behaves like every other phone list and pushes the contact screen. */
const SPLIT_MIN_WIDTH = 700;

interface AgentsData {
  agents: Contact[];
  /** agent contact_id → linked showcase property count. */
  propertyCounts: Record<string, number>;
}

/**
 * Web parity: the Agents Directory tab (agents-content.tsx) — every
 * contact classified "Agent", ordered by name, with their linked
 * showcase-property counts. On wide screens this renders the same
 * two-pane layout as desktop: directory left, detail right.
 */
async function fetchAgents(): Promise<AgentsData> {
  const { data, error } = await supabase
    .from('contacts')
    .select(
      'id, phone, name, name_tag, email, company, classification, requirements, ' +
        'areas_of_interest, property_interests, last_inquired_property_id'
    )
    .eq('classification', 'Agent')
    .order('name');
  if (error) throw error;
  const agents = (data ?? []) as unknown as Contact[];

  const propertyCounts: Record<string, number> = {};
  const ids = agents.map((a) => a.id);
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from('properties')
      .select('owner_contact_id')
      .in('owner_contact_id', ids);
    for (const row of (rows ?? []) as { owner_contact_id: string }[]) {
      propertyCounts[row.owner_contact_id] = (propertyCounts[row.owner_contact_id] ?? 0) + 1;
    }
  }

  return { agents, propertyCounts };
}

export default function AgentsScreen() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= SPLIT_MIN_WIDTH;
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['agents-directory'],
    queryFn: fetchAgents,
  });

  const q = search.trim().toLowerCase();
  const shown = (data?.agents ?? []).filter(
    (a) =>
      !q ||
      a.name?.toLowerCase().includes(q) ||
      a.company?.toLowerCase().includes(q) ||
      a.phone.includes(q)
  );

  // Desktop parity: something is always selected once agents load.
  const selected = wide
    ? (shown.find((a) => a.id === selectedId) ?? shown[0] ?? null)
    : null;

  const list = (
    <>
      <View style={styles.header}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search agents by name, company…"
        />
      </View>
      {isLoading ? (
        <View>
          {Array.from({ length: 6 }, (_, i) => (
            <ConversationSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase-outline"
              title={q ? 'No matches' : 'No agents yet'}
              subtitle={
                q
                  ? 'Searched names, companies and phone numbers.'
                  : 'Classify a contact as "Agent" and it appears here with their showcase properties and notes.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <EnterRow index={index}>
              <AgentRow
                agent={item}
                propertyCount={data?.propertyCounts[item.id] ?? 0}
                active={wide && selected?.id === item.id}
                onPress={() => {
                  if (wide) setSelectedId(item.id);
                  else router.push(`/(app)/contact/${item.id}`);
                }}
              />
            </EnterRow>
          )}
        />
      )}
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Agents' }} />
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: 340,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderRightColor: colors.border,
            }}
          >
            {list}
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {selected ? (
              <AgentDetail key={selected.id} agent={selected} />
            ) : (
              <EmptyState
                icon="briefcase-outline"
                title="Select an agent"
                subtitle="Pick an agent from the directory to see their showcase properties, requirements, schedule and notes."
              />
            )}
          </ScrollView>
        </View>
      ) : (
        list
      )}
    </View>
  );
}

function AgentRow({
  agent,
  propertyCount,
  active,
  onPress,
}: {
  agent: Contact;
  propertyCount: number;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const name = agent.name || 'Unnamed Agent';
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open agent ${name}`}
      accessibilityState={{ selected: active }}
      contentStyle={StyleSheet.flatten([
        listCard,
        {
          backgroundColor: active ? colors.primarySoft : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ])}
    >
      <Avatar name={agent.name || agent.phone} size={46} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.nameRow}>
          <Text
            style={[styles.name, { color: colors.text, fontFamily: f.extrabold }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {agent.name_tag ? (
            <View style={{ flexShrink: 1, maxWidth: '50%' }}>
              <Tag label={agent.name_tag} />
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
          {[agent.company, agent.phone].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {propertyCount > 0 ? (
        <Tag label={`${propertyCount} ${propertyCount === 1 ? 'property' : 'properties'}`} color={colors.primary} />
      ) : null}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16.5, fontFamily: fonts.extrabold, letterSpacing: -0.2, flexShrink: 1 },
});
