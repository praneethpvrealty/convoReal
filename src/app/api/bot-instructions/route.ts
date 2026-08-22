import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  BOT_INSTRUCTION_INFLUENCES,
  type BotInstructionInfluence,
} from '@/lib/ai/bot-instructions';
import { isLanguageCode } from '@/lib/languages';

const MAX_DIRECTIVE_LENGTH = 1000;
const CONTACT_CLASSIFICATIONS = [
  'Owner',
  'Seller',
  'Buyer',
  'Agent',
  'Developer',
  'Owner & Buyer',
  'Others',
] as const;
const LISTING_TYPES = ['Sale', 'Rent', 'JV/JD', 'Built to Suit'] as const;

function optionalEnum(value: unknown, allowed: readonly string[]) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && allowed.includes(value)
    ? value
    : undefined;
}

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const { data, error } = await ctx.supabase
      .from('bot_instructions')
      .select(
        'id, directive, influence, status, source, contact_classification, listing_type, funnel_stage, language, hit_count, last_hit_at, created_at, updated_at'
      )
      .eq('account_id', ctx.accountId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = await checkRateLimit(
      `bot-instructions:create:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const directive =
      typeof body?.directive === 'string' ? body.directive.trim() : '';
    if (!directive || directive.length > MAX_DIRECTIVE_LENGTH) {
      return NextResponse.json(
        { error: `Rule text must be 1–${MAX_DIRECTIVE_LENGTH} characters` },
        { status: 400 }
      );
    }
    const influence = body?.influence as BotInstructionInfluence;
    if (!BOT_INSTRUCTION_INFLUENCES.includes(influence)) {
      return NextResponse.json(
        { error: 'Choose a supported influence area' },
        { status: 400 }
      );
    }

    const contactClassification = optionalEnum(
      body?.contact_classification,
      CONTACT_CLASSIFICATIONS
    );
    const listingType = optionalEnum(body?.listing_type, LISTING_TYPES);
    const language =
      body?.language === undefined ||
      body.language === null ||
      body.language === ''
        ? null
        : isLanguageCode(body.language)
          ? body.language
          : undefined;
    if (
      contactClassification === undefined ||
      listingType === undefined ||
      language === undefined
    ) {
      return NextResponse.json(
        { error: 'Invalid rule scope' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('bot_instructions')
      .insert({
        account_id: ctx.accountId,
        directive,
        influence,
        status: 'active',
        source: 'typed',
        contact_classification: contactClassification,
        listing_type: listingType,
        funnel_stage: null,
        language,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
