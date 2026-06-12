import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

// Lazy-initialized admin client
let _adminClient: any = null;
function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

// Helper to parse budget strings (e.g., "1.5 Cr", "80 Lakhs", "50 L")
function parseBudgetToINR(text: string): number | null {
  const clean = text.toLowerCase().replace(/,/g, '').trim();
  
  // Match Crores (Cr/Crore)
  const croreMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:cr|crore|crores)/);
  if (croreMatch) {
    return Math.round(parseFloat(croreMatch[1]) * 10000000);
  }

  // Match Lakhs (Lakh/L/Lakhs)
  const lakhMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|l)\b/);
  if (lakhMatch) {
    return Math.round(parseFloat(lakhMatch[1]) * 100000);
  }

  // Match raw number ranges
  const rawMatch = clean.match(/\b(\d{5,9})\b/);
  if (rawMatch) {
    return parseInt(rawMatch[1]);
  }

  return null;
}

// Extractor rules for different portals
function parsePortalLead(subject: string, bodyText: string) {
  let name = '';
  let phone = '';
  let email = '';
  let requirementText = '';
  let source = 'Email Lead';

  const combined = `${subject}\n${bodyText}`;

  if (combined.toLowerCase().includes('magicbricks')) {
    source = 'MagicBricks';
    
    // Name extraction: "Client Name: John Doe" or "Name: John Doe"
    const nameMatch = bodyText.match(/(?:client\s+name|name)\s*:\s*(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();

    // Phone extraction: "Mobile: +91-9876543210" or "Phone: 9876543210"
    const phoneMatch = bodyText.match(/(?:mobile|phone|contact)\s*:\s*(.+)/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    // Email extraction: "Email: john@example.com"
    const emailMatch = bodyText.match(/email\s*:\s*(.+)/i);
    if (emailMatch) email = emailMatch[1].trim();

    // Requirement extraction: "Requirement: 3 BHK in HSR Layout"
    const reqMatch = bodyText.match(/(?:requirement|preference|interest)\s*:\s*(.+)/i);
    if (reqMatch) requirementText = reqMatch[1].trim();

  } else if (combined.toLowerCase().includes('housing')) {
    source = 'Housing.com';

    // Name extraction: "Name - Jane Doe"
    const nameMatch = bodyText.match(/name\s*-\s*(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();

    // Phone extraction: "Phone - 9876543210" or "Mobile - 9876543210"
    const phoneMatch = bodyText.match(/(?:phone|mobile)\s*-\s*(.+)/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    // Email extraction: "Email - jane@example.com"
    const emailMatch = bodyText.match(/email\s*-\s*(.+)/i);
    if (emailMatch) email = emailMatch[1].trim();

    // Requirement extraction: "Requirement - 2 BHK Flat"
    const reqMatch = bodyText.match(/(?:requirement|enquiry|interest)\s*-\s*(.+)/i);
    if (reqMatch) requirementText = reqMatch[1].trim();

  } else if (combined.toLowerCase().includes('99acres')) {
    source = '99acres';

    // Name extraction: "Lead Name: Robert Smith" or "Sender Name: Robert Smith"
    const nameMatch = bodyText.match(/(?:lead\s+name|sender\s+name|name)\s*:\s*(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();

    // Phone extraction: "Mobile Number: +919876543210" or "Phone Number: 9876543210"
    const phoneMatch = bodyText.match(/(?:mobile|phone)\s*(?:number)?\s*:\s*(.+)/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    // Email extraction: "Email Address: robert@example.com"
    const emailMatch = bodyText.match(/email\s*(?:address)?\s*:\s*(.+)/i);
    if (emailMatch) email = emailMatch[1].trim();

    // Requirement extraction: "Requirements: 4 BHK Villa in Whitefield"
    const reqMatch = bodyText.match(/(?:requirements|query|details)\s*:\s*(.+)/i);
    if (reqMatch) requirementText = reqMatch[1].trim();
  } else {
    // Fallback parser for generic lead emails
    const nameMatch = bodyText.match(/(?:name|lead|sender)\s*[:|-]\s*(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();

    const phoneMatch = bodyText.match(/(?:phone|mobile|tel|contact)\s*[:|-]\s*([+\d\s-]{7,15})/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    const emailMatch = bodyText.match(/(?:email|mail)\s*[:|-]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) email = emailMatch[1].trim();

    const reqMatch = bodyText.match(/(?:requirement|preferences|comments|inquiry)\s*[:|-]\s*(.+)/i);
    if (reqMatch) requirementText = reqMatch[1].trim();
  }

  // Clean values from HTML wrappers or carriage returns
  const cleanLine = (str: string) => str.replace(/<[^>]*>/g, '').split(/[\r\n]/)[0].trim();

  return {
    name: name ? cleanLine(name) : 'Portal Lead',
    phone: phone ? cleanLine(phone) : '',
    email: email ? cleanLine(email) : '',
    requirementText: requirementText ? cleanLine(requirementText) : '',
    source,
  };
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    let accountId = searchParams.get('account_id');

    // Token validation (Optional check)
    const expectedToken = process.env.LEADS_WEBHOOK_TOKEN;
    if (expectedToken && token !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized token' }, { status: 401 });
    }

    const payload = await request.json();
    const subject = payload.subject || '';
    const bodyText = payload.text || payload.html || '';

    if (!bodyText) {
      return NextResponse.json({ error: 'Empty email body text' }, { status: 400 });
    }

    const parsed = parsePortalLead(subject, bodyText);

    if (!parsed.phone) {
      return NextResponse.json({ error: 'Failed to extract phone number from lead' }, { status: 422 });
    }

    const normalizedPhoneNum = normalizePhone(parsed.phone);
    if (!normalizedPhoneNum) {
      return NextResponse.json({ error: 'Extracted phone number is invalid' }, { status: 422 });
    }

    const supabase = getAdminClient();

    // 1. Resolve account_id if missing
    if (!accountId) {
      const { data: firstConfig } = await supabase
        .from('whatsapp_config')
        .select('account_id')
        .limit(1)
        .maybeSingle();
      
      if (firstConfig) {
        accountId = firstConfig.account_id;
      }
    }

    if (!accountId) {
      return NextResponse.json({ error: 'No account ID resolved' }, { status: 400 });
    }

    // 2. Parse property preferences from requirement text
    let maxBudget: number | null = null;
    const areasOfInterest: string[] = [];
    const propertyInterests: string[] = [];

    if (parsed.requirementText) {
      maxBudget = parseBudgetToINR(parsed.requirementText);

      // Extract property type keywords
      const reqLower = parsed.requirementText.toLowerCase();
      if (reqLower.includes('bhk') || reqLower.includes('apartment') || reqLower.includes('flat')) {
        propertyInterests.push('Flat/ Apartment');
      }
      if (reqLower.includes('plot') || reqLower.includes('land') || reqLower.includes('site')) {
        propertyInterests.push('Vacant plot');
      }
      if (reqLower.includes('building') || reqLower.includes('house') || reqLower.includes('villa')) {
        propertyInterests.push('Vacant building');
      }

      // Check for popular locations mentioned
      const popularLocalities = ['hsr', 'whitefield', 'koramangala', 'indiranagar', 'jayanagar', 'jp nagar'];
      popularLocalities.forEach((loc) => {
        if (reqLower.includes(loc)) {
          // Capitalize first letter
          const formatted = loc === 'hsr' || loc === 'jp nagar'
            ? loc.toUpperCase()
            : loc.charAt(0).toUpperCase() + loc.slice(1);
          areasOfInterest.push(formatted);
        }
      });
    }

    // 3. Check if contact exists
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('phone', normalizedPhoneNum)
      .maybeSingle();

    if (existingContact) {
      // Update existing contact preferences
      const updatePayload: any = {};
      if (maxBudget) updatePayload.max_budget = maxBudget;
      if (areasOfInterest.length > 0) updatePayload.areas_of_interest = areasOfInterest;
      if (propertyInterests.length > 0) updatePayload.property_interests = propertyInterests;
      
      // Tag source
      updatePayload.company = parsed.source;

      await supabase
        .from('contacts')
        .update(updatePayload)
        .eq('id', existingContact.id);

      return NextResponse.json({
        status: 'updated',
        contactId: existingContact.id,
        name: existingContact.name,
      });
    }

    // 4. Insert new buyer contact
    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        account_id: accountId,
        name: parsed.name,
        phone: normalizedPhoneNum,
        email: parsed.email || null,
        classification: 'Buyer',
        company: parsed.source, // Stashing the lead portal name in company field
        max_budget: maxBudget,
        areas_of_interest: areasOfInterest.length > 0 ? areasOfInterest : null,
        property_interests: propertyInterests.length > 0 ? propertyInterests : null,
        status: 'pending_review',
      })
      .select('id, name')
      .single();

    if (insertErr) {
      console.error('[lead-webhook] Error inserting contact:', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // 5. Create active conversation thread
    await supabase.from('conversations').insert({
      account_id: accountId,
      contact_id: newContact.id,
      last_message_text: `📥 New Lead from ${parsed.source}: ${parsed.requirementText || 'No comments'}`,
      last_message_at: new Date().toISOString(),
    });

    return NextResponse.json({
      status: 'created',
      contactId: newContact.id,
      name: newContact.name,
    });
  } catch (err: any) {
    console.error('[lead-webhook] Request failed:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
