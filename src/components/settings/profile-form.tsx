'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Upload,
  Trash2,
  Mail,
  CircleAlert,
  Sparkles,
  BookOpen,
  LayoutGrid,
  UserRound,
  Box,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { storagePublicUrl } from '@/lib/storage/url';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WhatsappPhoneVerify } from '@/components/auth/whatsapp-phone-verify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  DEFAULT_SHOWCASE_STYLE,
  type ShowcaseStyle,
} from '@/lib/showcase/style';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// Rough email shape check — the real validator is Supabase Auth, which
// rejects anything malformed when we call updateUser({ email }). We
// just want to stop obvious typos before making a network call.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SHOWCASE_STYLE_OPTIONS: Array<{
  value: ShowcaseStyle;
  label: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    value: 'spotlight',
    label: 'Spotlight',
    description: 'Cinematic, photo-first listings',
    icon: Sparkles,
  },
  {
    value: 'editorial',
    label: 'Editorial',
    description: 'Refined magazine presentation',
    icon: BookOpen,
  },
  {
    value: 'gallery',
    label: 'Gallery',
    description: 'Fast, visual property browsing',
    icon: LayoutGrid,
  },
  {
    value: 'signature',
    label: 'Signature',
    description: 'Agent-led personal branding',
    icon: UserRound,
  },
];

