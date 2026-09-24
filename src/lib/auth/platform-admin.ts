import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role !== 'super_admin') {
    throw new ForbiddenError();
  }
  return { userId: user.id };
}
