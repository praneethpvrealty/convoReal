'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  User,
  Mail,
  Loader2,
  ArrowRight,
  Sparkles,
  LayoutDashboard,
  LogOut,
} from 'lucide-react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { reloadTo } from '@/lib/navigation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ProfileSetupPageInner() {
  const {
    user,
    profile,
    loading: authLoading,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Redirection checks: if already filled, send to dashboard.
  useEffect(() => {
    console.log('[SETUP PAGE] checking state:', {
      authLoading,
      profileLoading,
      user: !!user,
      profile: profile
        ? { full_name: profile.full_name, email: profile.email }
        : null,
    });

    if (!authLoading && !user) {
      reloadTo('/login');
    } else if (!authLoading && !profileLoading && user && profile) {
      const hasName = profile.full_name && profile.full_name.trim() !== '';
      const hasEmail = profile.email && profile.email.trim() !== '';
      if (hasName && hasEmail) {
        console.log(
          '[SETUP PAGE] profile complete, redirecting to dashboard...'
        );
        reloadTo('/dashboard');
      }
    }
  }, [user, profile, authLoading, profileLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const nameVal = fullName.trim();
    const emailVal = email.trim().toLowerCase();

    if (!nameVal) {
      toast.error('Please enter your full name');
      return;
    }

    if (!emailVal || !EMAIL_RE.test(emailVal)) {
      toast.error('Please enter a valid email address');
      return;
    }

    try {
      setSaving(true);

      // Call the secure server-side setup API endpoint (bypasses client-side RLS constraints on accounts/profiles)
      const response = await fetch('/api/auth/profile-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: nameVal,
          email: emailVal,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || 'Failed to complete profile setup');
      }

      await refreshProfile();
      toast.success('Welcome! Your profile has been created.');

      // Perform a hard page reload redirection to force Next.js Layout gates to read the fresh DB profile state
      reloadTo('/dashboard');
    } catch (err) {
      console.error('Profile setup save error:', err);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Failed to save profile. Please try again.';
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <ConvoRealLoader size={30} label="Loading Profile Setup" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4">
      {/* Ambient flows */}
      <div className="bg-primary/10 pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 bottom-1/4 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]" />

      {/* Background grid */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] bg-[size:4rem_4rem] opacity-50" />

      <Card className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-2xl backdrop-blur-xl">
        <CardHeader className="items-center pb-4 text-center">
          <div className="bg-primary/10 border-primary/20 mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border shadow-inner">
            <Sparkles className="text-primary h-6 w-6 animate-pulse" />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight text-white">
            Complete Your Profile
          </CardTitle>
          <CardDescription className="font-medium text-slate-400">
            Enter your details below to activate your ConvoReal account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label
                htmlFor="fullName"
                className="text-xs font-bold text-slate-300"
              >
                Full Name
              </Label>
              <div className="relative">
                <User className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="placeholder:text-slate-650 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl border-slate-800 bg-slate-950 pl-10 text-white"
                />
              </div>
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-bold text-slate-300"
              >
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="placeholder:text-slate-650 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl border-slate-800 bg-slate-950 pl-10 text-white"
                />
              </div>
            </div>

            {/* Save Button */}
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 hover:shadow-primary/20 mt-6 h-10 w-full cursor-pointer rounded-xl text-xs font-bold text-white transition-all hover:scale-[1.01] hover:shadow-lg active:scale-[0.99] disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Activating Account...
                </>
              ) : (
                <>
                  Get Started
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </Button>

            {/* Navigation footer */}
            <div className="mt-4 flex items-center justify-between border-t border-slate-800/50 pt-4">
              <button
                type="button"
                onClick={() => {
                  reloadTo('/dashboard');
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
              >
                <LayoutDashboard className="size-3.5" />
                Go to Dashboard
              </button>

              <button
                type="button"
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  reloadTo('/login');
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-red-400"
              >
                <LogOut className="size-3.5" />
                Sign Out
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProfileSetupPage() {
  return (
    <AuthProvider>
      <ProfileSetupPageInner />
    </AuthProvider>
  );
}
