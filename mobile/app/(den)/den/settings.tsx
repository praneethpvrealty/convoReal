import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Banner, FilterChip, PrimaryButton, SectionLabel, TextField } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchDenMe, updateDenSettings } from '@/lib/den-api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { useSurface } from '@/lib/surface';
import { radius, spacing, useTheme } from '@/lib/theme';

const DIGESTS = ['off', 'daily', 'weekly'] as const;

export default function DenSettingsScreen() {
  const { colors, fonts: f } = useTheme();
  const setSurface = useSurface((s) => s.setSurface);
  const me = useQuery({ queryKey: ['den-me'], queryFn: fetchDenMe });

  const [name, setName] = useState('');
  const [notifyMatches, setNotifyMatches] = useState(true);
  const [notifyBids, setNotifyBids] = useState(true);
  const [digest, setDigest] = useState<(typeof DIGESTS)[number]>('weekly');

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.display_name ?? '');
    setNotifyMatches(me.data.notify_matches);
    setNotifyBids(me.data.notify_bids);
    setDigest(me.data.digest_frequency);
  }, [me.data]);

  const save = useMutation({
    mutationFn: () =>
      updateDenSettings({
        display_name: name,
        notify_matches: notifyMatches,
        notify_bids: notifyBids,
        digest_frequency: digest,
      }),
    onSuccess: () => {
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['den-me'] });
      router.back();
    },
    onError: (e) => {
      haptic.warn();
      Alert.alert(
        'Could not save',
        friendlyError(e instanceof ApiError ? e.message : 'Try again.')
      );
    },
  });

  async function signOut() {
    await supabase.auth.signOut();
    setSurface('staff');
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
      {me.error ? (
        <Banner
          kind="error"
          text={friendlyError(me.error instanceof ApiError ? me.error.message : 'Could not load your Den profile.')}
        />
      ) : null}

      <TextField
        label="Display name"
        placeholder="How agencies see you"
        autoCapitalize="words"
        value={name}
        onChangeText={setName}
      />

      <SectionLabel text="WhatsApp notifications" />
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <View style={styles.switchRow}>
          <Text style={{ flex: 1, fontSize: 14.5, color: colors.text }}>
            Buyer matches on my properties
          </Text>
          <Switch
            value={notifyMatches}
            onValueChange={setNotifyMatches}
            trackColor={{ true: colors.primary }}
            accessibilityLabel="Notify me about buyer matches"
          />
        </View>
        <View style={[styles.switchRow, { borderTopWidth: 1, borderTopColor: colors.glassBorder }]}>
          <Text style={{ flex: 1, fontSize: 14.5, color: colors.text }}>New offers (bids)</Text>
          <Switch
            value={notifyBids}
            onValueChange={setNotifyBids}
            trackColor={{ true: colors.primary }}
            accessibilityLabel="Notify me about new offers"
          />
        </View>
      </View>

      <SectionLabel text="Activity digest" />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {DIGESTS.map((d) => (
          <FilterChip
            key={d}
            label={d === 'off' ? 'Off' : d === 'daily' ? 'Daily' : 'Weekly'}
            active={digest === d}
            onPress={() => setDigest(d)}
          />
        ))}
      </View>

      <PrimaryButton label="Save settings" busy={save.isPending} onPress={() => save.mutate()} />

      <Pressable
        onPress={signOut}
        accessibilityRole="button"
        style={[styles.signOut, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
      >
        <Text style={{ color: colors.danger, fontSize: 15, fontFamily: f.bold }}>Sign out</Text>
      </Pressable>

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Linked agencies: {me.data?.links.map((l) => l.agency_name).filter(Boolean).join(', ') || '—'}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  signOut: {
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    paddingVertical: 14,
  },
});
