import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const REFUSAL_CODES = new Set(['42501', '22023']);

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fullName, email } = await req.json();

    const nameVal = fullName?.trim();
    const emailVal = email?.trim().toLowerCase();

    if (!nameVal || !emailVal) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { data: accountId, error: bootstrapError } =
      await supabaseAdmin().rpc('bootstrap_staff_account', {
        p_user_id: user.id,
        p_full_name: nameVal,
        p_email: emailVal,
      });

    if (bootstrapError) {
      if (REFUSAL_CODES.has(bootstrapError.code)) {
        return NextResponse.json(
          { error: bootstrapError.message },
          { status: 403 }
        );
      }
      console.error('[SETUP API] Bootstrap failed:', bootstrapError);
      return NextResponse.json(
        { error: `Failed to save profile: ${bootstrapError.message}` },
        { status: 500 }
      );
    }
    if (!accountId) {
      return NextResponse.json(
        { error: 'Failed to bootstrap account' },
        { status: 500 }
      );
    }

    try {
      await supabase.auth.updateUser({ email: emailVal });
    } catch (authErr) {
      console.warn('[SETUP API] Auth email update warning:', authErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[SETUP API] Unexpected error executing setup route:', err);
    const errMsg = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
