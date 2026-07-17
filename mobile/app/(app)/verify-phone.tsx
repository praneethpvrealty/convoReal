import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/lib/auth-store';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

/**
 * Gate screen for accounts without an OTP-verified WhatsApp number
 * (migration 137). v1 sends users to the web flow (/verify-phone) and
 * offers a re-check; the native OTP flow (signInWithOtp / updateUser +
 * verifyOtp over the existing WhatsApp Send-SMS hook) is a Phase 1
 * fast-follow.
 */
export default function VerifyPhoneScreen() {
  const setSession = useAuthStore((s) => s.setSession);
  const [checking, setChecking] = useState(false);

  async function recheck() {
    setChecking(true);
    // refreshSession re-mints the JWT so phone_confirmed_at set on the
    // web since login is reflected here; the (app) layout re-evaluates.
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      setSession(data.session);
    }
    setChecking(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Verify your WhatsApp number</Text>
        <Text style={styles.body}>
          ConvoReal requires every team member to verify their WhatsApp number
          with a one-time code. Please complete verification in the web app
          (open <Text style={styles.mono}>/verify-phone</Text> after signing
          in), then come back and tap the button below.
        </Text>

        <Pressable style={styles.button} onPress={recheck} disabled={checking}>
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>I&apos;ve verified — re-check</Text>
          )}
        </Pressable>

        <Pressable style={styles.secondary} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  body: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  mono: { fontFamily: 'monospace' as const, color: colors.text },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { alignItems: 'center', paddingVertical: 10 },
  secondaryText: { color: colors.textMuted, fontSize: 15 },
});
