import { useMutation, useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Banner, PrimaryButton, SectionLabel } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import {
  GOOGLE_CALENDAR_RETURN_URL,
  parseGoogleCalendarReturn,
} from '@/lib/google-calendar-return';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { spacing, useTheme } from '@/lib/theme';
import {
  GOOGLE_CALENDAR_ERROR_MESSAGES,
  googleCalendarErrorMessage,
} from '@shared/lib/google-calendar/messages';

interface GoogleCalendarStatus {
  configured: boolean;
  connected: boolean;
  google_email: string | null;
  status: 'connected' | 'token_expired' | 'error' | null;
  last_error: string | null;
  last_synced_at: string | null;
}

const GOOGLE_QUERY_KEY = ['google-calendar'];

async function googleRequest(method: 'GET' | 'POST' | 'DELETE') {
  const body = await apiFetch<{ data: GoogleCalendarStatus }>(
    '/api/google-calendar',
    { method }
  );
  return body.data;
}

async function connectGoogleCalendar(): Promise<'connected' | 'cancelled'> {
  const start = await apiFetch<{ data: { url: string } }>(
    '/api/google-calendar/oauth/start',
    { method: 'POST', body: JSON.stringify({ client: 'mobile' }) }
  );
  const result = await WebBrowser.openAuthSessionAsync(
    start.data.url,
    GOOGLE_CALENDAR_RETURN_URL
  );
  if (result.type !== 'success') return 'cancelled';
  const parsed = parseGoogleCalendarReturn(result.url);
  if (parsed.kind === 'error') {
    if (parsed.error === 'consent_denied') return 'cancelled';
    throw new Error(googleCalendarErrorMessage(parsed.error));
  }
  await apiFetch('/api/google-calendar/oauth/complete', {
    method: 'POST',
    body: JSON.stringify({ code: parsed.code, state: parsed.state }),
  });
  return 'connected';
}

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.code) {
    return googleCalendarErrorMessage(err.code);
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function GoogleCalendarSyncSection() {
  const { colors, fonts: f } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: GOOGLE_QUERY_KEY,
    queryFn: () => googleRequest('GET'),
  });

  const onError = (err: unknown) => {
    haptic.warn();
    setNotice(null);
    setError(errorText(err));
  };

  const connect = useMutation({
    mutationFn: connectGoogleCalendar,
    onSuccess: (outcome) => {
      if (outcome === 'connected') {
        haptic.success();
        setError(null);
        setNotice('Google Calendar connected');
      }
      void queryClient.invalidateQueries({ queryKey: GOOGLE_QUERY_KEY });
    },
    onError,
  });

  const syncNow = useMutation({
    mutationFn: () => googleRequest('POST'),
    onSuccess: (data) => {
      queryClient.setQueryData(GOOGLE_QUERY_KEY, data);
      if (data.status === 'connected') {
        haptic.success();
        setError(null);
        setNotice('Synced with Google Calendar');
      } else {
        onError(new Error(data.last_error || 'Sync failed'));
      }
    },
    onError,
  });

  const disconnect = useMutation({
    mutationFn: () => googleRequest('DELETE'),
    onSuccess: (data) => {
      haptic.success();
      queryClient.setQueryData(GOOGLE_QUERY_KEY, data);
      setError(null);
      setNotice('Google Calendar disconnected');
    },
    onError,
  });

  const data = status.data;
  const busy = connect.isPending || syncNow.isPending || disconnect.isPending;

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="SYNC TO GOOGLE CALENDAR" />
      <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}>
        Adds a ConvoReal calendar to your Google account and keeps it up to date
        every 15 minutes. ConvoReal can only see and change that one calendar.
      </Text>
      {notice ? <Banner kind="success" text={notice} /> : null}
      {error ? <Banner kind="error" text={error} /> : null}

      {status.isLoading ? null : !data?.configured ? (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          {GOOGLE_CALENDAR_ERROR_MESSAGES.not_configured}
        </Text>
      ) : data.connected ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.text }}>
            {`Connected${data.google_email ? ` as ${data.google_email}` : ''}${
              data.last_synced_at
                ? `, last synced ${new Date(data.last_synced_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`
                : '.'
            }`}
          </Text>
          {data.status !== 'connected' && data.last_error ? (
            <Banner kind="error" text={data.last_error} />
          ) : null}
          {data.status === 'token_expired' ? (
            <PrimaryButton
              label="Reconnect"
              icon="logo-google"
              busy={connect.isPending}
              disabled={busy}
              onPress={() => connect.mutate()}
            />
          ) : (
            <PrimaryButton
              label="Sync now"
              icon="refresh-outline"
              busy={syncNow.isPending}
              disabled={busy}
              onPress={() => syncNow.mutate()}
            />
          )}
          <Pressable
            onPress={() => disconnect.mutate()}
            disabled={busy}
            accessibilityRole="button"
            style={{ alignItems: 'center', paddingVertical: spacing.sm }}
          >
            <Text style={{ color: colors.danger, fontFamily: f.semibold }}>
              Disconnect
            </Text>
          </Pressable>
        </View>
      ) : (
        <PrimaryButton
          label="Connect Google Calendar"
          icon="logo-google"
          busy={connect.isPending}
          disabled={busy}
          onPress={() => connect.mutate()}
        />
      )}
    </View>
  );
}
