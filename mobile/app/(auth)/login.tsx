import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { cleanPhoneInput } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { onGradient, radius, shadows, spacing, useBrandGradient, useTheme , fonts } from '@/lib/theme';

type Mode = 'whatsapp' | 'email';

const RESEND_SECONDS = 30;

/**
 * WhatsApp-first sign-in. Every staff account has an OTP-verified
 * WhatsApp number (migration 137), so `signInWithOtp` — delivered over
 * WhatsApp by the existing Send-SMS hook — is the primary flow, with
 * email/password as fallback. `shouldCreateUser: false` keeps this a
 * login-only path: account signup stays on the web.
 */
export default function LoginScreen() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>('whatsapp');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <LinearGradient
              colors={useBrandGradient()}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoBadge}
            >
              <Ionicons name="chatbubbles" size={34} color={onGradient.text} />
            </LinearGradient>
            <Text style={[styles.wordmark, { color: colors.primary }]}>ConvoReal</Text>
            <Text style={[styles.tagline, { color: colors.textMuted }]}>
              WhatsApp CRM for real estate
            </Text>
          </View>

          <View style={[styles.segment, { backgroundColor: colors.surface }]}>
            <SegmentButton
              label="WhatsApp"
              icon="logo-whatsapp"
              active={mode === 'whatsapp'}
              onPress={() => setMode('whatsapp')}
            />
            <SegmentButton
              label="Email"
              icon="mail-outline"
              active={mode === 'email'}
              onPress={() => setMode('email')}
            />
          </View>

          {mode === 'whatsapp' ? <WhatsappLogin /> : <EmailLogin />}

          <Text style={[styles.footer, { color: colors.textFaint }]}>
            Use the same account as the web app.{'\n'}New team members sign up on the web.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SegmentButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segmentButton,
        active && { backgroundColor: colors.surfaceRaised, ...styles.segmentActive },
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? colors.primary : colors.textMuted}
      />
      <Text
        style={{
          fontSize: 14,
          fontFamily: fonts.bold,
          color: active ? colors.text : colors.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function WhatsappLogin() {
  const { colors } = useTheme();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

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
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (otpError) {
      // Supabase phrases the no-such-user case as a signups error
      // because shouldCreateUser is false — translate it.
      setError(
        /signup|not allowed|not found/i.test(otpError.message)
          ? 'No account uses this WhatsApp number. Sign in with email, or sign up on the web first.'
          : otpError.message
      );
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
    // Success: the auth listener flips the session and (auth) redirects.
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {error ? <Banner kind="error" text={error} /> : null}
      {info && !error ? <Banner kind="success" text={info} /> : null}

      {stage === 'phone' ? (
        <>
          <TextField
            icon="logo-whatsapp"
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
          <Text style={{ fontSize: 12.5, color: colors.textFaint, textAlign: 'center' }}>
            We&apos;ll message a 6-digit code to your verified WhatsApp number.
          </Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
            Enter the code sent to{' '}
            <Text style={{ fontFamily: fonts.bold, color: colors.text }}>
              {cleanPhoneInput(phone) ?? phone}
            </Text>
          </Text>
          <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
          <PrimaryButton
            label="Verify & sign in"
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
              <Text style={{ color: colors.textMuted, fontSize: 13.5, fontFamily: fonts.semibold }}>
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
                  fontFamily: fonts.semibold,
                }}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function EmailLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setError(null);
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {error ? <Banner kind="error" text={error} /> : null}
      <TextField
        icon="mail-outline"
        placeholder="Email"
        keyboardType="email-address"
        autoComplete="email"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <TextField
        icon="lock-closed-outline"
        placeholder="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
      />
      <PrimaryButton
        label="Sign in"
        busy={busy}
        disabled={!email.trim() || !password}
        onPress={signIn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.sm },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  wordmark: { fontSize: 34, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  tagline: { fontSize: 15 },
  segment: { flexDirection: 'row', borderRadius: radius.lg, padding: 4, gap: 4 },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  segmentActive: { ...shadows.soft },
  footer: { fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
});
