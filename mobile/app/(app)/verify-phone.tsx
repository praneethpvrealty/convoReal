import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass-card';
import { HelpCentreLink } from '@/components/help-centre-link';
import { OtpInput } from '@/components/otp-input';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { signOut, useAuthStore } from '@/lib/auth-store';
import { cleanPhoneInput } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useResendCooldown } from '@/lib/use-resend-cooldown';
import { spacing, useTheme, fonts } from '@/lib/theme';

/**
 * Native mirror of the web's WhatsappPhoneVerify (migration 137 gate):
 * updateUser({ phone }) sends a code over WhatsApp via the Send-SMS
 * hook; verifyOtp(type 'phone_change') confirms it. On success we
 * refresh the session so phone_confirmed_at lands in the JWT and the
 * (app) layout lets the user through.
 */
export default function VerifyPhoneScreen() {
  const { colors, fonts: f } = useTheme();
  const setSession = useAuthStore((s) => s.setSession);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { resendIn, startCooldown } = useResendCooldown();

  async function sendCode() {
    setError(null);
    setInfo(null);
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) {
      setError(
        'Enter a valid WhatsApp number (e.g. 9900277111 or +919900277111)'
      );
      return;
    }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({
      phone: cleanPhone,
    });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setInfo('Code sent to your WhatsApp!');
    setStage('code');
    setOtp('');
    startCooldown();
  }

  async function verify(code: string) {
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone || busy) return;
    setError(null);
    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: code,
      type: 'phone_change',
    });
    if (verifyError) {
      setBusy(false);
      setError(verifyError.message);
      setOtp('');
      return;
    }
    // Refresh so phone_confirmed_at is in the session; the layout
    // guard re-evaluates and routes into the app.
    const { data, error: refreshError } = await supabase.auth.refreshSession();
    setBusy(false);
    if (data.session) {
      setSession(data.session);
      return;
    }
    setError(
      refreshError
        ? `Your number is verified, but we couldn’t refresh your session: ${refreshError.message}. Check your connection, then sign out and sign in again.`
        : 'Your number is verified, but we couldn’t refresh your session. Sign out and sign in again to continue.'
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <GlassCard style={styles.formCard}>
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <View
                style={[
                  styles.iconBadge,
                  { backgroundColor: colors.successSoft },
                ]}
              >
                <Ionicons
                  name="logo-whatsapp"
                  size={34}
                  color={colors.success}
                />
              </View>
              <Text
                style={[
                  styles.title,
                  { color: colors.text, fontFamily: f.extrabold },
                ]}
              >
                Verify your WhatsApp number
              </Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>
                ConvoReal requires every team member to verify their WhatsApp
                number with a one-time code before using the Engine.
              </Text>
            </View>

            {error ? <Banner kind="error" text={error} /> : null}
            {info && !error ? <Banner kind="success" text={info} /> : null}

            {stage === 'phone' ? (
              <>
                <TextField
                  icon="call-outline"
                  placeholder="WhatsApp number · e.g. 99002 77111"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  value={phone}
                  onChangeText={setPhone}
                />
                <PrimaryButton
                  label="Send code on WhatsApp"
                  busy={busy}
                  disabled={!phone.trim()}
                  onPress={sendCode}
                />
              </>
            ) : (
              <>
                <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
                <PrimaryButton
                  label="Verify"
                  busy={busy}
                  disabled={otp.length < 6}
                  onPress={() => verify(otp)}
                />
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: spacing.xl,
                  }}
                >
                  <Pressable
                    onPress={() => setStage('phone')}
                    hitSlop={10}
                    accessibilityRole="button"
                    style={{ paddingVertical: 10 }}
                  >
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 13.5,
                        fontFamily: f.semibold,
                      }}
                    >
                      Change number
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={resendIn > 0 || busy}
                    onPress={sendCode}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: resendIn > 0 || busy }}
                    style={{ paddingVertical: 10 }}
                  >
                    <Text
                      style={{
                        color: resendIn > 0 ? colors.textFaint : colors.primary,
                        fontSize: 13.5,
                        fontFamily: f.semibold,
                      }}
                    >
                      {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </GlassCard>
          <Pressable
            onPress={() => signOut()}
            hitSlop={10}
            accessibilityRole="button"
            style={{ alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 13.5 }}>
              Sign out
            </Text>
          </Pressable>
          <HelpCentreLink />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  formCard: { padding: spacing.xl, gap: spacing.xl },
  iconBadge: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontFamily: fonts.extrabold, textAlign: 'center' },
  body: { fontSize: 14.5, textAlign: 'center', lineHeight: 21 },
});
