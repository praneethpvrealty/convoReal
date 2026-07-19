import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

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

interface AgentsData {
  agents: Contact[];
  /** agent contact_id → linked showcase property count. */
  propertyCounts: Record<string, number>;
}

/**
 * Web parity: the Agents Directory tab (agents-content.tsx) — every
 * contact classified "Agent", ordered by name, with their linked
 * showcase-property counts. Tapping opens the contact screen, which
 * carries the agent peer strip, showcase properties and notes.
 */
async function fetchAgents(): Promise<AgentsData> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, phone, name, name_tag, email, company, classification')
    .eq('classification', 'Agent')
    .order('name');
  if (error) throw error;
  const agents = (data ?? []) as Contact[];

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
  const [search, setSearch] = useState('');

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

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Agents' }} />
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
              <AgentRow agent={item} propertyCount={data?.propertyCounts[item.id] ?? 0} />
            </EnterRow>
          )}
        />
      )}
    </View>
  );
}

function AgentRow({ agent, propertyCount }: { agent: Contact; propertyCount: number }) {
  const { colors, fonts: f } = useTheme();
  const name = agent.name || 'Unnamed Agent';
  return (
    <PressScale
      onPress={() => router.push(`/(app)/contact/${agent.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open agent ${name}`}
      contentStyle={StyleSheet.flatten([
        listCard,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
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
          {agent.name_tag ? <Tag label={agent.name_tag} /> : null}
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
