import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ status: 'degraded' }, { status: 503 });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/beta_program_public`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        cache: 'no-store',
        signal: AbortSignal.timeout(3_000),
      }
    );

    if (!response.ok) {
      return NextResponse.json({ status: 'degraded' }, { status: 503 });
    }

    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'degraded' }, { status: 503 });
  }
}
