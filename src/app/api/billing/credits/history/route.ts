import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

const PAGE_SIZE = 20;
const REFERRAL_TYPES = ['referral_signup', 'referral_upgrade', 'referral_passive'];

// GET /api/billing/credits/history — paginated transaction ledger.
// Query params: page (1-indexed, default 1), filter (all|earned|spent|purchased|referral), from, to (ISO dates)
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const filter = searchParams.get('filter') ?? 'all';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let query = ctx.supabase
      .from('credit_transactions')
      .select('*', { count: 'exact' })
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (filter === 'earned') {
      query = query.gt('amount', 0).neq('type', 'purchase');
    } else if (filter === 'spent') {
      query = query.lt('amount', 0);
    } else if (filter === 'purchased') {
      query = query.eq('type', 'purchase');
    } else if (filter === 'referral') {
      query = query.in('type', REFERRAL_TYPES);
    }

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error, count } = await query.range(start, end);

    if (error) {
      console.error('[GET /api/billing/credits/history] query error:', error);
      return NextResponse.json({ error: 'Failed to load transaction history' }, { status: 500 });
    }

    return NextResponse.json({
      transactions: data ?? [],
      page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
