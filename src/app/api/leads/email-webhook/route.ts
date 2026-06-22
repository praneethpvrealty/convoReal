import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';

// Lazy-initialized admin client
let _adminClient: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
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

// Helper to follow redirect headers (manual mode) to extract phone number
export async function resolvePhoneNumberFromUrl(url: string, depth = 0): Promise<string | null> {
  if (depth > 3) return null; // Avoid infinite redirects
  try {
    const cleanUrl = url.replace(/&amp;/g, '&');
    
    // Check if the URL itself already contains the phone number
    const directPhoneMatch = cleanUrl.match(/(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i);
    if (directPhoneMatch) {
      return directPhoneMatch[1];
    }
    
    const response = await fetch(cleanUrl, {
      method: 'GET',
      redirect: 'manual', // Stop redirecting automatically so we can read headers
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const location = response.headers.get('location');
    if (location) {
      const phoneMatch = location.match(/(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i);
      if (phoneMatch) {
        return phoneMatch[1];
      }
      if (location.startsWith('http')) {
        return await resolvePhoneNumberFromUrl(location, depth + 1);
      }
    }
    
    // Fallback: search within page body if it returned 200 instead of a redirect
    const body = await response.text();
    const bodyPhoneMatch = body.match(/(?:tel:|phone=|wa\.me\/|send\?phone=)(\+?\d{10,15})/i);
    if (bodyPhoneMatch) {
      return bodyPhoneMatch[1];
    }
  } catch (err) {
    console.error(`[resolvePhoneNumberFromUrl] Error at depth ${depth} for URL ${url}:`, err);
  }
  return null;
}

// Helper to extract action links from Housing.com email HTML
export function extractHousingUrls(html: string) {
  let whatsappUrl = '';
  let callNowUrl = '';
  let mailtoEmail = '';

  const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]*>/g, '').toLowerCase();

    if (href.startsWith('mailto:')) {
      mailtoEmail = href.replace('mailto:', '').split('?')[0].trim();
    } else if (text.includes('whatsapp') || href.includes('whatsapp')) {
      whatsappUrl = href;
    } else if (text.includes('call now') || text.includes('call') || href.includes('call')) {
      callNowUrl = href;
    }
  }

  return { whatsappUrl, callNowUrl, mailtoEmail };
}

// Asynchronously resolve Housing phone numbers
export async function resolveHousingPhone(html: string, bodyText: string): Promise<string> {
  const { whatsappUrl, callNowUrl } = extractHousingUrls(html || bodyText);
  
  if (whatsappUrl) {
    const phone = await resolvePhoneNumberFromUrl(whatsappUrl);
    if (phone) return phone;
  }
  
  if (callNowUrl) {
    const phone = await resolvePhoneNumberFromUrl(callNowUrl);
    if (phone) return phone;
  }
  
  // Regex fallback
  const phoneMatch = bodyText.match(/(?:phone|mobile)\s*[:|-]\s*([+\d\s-]{7,15})/i);
  if (phoneMatch) return phoneMatch[1].trim();
  
  return '';
}

// Extractor rules for different portals
export function parsePortalLead(subject: string, bodyText: string, html: string) {
  let name = '';
  let phone = '';
  let email = '';
  let requirementText = '';
  let source = 'Others';

  const combined = `${subject}\n${bodyText}`;

  if (combined.toLowerCase().includes('magicbricks')) {
    source = 'Magic Bricks';
    
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
    source = 'Housing';

    // Name extraction: "Name - Jane Doe" or "Name: Jane Doe"
    const nameMatch = bodyText.match(/name\s*[:|-]\s*(.+)/i);
    if (nameMatch) name = nameMatch[1].trim();

    // Phone extraction: "Phone - 9876543210" or "Mobile: 9876543210"
    const phoneMatch = bodyText.match(/(?:phone|mobile)\s*[:|-]\s*(.+)/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    // Email extraction: "Email - jane@example.com" or "Email: jane@example.com"
    const emailMatch = bodyText.match(/email\s*[:|-]\s*(.+)/i);
    if (emailMatch) email = emailMatch[1].trim();

    // Try mailto link from HTML
    if (html && !email) {
      const { mailtoEmail } = extractHousingUrls(html);
      if (mailtoEmail) email = mailtoEmail;
    }

    // Requirement extraction: "Requirement - 2 BHK Flat" or "regarding your villa:" etc.
    const reqMatch = bodyText.match(/(?:requirement|enquiry|interest| villa| house| apartment| plot)\s*[:|-]\s*(.+)/i);
    if (reqMatch) {
      requirementText = reqMatch[1].trim();
    } else {
      // Find standard lines following Devanahalli / Devanahallu / Property ID
      const propIdMatch = bodyText.match(/(?:Property ID|Property)\s*[:|-]\s*(.+)/i);
      if (propIdMatch) {
        requirementText = `Inquiry on Property ID: ${propIdMatch[1].trim()}`;
      }
    }

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
    const htmlContent = payload.html || '';

    if (!bodyText) {
      return NextResponse.json({ error: 'Empty email body text' }, { status: 400 });
    }

    // Auto-approve email forwarding confirmation request checks (e.g. Gmail forwarding setup)
    const isVerificationEmail = /forwarding.*confirm/i.test(subject) || 
                                 /verification/i.test(subject) || 
                                 /confirm.*forward/i.test(subject) ||
                                 /google.*forward/i.test(subject);
    if (isVerificationEmail) {
      console.log(`[lead-webhook] Forwarding verification email received. Subject: ${subject}`);
      
      // Parse Gmail confirmation code
      const codeMatch = bodyText.match(/(?:confirmation\s*code\s*:\s*|code\s*:\s*)(\d{8,12})/i);
      // Parse Gmail confirmation link
      const linkMatch = bodyText.match(/https:\/\/mail\.google\.com\/mail\/f-[^\s"'>]+/i);
      
      console.log(`[lead-webhook] ==========================================`);
      console.log(`[lead-webhook] GMAIL FORWARDING VERIFICATION RECEIVED`);
      if (codeMatch) {
        console.log(`[lead-webhook] ---> CONFIRMATION CODE: ${codeMatch[1]}`);
      }
      if (linkMatch) {
        console.log(`[lead-webhook] ---> CONFIRMATION LINK: ${linkMatch[0]}`);
      }
      if (!codeMatch && !linkMatch) {
        // Fallback: log raw text to help find details
        console.log(`[lead-webhook] Raw Content: ${bodyText.slice(0, 1500)}`);
      }
      console.log(`[lead-webhook] ==========================================`);

      return NextResponse.json({
        status: 'verification_received',
        message: 'Forwarding verification email successfully processed.',
      });
    }

    const parsed = parsePortalLead(subject, bodyText, htmlContent);

    // Dynamic resolution for Housing.com lead phone number
    if (parsed.source === 'Housing' && (!parsed.phone || parsed.phone === '')) {
      const resolvedPhone = await resolveHousingPhone(htmlContent, bodyText);
      if (resolvedPhone) {
        parsed.phone = resolvedPhone;
      }
    }

    if (!parsed.phone) {
      return NextResponse.json({ error: 'Failed to extract phone number from lead' }, { status: 422 });
    }

    const normalizedPhoneNum = normalizePhoneWithCountryCode(parsed.phone);
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

    // 2. Check if email lead sync is active for this account
    const { data: syncConfig } = await supabase
      .from('email_sync_configs')
      .select('is_active, auto_reply_enabled, auto_reply_text')
      .eq('account_id', accountId)
      .maybeSingle();

    if (syncConfig && !syncConfig.is_active) {
      return NextResponse.json({ error: 'Email lead synchronization is disabled for this account' }, { status: 403 });
    }

    // 3. Parse property preferences from requirement text
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

    const cleanPhone = normalizedPhoneNum.replace(/\D/g, '');
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .or(`phone.eq.${normalizedPhoneNum},phone.eq.${cleanPhone}`)
      .maybeSingle();

    if (existingContact) {
      // Update existing contact preferences
      const updatePayload: {
        max_budget?: number | null;
        areas_of_interest?: string[];
        property_interests?: string[];
        company?: string;
        source?: string;
      } = {};
      if (maxBudget) updatePayload.max_budget = maxBudget;
      if (areasOfInterest.length > 0) updatePayload.areas_of_interest = areasOfInterest;
      if (propertyInterests.length > 0) updatePayload.property_interests = propertyInterests;
      
      // Tag source
      updatePayload.company = parsed.source;
      updatePayload.source = parsed.source;

      await supabase
        .from('contacts')
        .update(updatePayload)
        .eq('id', existingContact.id);

      // Trigger automatic WhatsApp reply if configured
      if (syncConfig?.auto_reply_enabled && syncConfig.auto_reply_text) {
        const { data: waConfig } = await supabase
          .from('whatsapp_config')
          .select('phone_number_id, access_token')
          .eq('account_id', accountId)
          .eq('status', 'connected')
          .maybeSingle();

        if (waConfig) {
          const replyText = syncConfig.auto_reply_text
            .replace(/{name}/g, existingContact.name || 'there')
            .replace(/{source}/g, parsed.source || 'portal');
          
          try {
            await sendTextMessage({
              phoneNumberId: waConfig.phone_number_id,
              accessToken: waConfig.access_token,
              to: cleanPhone,
              text: replyText,
            });
          } catch (sendErr) {
            console.error('[lead-webhook] Failed to send auto-reply to existing contact:', sendErr);
          }
        }
      }

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
        source: parsed.source, // Storing lead portal name in dedicated source field
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

    // Trigger automatic WhatsApp reply if configured
    if (syncConfig?.auto_reply_enabled && syncConfig.auto_reply_text) {
      const { data: waConfig } = await supabase
        .from('whatsapp_config')
        .select('phone_number_id, access_token')
        .eq('account_id', accountId)
        .eq('status', 'connected')
        .maybeSingle();

      if (waConfig) {
        const replyText = syncConfig.auto_reply_text
          .replace(/{name}/g, parsed.name || 'there')
          .replace(/{source}/g, parsed.source || 'portal');
        
        try {
          await sendTextMessage({
            phoneNumberId: waConfig.phone_number_id,
            accessToken: waConfig.access_token,
            to: cleanPhone,
            text: replyText,
          });
        } catch (sendErr) {
          console.error('[lead-webhook] Failed to send auto-reply to new contact:', sendErr);
        }
      }
    }

    return NextResponse.json({
      status: 'created',
      contactId: newContact.id,
      name: newContact.name,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[lead-webhook] Request failed:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
