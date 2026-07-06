import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

function rangeStart(range: string): Date {
  const now = new Date();
  if (range === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  // default: 'month' — start of current calendar month
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// GET /api/billing/credits/summary — spend aggregated per AI feature.
// Query params: range (month|30d|3m, default month)
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') ?? 'month';
    const since = rangeStart(range).toISOString();

    const { data, error } = await ctx.supabase
      .from('credit_transactions')
      .select('ai_feature, amount')
      .eq('account_id', ctx.accountId)
      .eq('type', 'ai_burn')
      .gte('created_at', since);

    if (error) {
      console.error('[GET /api/billing/credits/summary] query error:', error);
      return NextResponse.json({ error: 'Failed to load spend summary' }, { status: 500 });
    }

    const byFeature = new Map<string, number>();
    let totalSpent = 0;
    for (const row of data ?? []) {
      const feature = row.ai_feature ?? 'unknown';
      const spent = Math.abs(row.amount);
      byFeature.set(feature, (byFeature.get(feature) ?? 0) + spent);
      totalSpent += spent;
    }

    const features = Array.from(byFeature.entries())
      .map(([feature, credits]) => ({
        feature,
        credits,
        percentage: totalSpent > 0 ? Math.round((credits / totalSpent) * 100) : 0,
      }))
      .sort((a, b) => b.credits - a.credits);

    return NextResponse.json({ range, totalSpent, features });
  } catch (err) {
    return toErrorResponse(err);
  }
}
