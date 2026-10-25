import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  SESSION_PROFILE_SELECT,
  toSessionProfile,
  type SessionProfileResponse,
  type SessionProfileRow,
} from '@/lib/auth/session-profile';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(SESSION_PROFILE_SELECT)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[auth/profile] profile read failed:', {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: 'Could not load profile' },
        { status: 502 }
      );
    }

    const body: SessionProfileResponse = {
      data: data ? toSessionProfile(data as SessionProfileRow) : null,
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    console.error('[auth/profile] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
