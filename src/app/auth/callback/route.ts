import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const invite = requestUrl.searchParams.get('invite');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const next = requestUrl.searchParams.get('next') || '/dashboard';
      if (invite) {
        return NextResponse.redirect(`${requestUrl.origin}/join/${encodeURIComponent(invite)}`);
      }
      return NextResponse.redirect(`${requestUrl.origin}${next}`);
    }
  }

  // Return the user to an error page or login screen if the exchange fails
  return NextResponse.redirect(`${requestUrl.origin}/login?error=OAuth+authentication+failed`);
}
