import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { OtpInput } from '@/components/otp-input';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { cleanPhoneInput } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useSurface } from '@/lib/surface';
import { spacing, useTheme } from '@/lib/theme';

const RESEND_SECONDS = 30;

/**
 * Owners Den sign-in — the owner-facing counterpart of the staff
 * login. Unlike staff (login-only), Den signups are allowed here;
 * `app_context: 'den'` keeps new users out of the staff account
 * bootstrap (migration 132), exactly like the web /den/login page.
 * On success the (auth) layout routes to /(den) via the surface flag.
 */
export default function DenLoginScreen() {
  const { colors, fonts: f } = useTheme();
  const setSurface = useSurface((s) => s.setSurface);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Entering this screen commits the device to the Den surface; the
  // (auth)/(app) layouts route by it once the session lands.
  useEffect(() => {
    setSurface('den');
  }, [setSurface]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    setError(null);
    setInfo(null);
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone) {
      setError('Enter a valid WhatsApp number (e.g. 9900277111 or +919900277111)');
      return;
    }
    setBusy(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: cleanPhone,
      options: { data: { app_context: 'den' } },
    });
    setBusy(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setInfo('Code sent to your WhatsApp!');
    setStage('code');
    setOtp('');
    setResendIn(RESEND_SECONDS);
  }

  async function verify(code: string) {
    const cleanPhone = cleanPhoneInput(phone);
    if (!cleanPhone || busy) return;
    setError(null);
    setBusy(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: cleanPhone,
      token: code,
      type: 'sms',
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      setOtp('');
    }
    // Success: the auth listener flips the session; the (auth) layout
    // redirects to /(den) (surface flag), which completes Den auth.
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
          <View style={{ alignItems: 'center', gap: spacing.sm }}>
            <View style={[styles.iconBadge, { backgroundColor: colors.successSoft }]}>
              <Ionicons name="home" size={32} color={colors.success} />
            </View>
            <Text style={{ fontSize: 26, fontFamily: f.extrabold, color: colors.text }}>
              Owners Den
            </Text>
            <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
              Track interest, offers and deals on your properties — across every
              agency that lists them.
            </Text>
          </View>

          <GlassCard style={styles.formCard}>
            {error ? <Banner kind="error" text={error} /> : null}
            {info && !error ? <Banner kind="success" text={info} /> : null}

            {stage === 'phone' ? (
              <>
                <TextField
                  icon="logo-whatsapp"
                  placeholder="WhatsApp number · e.g. 99002 77111"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  returnKeyType="go"
                  onSubmitEditing={sendCode}
                  value={phone}
                  onChangeText={setPhone}
                />
                <PrimaryButton
                  label="Continue with WhatsApp"
                  busy={busy}
                  disabled={!phone.trim()}
                  onPress={sendCode}
                />
                <Text style={{ fontSize: 12.5, color: colors.textFaint, textAlign: 'center' }}>
                  First time here? The same code signs you up.
                </Text>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
                  Enter the code sent to{' '}
                  <Text style={{ fontFamily: f.bold, color: colors.text }}>
                    {cleanPhoneInput(phone) ?? phone}
                  </Text>
                </Text>
                <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
                <PrimaryButton
                  label="Verify & enter the Den"
                  busy={busy}
                  disabled={otp.length < 6}
                  onPress={() => verify(otp)}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
                  <Pressable
                    onPress={() => setStage('phone')}
                    hitSlop={10}
                    accessibilityRole="button"
                    style={{ paddingVertical: 10 }}
                  >
                    <Text style={{ color: colors.textMuted, fontSize: 13.5, fontFamily: f.semibold }}>
                      Change number
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={resendIn > 0}
                    onPress={sendCode}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: resendIn > 0 }}
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
            onPress={() => {
              useSurface.getState().setSurface('staff');
              router.back();
            }}
            hitSlop={10}
            accessibilityRole="button"
            style={{ alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 13.5 }}>
              ← Back to team sign-in
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formCard: { padding: spacing.xl, gap: spacing.lg },
});