export function ProfileForm() {
  const { user, profile, refreshProfile } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailChangePending, setEmailChangePending] = useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [showcaseStyle, setShowcaseStyle] = useState<ShowcaseStyle>(
    DEFAULT_SHOWCASE_STYLE
  );
  const [showcase3dEnabled, setShowcase3dEnabled] = useState(true);

  // Seed form state once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setEmail(profile.email ?? '');
    setShowcaseStyle(profile.showcase_style ?? DEFAULT_SHOWCASE_STYLE);
    setShowcase3dEnabled(profile.showcase_3d_enabled ?? true);
  }, [profile]);

  // Cleanup object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar && profile?.avatar_url ? storagePublicUrl(profile.avatar_url) : null);

  const initial = (fullName || profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error('Unsupported image type', {
        description: 'Use PNG, JPG, WebP, or GIF.',
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image is too large', {
        description: 'Maximum 2 MB.',
      });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error('Display name is required');
      return;
    }
    const trimmedEmail = email.trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      toast.error('Enter a valid email address');
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext =
          pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('avatars').getPublicUrl(path);
        nextAvatarUrl = publicUrl;
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // Persist name + avatar to profiles. Phone is NOT written here —
      // it's OTP-verified through Supabase Auth and mirrored onto
      // profiles.phone by a DB trigger (migration 137); a direct write
      // would be rejected by the profiles_phone_guard trigger.
      const { data: saved, error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          avatar_url: nextAvatarUrl,
          showcase_style: showcaseStyle,
          showcase_3d_enabled: showcase3dEnabled,
        })
        .eq('user_id', user.id)
        .select('user_id');
      if (updateError) {
        throw new Error(`Save failed: ${updateError.message}`);
      }
      if (!saved?.length) {
        throw new Error('Save failed: your profile could not be updated.');
      }

      // Email change goes through Supabase Auth, which emails a
      // confirmation to both the old and new addresses. We don't
      // touch profiles.email — Supabase will push the change there
      // after the user clicks the link (handled by the handle_new_user
      // trigger pattern in production deployments).
      let emailSent = false;
      if (trimmedEmail.toLowerCase() !== profile.email.toLowerCase()) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: trimmedEmail,
        });
        if (emailError) {
          // Partial success: name/avatar saved but email didn't.
          toast.success('Profile saved');
          toast.error(`Email change failed: ${emailError.message}`);
          setSaving(false);
          await refreshProfile();
          return;
        }
        emailSent = true;
      }

      setEmailChangePending(emailSent);
      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();

      toast.success(
        emailSent
          ? 'Profile saved — check your email to confirm the address change'
          : 'Profile saved',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      email.trim().toLowerCase() !== (profile.email ?? '').toLowerCase() ||
      pendingAvatar !== null ||
      removeAvatar ||
      showcaseStyle !== (profile.showcase_style ?? DEFAULT_SHOWCASE_STYLE) ||
      showcase3dEnabled !== (profile.showcase_3d_enabled ?? true));

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <Card className="bg-slate-900/40 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white">Profile</CardTitle>
        <CardDescription className="text-slate-400">
          How you show up across the app. Your avatar and name appear in the
          header, sidebar, and anywhere your teammates see you.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          {/* Avatar row */}
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {currentAvatar ? (
                <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-base text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Upload className="size-4" />
                {currentAvatar ? 'Change photo' : 'Upload photo'}
              </Button>
              {currentAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onRemoveAvatar}
                  disabled={saving}
                  className="text-slate-400 hover:text-white"
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              )}
              <p className="w-full text-xs text-slate-500">
                PNG, JPG, WebP, or GIF. Up to 2 MB.
              </p>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="profile-full-name" className="text-slate-200">
              Display name
            </Label>
            <Input
              id="profile-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ada Lovelace"
              maxLength={120}
              disabled={saving}
              required
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="profile-email" className="text-slate-200">
              Email
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              required
            />
            {emailChangePending && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                <Mail className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Check the inbox for <strong>{profile?.email}</strong> and{' '}
                  <strong>{email}</strong> — both need to confirm before the
                  change takes effect.
                </span>
              </p>
            )}
          </div>

          {/* Phone — verified via WhatsApp OTP only, never free text.
              profiles.phone mirrors the verified auth phone (trigger,
              migration 137). */}
          <div className="space-y-2">
            <Label className="text-slate-200">WhatsApp number</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="tel"
                value={profile?.phone ?? ''}
                placeholder="Not verified yet"
                readOnly
                disabled
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setPhoneDialogOpen(true)}
              >
                {profile?.phone ? 'Change number' : 'Verify number'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              ConvoReal is a WhatsApp-based platform — this verified number is where your
              enquiries, alerts and listing sync arrive. Changing it requires a WhatsApp OTP.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-slate-200">Personal showcase style</Label>
              <p className="mt-1 text-xs text-slate-500">
                Choose how properties appear on your personal agent showcase
                link.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SHOWCASE_STYLE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = showcaseStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={saving}
                    onClick={() => setShowcaseStyle(option.value)}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-white'
                        : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={showcase3dEnabled}
              disabled={saving}
              onClick={() => setShowcase3dEnabled((enabled) => !enabled)}
              className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                showcase3dEnabled
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              <span className="bg-slate-850 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Box className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-white">
                  3D property transitions
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Cards tilt into focus while visitors move between listings.
                </span>
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  showcase3dEnabled
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {showcase3dEnabled ? 'On' : 'Off'}
              </span>
            </button>
          </div>

          {/* Read-only block */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Account details
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Role</dt>
                <dd className="mt-0.5 font-mono text-slate-200">
                  {profile?.role ?? 'user'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Joined</dt>
                <dd className="mt-0.5 text-slate-200">{joined}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">User ID</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-slate-400">
                  {user?.id ?? '—'}
                </dd>
              </div>
            </dl>
          </div>

          {!profile && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <CircleAlert className="size-4" />
              Loading your profile…
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty || !profile}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </form>

        <Dialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {profile?.phone ? 'Change your WhatsApp number' : 'Verify your WhatsApp number'}
              </DialogTitle>
              <DialogDescription>
                ConvoReal runs on WhatsApp, so every number change is confirmed with a one-time
                code sent to the new number.
              </DialogDescription>
            </DialogHeader>
            <WhatsappPhoneVerify
              idPrefix="settings-phone"
              onVerified={async () => {
                setPhoneDialogOpen(false);
                // The DB trigger has mirrored the verified number onto
                // profiles.phone — just refetch to show it.
                await refreshProfile();
                toast.success('WhatsApp number verified.');
              }}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
