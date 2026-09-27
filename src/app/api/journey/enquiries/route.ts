import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  JOURNEY_ENQUIRY_SELECT,
  journeyEnquiryEntries,
  type JourneyEnquiryRow,
} from '@/lib/journey/enquiries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const params = new URL(request.url).searchParams;
    const mode = params.get('mode');
    const subjectId = params.get('subjectId') ?? '';
    if (mode !== 'buyer' && mode !== 'property') {
      return NextResponse.json(
        { error: 'Invalid journey mode' },
        { status: 400 }
      );
    }
    if (!UUID.test(subjectId)) {
      return NextResponse.json(
        { error: 'Invalid journey subject' },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from('contact_property_inquiries')
      .select(JOURNEY_ENQUIRY_SELECT)
      .eq('account_id', accountId)
      .eq(mode === 'buyer' ? 'contact_id' : 'property_id', subjectId);
    if (error) throw error;
    return NextResponse.json({
      data: journeyEnquiryEntries(
        (data ?? []) as unknown as JourneyEnquiryRow[],
        mode
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
