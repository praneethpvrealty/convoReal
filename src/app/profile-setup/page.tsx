'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { User, Mail, Loader2, ArrowRight, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProfileSetupPage() {
  const { user, profile, loading: authLoading, profileLoading, refreshProfile } = useAuth();
  const supabase = createClient();

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

      // 1. Check if profile row exists in the database
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      let resolvedAccountId = existingProfile?.account_id;

      // Self-healing: if no account is linked, create one dynamically
      if (!resolvedAccountId) {
        console.log('[SETUP] No account linked. Creating new tenant account...');
        const { data: newAccount, error: accError } = await supabase
          .from('accounts')
          .insert({
            name: `${nameVal}'s Account`,
          })
          .select('id')
          .maybeSingle();

        if (accError || !newAccount) {
          throw new Error(`Failed to bootstrap account: ${accError?.message || 'Unknown error'}`);
        }
        resolvedAccountId = newAccount.id;
      }

      // 2. Upsert the database profiles row directly to keep CRM synced immediately
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          full_name: nameVal,
          email: emailVal,
          account_id: resolvedAccountId,
          account_role: existingProfile?.account_id ? undefined : 'owner',
        }, {
          onConflict: 'user_id',
        });

      if (profileError) throw profileError;

      // 3. Attempt to link/update the email address in Supabase Auth user metadata
      try {
        await supabase.auth.updateUser({ email: emailVal });
      } catch (authErr) {
        console.warn('Auth email update warning:', authErr);
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
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-slate-400">Loading Profile Setup...</p>
        </div>
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
