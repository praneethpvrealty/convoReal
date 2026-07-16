'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { User, Mail, Loader2, ArrowRight, Sparkles, LayoutDashboard, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ProfileSetupPageInner() {
  const { user, profile, loading: authLoading, profileLoading, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Redirection checks: if already filled, send to dashboard.
  useEffect(() => {
    console.log('[SETUP PAGE] checking state:', {
      authLoading,
      profileLoading,
      user: !!user,
      profile: profile ? { full_name: profile.full_name, email: profile.email } : null,
    });

    if (!authLoading && !user) {
      window.location.href = '/login';
    } else if (!authLoading && !profileLoading && user && profile) {
      const hasName = profile.full_name && profile.full_name.trim() !== '';
      const hasEmail = profile.email && profile.email.trim() !== '';
      if (hasName && hasEmail) {
        console.log('[SETUP PAGE] profile complete, redirecting to dashboard...');
        window.location.href = '/dashboard';
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
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('Profile setup save error:', err);
      const errMsg = err instanceof Error ? err.message : 'Failed to save profile. Please try again.';
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <ConvoRealLoader size={56} label="Loading Profile Setup" wordmark />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-950 px-4 overflow-hidden">
      {/* Ambient flows */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50 pointer-events-none" />

      <Card className="relative w-full max-w-md border border-slate-800/80 bg-slate-900/60 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden z-10 p-4">
        <CardHeader className="items-center text-center pb-4">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 shadow-inner">
            <Sparkles className="h-6 w-6 text-primary animate-pulse" />
          </div>
          <CardTitle className="text-2xl font-black text-white tracking-tight">
            Complete Your Profile
          </CardTitle>
          <CardDescription className="text-slate-400 font-medium">
            Enter your details below to activate your convoReal CRM account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="text-slate-300 font-bold text-xs">
                Full Name
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="pl-10 border-slate-800 bg-slate-950 text-white placeholder:text-slate-650 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl"
                />
              </div>
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300 font-bold text-xs">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="e.g. john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10 border-slate-800 bg-slate-950 text-white placeholder:text-slate-650 focus-visible:border-primary focus-visible:ring-primary/20 h-10 rounded-xl"
                />
              </div>
            </div>

            {/* Save Button */}
            <Button
              type="submit"
              disabled={saving}
              className="mt-6 h-10 w-full bg-primary hover:bg-primary/90 text-white text-xs font-bold rounded-xl cursor-pointer hover:scale-[1.01] hover:shadow-lg hover:shadow-primary/20 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Activating Account...
                </>
              ) : (
                <>
                  Get Started
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </>
              )}
            </Button>

            {/* Navigation footer */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800/50 mt-4">
              <button
                type="button"
                onClick={() => { window.location.href = '/dashboard'; }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <LayoutDashboard className="size-3.5" />
                Go to Dashboard
              </button>

              <button
                type="button"
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  window.location.href = '/login';
                }}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
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
