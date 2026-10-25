import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { Banner, PrimaryButton, SectionLabel } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

interface FeedStatus {
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
  url?: string;
  webcal_url?: string;
  google_url?: string;
}

const FEED_QUERY_KEY = ['calendar-feed'];

async function feedRequest(method: 'GET' | 'POST' | 'DELETE') {
  const body = await apiFetch<{ data: FeedStatus }>('/api/calendar/feed', {
    method,
  });
  return body.data;
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong';
}

export default function CalendarFeedScreen() {
  const { colors, fonts: f } = useTheme();
  const [created, setCreated] = useState<FeedStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: FEED_QUERY_KEY,
    queryFn: () => feedRequest('GET'),
  });

  const create = useMutation({
    mutationFn: () => feedRequest('POST'),
    onSuccess: (data) => {
      haptic.success();
      setCreated(data);
      setNotice(null);
      setError(null);
      queryClient.setQueryData(FEED_QUERY_KEY, data);
    },
    onError: (err) => {
      haptic.warn();
      setError(errorText(err));
    },
  });

  const turnOff = useMutation({
    mutationFn: () => feedRequest('DELETE'),
    onSuccess: (data) => {
      haptic.success();
      setCreated(null);
      setError(null);
      setNotice('Calendar link turned off');
      queryClient.setQueryData(FEED_QUERY_KEY, data);
    },
    onError: (err) => {
      haptic.warn();
      setError(errorText(err));
    },
  });

  async function copyUrl() {
    if (!created?.url) return;
    await Clipboard.setStringAsync(created.url);
    haptic.success();
    setNotice('Link copied');
  }

  const enabled = status.data?.enabled ?? false;
  const busy = create.isPending || turnOff.isPending;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Subscribe to calendar' }}
      />
      {status.isLoading ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ConvoRealLoader />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            Your appointments and dated open to-dos appear in Google, Apple or
            Outlook calendar and refresh about every hour. Anyone with the link
            can see them, including contact names and phone numbers, so keep it
            private.
          </Text>

          {notice ? <Banner kind="success" text={notice} /> : null}
          {error ? <Banner kind="error" text={error} /> : null}
          {status.error ? (
            <Banner kind="error" text={errorText(status.error)} />
          ) : null}

          {created?.url ? (
            <View style={{ gap: spacing.sm }}>
              <SectionLabel text="YOUR LINK" />
              <Text style={[styles.body, { color: colors.warning }]}>
                Copy this link now. It is shown only once; reset it to get a new
                one.
              </Text>
              <Pressable
                onPress={copyUrl}
                accessibilityRole="button"
                accessibilityLabel="Copy calendar link"
                style={[
                  styles.linkBox,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <Text
                  selectable
                  style={{
                    fontSize: 12,
                    color: colors.text,
                    fontFamily: f.medium,
                  }}
                >
                  {created.url}
                </Text>
              </Pressable>
              <PrimaryButton
                label="Copy link"
                icon="copy-outline"
                onPress={copyUrl}
              />
              <PrimaryButton
                label="Add to Google Calendar"
                icon="logo-google"
                onPress={() => {
                  if (created.google_url)
                    void Linking.openURL(created.google_url);
                }}
              />
              <PrimaryButton
                label="Open in Apple or Outlook"
                icon="calendar-outline"
                onPress={() => {
                  if (created.webcal_url)
                    void Linking.openURL(created.webcal_url);
                }}
              />
            </View>
          ) : (
            <Text style={[styles.body, { color: colors.text }]}>
              {enabled
                ? `Your calendar link is on${
                    status.data?.last_used_at
                      ? `, last fetched ${new Date(status.data.last_used_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`
                      : ' and has not been fetched yet.'
                  } Reset it to get a new link; the old one stops working at once.`
                : 'Create a private link, then add it to your calendar app as a subscribed calendar.'}
            </Text>
          )}

          <PrimaryButton
            label={enabled ? 'Reset link' : 'Create link'}
            icon="link-outline"
            busy={create.isPending}
            disabled={busy}
            onPress={() => create.mutate()}
          />
          {enabled ? (
            <Pressable
              onPress={() => turnOff.mutate()}
              disabled={busy}
              accessibilityRole="button"
              style={{ alignItems: 'center', paddingVertical: spacing.sm }}
            >
              <Text style={{ color: colors.danger, fontFamily: f.semibold }}>
                Turn off
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  body: { fontSize: 13, lineHeight: 19 },
  linkBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
});
