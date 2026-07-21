import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getAdminClient } from './admin-client';
import {
  parseMimeEmail,
  decodeMimeSubject,
  decodeQuotedPrintable,
  isValidContactName,
  stripOwnerSuffix,
  classifyPortalLead,
  parseBudgetToINR,
  parsePortalLead,
} from './email-parser';
import { resolveHousingPhone } from './phone-resolver';
import { writeSyncLog, assignTagsToContact } from './db-utils';
import { sendAutoReply } from './auto-reply';
import { runAutomationsForTrigger } from '@/lib/automations/engine';

// Re-export for route.test.ts and backward compatibility
export {
  decodeQuotedPrintable,
  decodeMimeSubject,
  parseMimeEmail,
  stripHtmlToText,
  stripOwnerSuffix,
  classificationFromNameSuffix,
  classifyPortalLead,
  isInquiryAboutOwnListing,
  parsePortalLead,
} from './email-parser';

export {
  resolvePhoneNumberFromUrl,
  extractHousingUrls,
  resolveHousingPhone,
} from './phone-resolver';

// Type for property matching in email webhooks
interface PropertyForMatching {
  id: string;
  title: string;
  type: string | null;
  location: string | null;
  bedrooms: number | null;
  area_sqft: number | null;
  price: number | null;
  property_code: string | null;
}

export function normalizeLocationString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\bix\b/g, '9')
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\bv\b/g, '5')
    .replace(/\biv\b/g, '4')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bi\b/g, '1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkLocationMatch(parsedLoc: string, propertyLoc: string): boolean {
  if (!parsedLoc || !propertyLoc) return false;
  
  const normParsed = normalizeLocationString(parsedLoc);
  const normProperty = normalizeLocationString(propertyLoc);
  
  // 1. Direct substring match on normalized strings
  if (normProperty.includes(normParsed) || normParsed.includes(normProperty)) {
    return true;
  }
  
  // 2. Token overlap check
  const parsedWords = normParsed.split(' ').filter(w => w.length > 1);
  const propertyWords = normProperty.split(' ').filter(w => w.length > 1);
  
  if (parsedWords.length === 0 || propertyWords.length === 0) return false;
  
  // Check how many of the parsed location's words are in the property location
  const matchCount = parsedWords.filter(w => propertyWords.includes(w)).length;
  
  // If the parsed location is longer (e.g. "Surya City Phase 2" has 4 words),
  // we require at least 75% of its words to be present in the property location.
  // If it's a short location (1 or 2 words), we require all of them to be present.
  const threshold = parsedWords.length <= 2 ? parsedWords.length : Math.ceil(parsedWords.length * 0.75);
  
  return matchCount >= threshold;
}

export function checkIsNonLeadEmail(subject: string, sender: string): boolean {
  // System/notification emails
  if (/^noreply@|^no-reply@|^donotreply@|^mailer-daemon@/i.test(sender)) {
    // Exempt known portal lead senders even if they use a noreply address
    const isPortalSender = /housing-mailer\.com|99acres\.com|magicbricks\.com/i.test(sender);
    if (!isPortalSender) {
      return true;
    }
  }

  // Account-related notifications
  if (/account\s+(update|change|alert|notification|verify|security|suspension|deactivation)/i.test(subject)) return true;

  // Payment/billing notifications
  if (/(payment|billing|invoice|subscription|renewal|expiry|expir)/i.test(subject)) return true;

  // Newsletter/marketing blasts (not individual leads)
  if (/(newsletter|weekly\s+digest|daily\s+update|marketing|promotional|unsubscribe)/i.test(subject)) return true;

  // Password reset / OTP
  if (/(password|otp|one.time|reset.*password|forgot.*password)/i.test(subject)) return true;

  // Property listing updates (not individual inquiries)
  if (/(new\s+listings?\s+in|property\s+alert|price\s+drop|listing\s+update)/i.test(subject) && !/buyer\s+wants/i.test(subject)) return true;

  // Auto-generated reports
  if (/(weekly|monthly|daily)\s+report/i.test(subject)) return true;

  // LinkedIn notifications
  if (/linkedin/i.test(sender)) return true;
  if (/linkedin.*(?:notification|alert|update|connection|message|invite)/i.test(subject)) return true;

  // Social media notifications
  if (/(?:facebook|twitter|instagram|youtube|tiktok).*notification/i.test(sender)) return true;

  // Marketing/savings/promotional content in subject
  // Exclude common real estate lead keywords like "sale", "offer", and "deal" unless they are explicitly marketing.
  const isMarketing = 
    /(exclusive|savings|discount|free|limited.time|act.now|buy.now)/i.test(subject) ||
    /\b(clearance|flash|mega|big|super|promo|annual|holiday|seasonal)\s+sale\b/i.test(subject) ||
    /\b(special|promo|limited|exclusive)\s+offer\b/i.test(subject) ||
    /\b(special|promo|limited|exclusive)\s+deal\b/i.test(subject);

  if (isMarketing) return true;

  // Help/support articles
  if (/^help\s*:/i.test(subject)) return true;
  if (/help.*\.(com|org|net)/i.test(subject)) return true;

  return false;
}

const LEAD_WEBHOOK_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(request: Request) {
  let accountId = '';
  let sender = '';
  let subject = '';
  let bodyText = '';
  let htmlContent = '';

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';
    accountId = searchParams.get('account_id') || '';

    // Token is REQUIRED — fail closed. A missing LEADS_WEBHOOK_TOKEN must
    // never leave the endpoint open, since it can create contacts and send
    // WhatsApp messages from a tenant's number.
    const expectedToken = process.env.LEADS_WEBHOOK_TOKEN;
    if (!expectedToken) {
      console.error('[lead-webhook] LEADS_WEBHOOK_TOKEN is not set — rejecting request.');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expectedToken);
    if (
      tokenBuf.length !== expectedBuf.length ||
      !timingSafeEqual(tokenBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Unauthorized token' }, { status: 401 });
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const limit = checkRateLimit(`lead-webhook:${ip}`, LEAD_WEBHOOK_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const payload = await request.json();
    
    sender = payload.from || payload.sender || '';
    subject = payload.subject || '';
    
    // Determine if the payload text/html contains raw MIME email headers
    const rawText = payload.text || payload.html || '';
    
    // If the payload appears to be a raw MIME email (contains headers like Content-Type/Received)
    const isMimeEmail = /Content-Type:/i.test(rawText) || /MIME-Version:/i.test(rawText) || /Received:/i.test(rawText);
    
    if (isMimeEmail) {
      console.log('[lead-webhook] Raw MIME email detected. Parsing multipart MIME structure...');
      const parsedMime = parseMimeEmail(rawText);
      htmlContent = parsedMime.html;
      bodyText = parsedMime.text || parsedMime.html; // Fallback to HTML body if plain text is empty
      
      // Extract subject from MIME headers if missing or MIME-encoded
      const subjectMatch = rawText.match(/^Subject:\s*([^\r\n]+)/im);
      if (subjectMatch && (!subject || subject.includes('=?'))) {
        subject = decodeMimeSubject(subjectMatch[1].trim());
      } else {
        subject = decodeMimeSubject(subject);
      }

      // Extract sender from MIME headers if missing or default generic
      if (!sender || sender.includes('unknown')) {
        const fromMatch = rawText.match(/^From:\s*([^\r\n]+)/im);
        if (fromMatch) {
          sender = fromMatch[1].trim();
        }
      }
    } else {
      subject = decodeMimeSubject(payload.subject || '');
      bodyText = payload.text || payload.html || '';
      htmlContent = payload.html || '';
      
      // Decode Quoted-Printable body and html if they contain soft line breaks
      if (/=\r?\n/.test(bodyText)) {
        bodyText = decodeQuotedPrintable(bodyText);
      }
      if (/=\r?\n/.test(htmlContent)) {
        htmlContent = decodeQuotedPrintable(htmlContent);
      }
    }

    if (!bodyText) {
      return NextResponse.json({ error: 'Empty email body text' }, { status: 400 });
    }

    // Auto-approve email forwarding confirmation request checks (e.g. Gmail forwarding setup)
    const isVerificationEmail = /forwarding.*confirm/i.test(subject) || 
                                 /verification/i.test(subject) || 
                                 /confirm.*forward/i.test(subject) ||
                                 /google.*forward/i.test(subject) ||
                                 /forwarding.*confirm/i.test(bodyText) ||
                                 /confirm.*forward/i.test(bodyText) ||
                                 /confirmation\s*code/i.test(bodyText) ||
                                 /automatically\s*forward/i.test(bodyText);
    if (isVerificationEmail) {
      console.log(`[lead-webhook] Forwarding verification email received. Subject: ${subject}`);
      
      // Parse Gmail confirmation code
      const codeMatch = bodyText.match(/(?:confirmation\s*code\s*:\s*|code\s*:\s*)(\d{8,12})/i);
      // Parse Gmail confirmation link
      const linkMatch = bodyText.match(/https:\/\/(?:mail|mail-settings)\.google\.com\/mail\/v?f-[^\s"'>]+/i);
      
      console.log(`[lead-webhook] ==========================================`);
      console.log(`[lead-webhook] GMAIL FORWARDING VERIFICATION RECEIVED`);
      const code = codeMatch ? codeMatch[1] : null;
      const link = linkMatch ? linkMatch[0] : null;
      
      console.log(
        `[lead-webhook] confirmation received (code: ${code ? 'yes' : 'no'}, link: ${link ? 'yes' : 'no'}) — value stored to DB, not logged`,
      );
      console.log(`[lead-webhook] ==========================================`);

      if (accountId) {
        const supabase = getAdminClient();
        const { error: dbErr } = await supabase
          .from('email_sync_configs')
          .upsert({
            account_id: accountId,
            last_verification_code: code,
            last_verification_link: link,
            last_verification_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'account_id',
          });

        if (dbErr) {
          console.error(`[lead-webhook] Failed to save verification to DB:`, dbErr);
        } else {
          console.log(`[lead-webhook] Saved forwarding verification to DB for account ${accountId}`);
        }

        await writeSyncLog({
          accountId,
          sender,
          subject,
          status: 'ignored',
          errorMessage: 'Verification email processed',
          bodyPreview: bodyText.slice(0, 200),
        });
      } else {
        console.warn(`[lead-webhook] Received verification email but no account_id resolved.`);
      }

      return NextResponse.json({
        status: 'verification_received',
        message: 'Forwarding verification email successfully processed.',
      });
    }

    const isNonLeadEmail = checkIsNonLeadEmail(subject, sender);
    
    if (isNonLeadEmail) {
      console.log(`[lead-webhook] Non-lead email filtered out. Subject: ${subject}, From: ${sender}`);
      // Still log it for audit but don't create a contact/conversation
      if (accountId) {
        await writeSyncLog({
          accountId,
          sender,
          subject,
          status: 'ignored',
          errorMessage: 'Filtered: non-lead email (notification/marketing/system)',
          bodyPreview: bodyText.slice(0, 200),
        });
      }
      return NextResponse.json({ status: 'filtered', message: 'Non-lead email filtered out.' });
    }

    const parsed = parsePortalLead(subject, bodyText, htmlContent);

    // Ignore portal source emails (e.g. support@housing.com) — they are the
    // sender address, not the lead's actual email.
    if (parsed.email && parsed.email.toLowerCase() === 'support@housing.com') {
      parsed.email = null;
    }

    // Dynamic resolution for Housing.com lead phone number
    // Also try HTML URL resolution if phone looks suspicious (e.g., Property ID or URL)
    const isSuspiciousPhone = parsed.phone && (
      /^(property\s*id|listing|ref)/i.test(parsed.phone) ||
      parsed.phone.includes('/') ||
      parsed.phone.includes('http') ||
      (parsed.housingPropertyId && parsed.phone.replace(/\D/g, '') === parsed.housingPropertyId) ||
      parsed.phone.replace(/\D/g, '').length < 10
    );
    if (parsed.source === 'Housing' && (!parsed.phone || parsed.phone === '' || isSuspiciousPhone)) {
      const resolvedPhone = await resolveHousingPhone(htmlContent, bodyText);
      if (resolvedPhone) {
        parsed.phone = resolvedPhone;
      }
    }

    const supabase = getAdminClient();

    // 1. account_id must be provided explicitly. Never fall back to the
    //    "first whatsapp_config" — that let a lead be routed to (and an
    //    auto-reply sent from) an arbitrary tenant's WhatsApp number.
    if (!accountId) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 });
    }

    const { data: accountConfig } = await supabase
      .from('whatsapp_config')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!accountConfig) {
      return NextResponse.json({ error: 'Invalid account ID' }, { status: 400 });
    }

    if (!parsed.phone) {
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedEmail: parsed.email,
        status: 'failed',
        errorMessage: 'Failed to extract phone number from lead email',
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ error: 'Failed to extract phone number from lead' }, { status: 422 });
    }

    const normalizedPhoneNum = normalizePhoneWithCountryCode(parsed.phone);
    if (!normalizedPhoneNum) {
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedPhone: parsed.phone,
        extractedEmail: parsed.email,
        status: 'failed',
        errorMessage: 'Extracted phone number is invalid',
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ error: 'Extracted phone number is invalid' }, { status: 422 });
    }

    // 2. Check if email lead sync is active for this account
    const { data: syncConfig } = await supabase
      .from('email_sync_configs')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (syncConfig && !syncConfig.is_active) {
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedPhone: normalizedPhoneNum,
        extractedEmail: parsed.email,
        status: 'ignored',
        errorMessage: 'Email lead synchronization is disabled for this account',
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ error: 'Email lead synchronization is disabled for this account' }, { status: 403 });
    }

    // Validate contact name quality - reject junk names
    if (!isValidContactName(parsed.name)) {
      console.log(`[lead-webhook] Rejected lead with invalid name: "${parsed.name}"`);
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedPhone: normalizedPhoneNum,
        extractedEmail: parsed.email,
        status: 'ignored',
        errorMessage: `Invalid contact name: "${parsed.name}"`,
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ 
        error: 'Invalid contact name detected',
        name: parsed.name,
        reason: 'Name appears to be junk, marketing content, or system notification'
      }, { status: 422 });
    }

    // Read the role suffix (e.g. "Jaffar (Broker)") before stripping it —
    // it's the only signal we have for classifying the contact correctly
    // instead of defaulting every email lead to 'Buyer'. Deal-aware: on
    // an inquiry about the recipient's OWN listing ("…regarding your
    // plot"), an "(Owner)" suffix is the inquirer's portal account type,
    // not their role in this deal — they classify as Buyer.
    const classificationFromSuffix = classifyPortalLead(parsed.name, `${subject}\n${bodyText}`);

    // Strip owner/developer/builder suffixes from name
    // e.g. "Kg Subramanian (Owner)" -> "Kg Subramanian"
    const cleanName = stripOwnerSuffix(parsed.name);
    if (cleanName !== parsed.name) {
      console.log(`[lead-webhook] Stripped owner suffix: "${parsed.name}" -> "${cleanName}"`);
      parsed.name = cleanName;
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
      if (reqLower.includes('commercial') || reqLower.includes('office') || reqLower.includes('shop')) {
        propertyInterests.push('Commercial');
      }
      if (reqLower.includes('industrial') || reqLower.includes('industry') || reqLower.includes('warehouse') || reqLower.includes('factory')) {
        propertyInterests.push('Industrial');
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

    // Enhance from parsed property details directly
    if (parsed.propertyPrice && !maxBudget) {
      maxBudget = parsed.propertyPrice;
    }

    if (parsed.propertyLocation) {
      const mainArea = parsed.propertyLocation.split(',')[0]?.trim();
      if (mainArea) {
        const areaLower = mainArea.toLowerCase();
        let formattedArea = mainArea;
        if (areaLower === 'hsr' || areaLower === 'jp nagar') {
          formattedArea = mainArea.toUpperCase();
        } else {
          formattedArea = mainArea.charAt(0).toUpperCase() + mainArea.slice(1);
        }
        if (!areasOfInterest.includes(formattedArea)) {
          areasOfInterest.push(formattedArea);
        }
      }
    }

    if (parsed.propertyType) {
      const typeLower = parsed.propertyType.toLowerCase();
      let interest = '';
      if (typeLower.includes('industrial') || typeLower.includes('industry') || typeLower.includes('warehouse') || typeLower.includes('factory') || typeLower.includes('shed') || typeLower.includes('godown')) {
        interest = 'Industrial';
      } else if (typeLower.includes('commercial') || typeLower.includes('office') || typeLower.includes('shop') || typeLower.includes('showroom')) {
        interest = 'Commercial';
      } else if (typeLower.includes('apartment') || typeLower.includes('flat') || typeLower.includes('bhk')) {
        interest = 'Flat/ Apartment';
      } else if (typeLower.includes('plot') || typeLower.includes('land') || typeLower.includes('site')) {
        interest = 'Vacant plot';
      } else if (typeLower.includes('house') || typeLower.includes('villa')) {
        interest = 'Vacant building';
      }
      if (interest && !propertyInterests.includes(interest)) {
        propertyInterests.push(interest);
      }
    }

    // Match properties from email against user's listings
    let matchedPropertyIds: string[] = [];
    if (parsed.propertyType || parsed.propertyLocation || parsed.housingPropertyId) {
      try {
        // Fetch user's published properties.
        const { data: properties } = await supabase
          .from('properties')
          .select('id, title, type, location, bedrooms, area_sqft, price, property_code, created_at')
          .eq('account_id', accountId)
          .eq('is_published', true);

        // Sort by newest first before scoring so ties (possible when two
        // listings share type/bedrooms/price bracket) resolve
        // deterministically to the newer listing, rather than whatever
        // order Postgres/the client happens to return rows in.
        properties?.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

        if (properties && properties.length > 0) {
          // Score and rank every property so the strongest location match is first.
          const scoredProperties = properties.map((p) => {
            let matchScore = 0;

            // Match by property type (Apartment, Flat, etc.)
            if (parsed.propertyType && p.type) {
              const typeLower = parsed.propertyType.toLowerCase();
              const pTypeLower = p.type.toLowerCase();
              if (typeLower.includes(pTypeLower) || pTypeLower.includes(typeLower)) {
                matchScore += 2;
              } else {
                // Fuzzy word overlap for near-misses (e.g. "Industrial Building" vs "Industry Building")
                const wordsA = typeLower.split(/[^a-z0-9]+/).filter((w: string) => w.length > 2);
                const wordsB = pTypeLower.split(/[^a-z0-9]+/).filter((w: string) => w.length > 2);
                const overlap = wordsA.filter((w: string) => wordsB.includes(w)).length;
                if (overlap > 0) {
                  matchScore += overlap;
                }
              }
            }

            // Match by bedrooms
            if (parsed.bedrooms && p.bedrooms) {
              if (parsed.bedrooms === p.bedrooms) {
                matchScore += 2;
              }
            }

            // Match by location (fuzzy match) — highest weight
            if (parsed.propertyLocation && p.location) {
              if (checkLocationMatch(parsed.propertyLocation, p.location)) {
                matchScore += 3;
              }
            }

            // Match by area (within 10% tolerance)
            if (parsed.areaSqft && p.area_sqft) {
              const areaDiff = Math.abs(parsed.areaSqft - p.area_sqft) / p.area_sqft;
              if (areaDiff <= 0.1) {
                matchScore += 2;
              }
            }

            // Match by price (within 15% tolerance)
            if (parsed.propertyPrice && p.price) {
              const priceDiff = Math.abs(parsed.propertyPrice - p.price) / p.price;
              if (priceDiff <= 0.15) {
                matchScore += 2;
              }
            }

            return { property: p, score: matchScore };
          });

          // Require at least 2 points so type-only near-matches still qualify
          const matchedProperties = scoredProperties
            .filter((sp) => sp.score >= 2)
            .sort((a, b) => b.score - a.score)
            .map((sp) => sp.property);

          if (matchedProperties.length > 0) {
            matchedPropertyIds = matchedProperties.map(p => p.id);
            console.log(`[lead-webhook] Matched ${matchedProperties.length} properties: ${matchedProperties.map(p => p.title).join(', ')} from ${parsed.source} inquiry`);

            // Find the maximum matching score
            const maxScore = Math.max(...scoredProperties.map((sp) => sp.score), 0);

            // Only use high-confidence matched properties (score >= 3 and score === maxScore) 
            // to enhance the contact's budget, areas, and interests. This prevents type-only matches 
            // (e.g., matching every Plot in the account) from polluting the contact's details.
            const bestMatchedProperties = scoredProperties
              .filter((sp) => sp.score >= 3 && sp.score === maxScore)
              .map((sp) => sp.property);

            if (bestMatchedProperties.length > 0) {
              // Use the highest price from best matched properties as budget if not already set
              if (!maxBudget) {
                const maxPrice = Math.max(...bestMatchedProperties.map(p => p.price || 0));
                if (maxPrice > 0) {
                  maxBudget = maxPrice;
                }
              }

              // Add areas from best matched property locations
              bestMatchedProperties.forEach((p: PropertyForMatching) => {
                if (p.location) {
                  // Extract main area from location (e.g., "Kudlu, SJR Blue waters, Bangalore, Karnataka" -> "Kudlu")
                  const mainArea = p.location.split(',')[0]?.trim();
                  if (mainArea) {
                    const areaLower = mainArea.toLowerCase();
                    let formattedArea = mainArea;
                    if (areaLower === 'hsr' || areaLower === 'jp nagar') {
                      formattedArea = mainArea.toUpperCase();
                    } else {
                      formattedArea = mainArea.charAt(0).toUpperCase() + mainArea.slice(1);
                    }
                    if (!areasOfInterest.includes(formattedArea)) {
                      areasOfInterest.push(formattedArea);
                    }
                  }
                }
              });

              // Add property interests from best matched property types
              bestMatchedProperties.forEach((p: PropertyForMatching) => {
                if (p.type) {
                  const typeLower = p.type.toLowerCase();
                  let interest = '';
                  if (typeLower.includes('industrial') || typeLower.includes('industry') || typeLower.includes('warehouse') || typeLower.includes('factory') || typeLower.includes('shed') || typeLower.includes('godown')) {
                    interest = 'Industrial';
                  } else if (typeLower.includes('commercial') || typeLower.includes('office') || typeLower.includes('shop') || typeLower.includes('showroom')) {
                    interest = 'Commercial';
                  } else if (typeLower.includes('apartment') || typeLower.includes('flat') || typeLower.includes('bhk')) {
                    interest = 'Flat/ Apartment';
                  } else if (typeLower.includes('plot') || typeLower.includes('land') || typeLower.includes('site')) {
                    interest = 'Vacant plot';
                  } else if (typeLower.includes('house') || typeLower.includes('villa')) {
                    interest = 'Vacant building';
                  }
                  if (interest && !propertyInterests.includes(interest)) {
                    propertyInterests.push(interest);
                  }
                }
              });
            }
          }
        }
      } catch (err) {
        console.error('[lead-webhook] Failed to match properties:', err);
      }
    }

    const cleanPhone = normalizedPhoneNum.replace(/\D/g, '');
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .or(`phone.eq.${normalizedPhoneNum},phone.eq.${cleanPhone}`)
      .maybeSingle();

    // Get user_id for tag creation (needed for both existing and new contacts)
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();
    
    if (!profile) {
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedPhone: normalizedPhoneNum,
        extractedEmail: parsed.email,
        status: 'failed',
        errorMessage: 'No user profile found for this account',
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ error: 'No user found for this account' }, { status: 422 });
    }
    const userId = profile.user_id;

    if (existingContact) {
      // Update existing contact preferences
      const updatePayload: {
        max_budget?: number | null;
        areas_of_interest?: string[];
        property_interests?: string[];
        company?: string;
        source?: string;
        last_inquired_property_id?: string | null;
      } = {};
      if (maxBudget) updatePayload.max_budget = maxBudget;
      if (areasOfInterest.length > 0) updatePayload.areas_of_interest = areasOfInterest;
      if (propertyInterests.length > 0) updatePayload.property_interests = propertyInterests;
      if (matchedPropertyIds.length > 0) updatePayload.last_inquired_property_id = matchedPropertyIds[0];
      
      // Tag source
      updatePayload.company = parsed.source;
      updatePayload.source = parsed.source;

      await supabase
        .from('contacts')
        .update(updatePayload)
        .eq('id', existingContact.id);

      // Record the inquiry in the junction table. One portal email is an
      // inquiry about ONE listing — matchedPropertyIds is a ranked list of
      // guesses for which listing that is, so only the top match is
      // recorded. Inserting every fuzzy match (score >= 2) tagged contacts
      // with type-only near-misses across the whole inventory.
      if (matchedPropertyIds.length > 0) {
        await supabase
          .from('contact_property_inquiries')
          .upsert(
            {
              contact_id: existingContact.id,
              property_id: matchedPropertyIds[0],
              inquiry_source: parsed.source,
            },
            { onConflict: 'contact_id,property_id' }
          );
      }

      // Auto-assign tags based on property interests and budget
      const tagsToAssign: string[] = [];
      
      // Add property type tags
      if (propertyInterests.includes('Flat/ Apartment')) tagsToAssign.push('Residential', 'Flat/Apartment');
      if (propertyInterests.includes('Vacant plot')) tagsToAssign.push('Plots/Land');
      if (propertyInterests.includes('Vacant building')) tagsToAssign.push('Residential', 'Villa');
      if (propertyInterests.includes('Commercial')) tagsToAssign.push('Commercial');
      
      // Add source tag
      if (parsed.source) tagsToAssign.push(`${parsed.source} Lead`);
      
      // Add budget-based tags (ranges up to 150Cr+)
      if (maxBudget) {
        if (maxBudget >= 1500000000) tagsToAssign.push('Budget 150Cr+');
        else if (maxBudget >= 1000000000) tagsToAssign.push('Budget 100-150Cr');
        else if (maxBudget >= 500000000) tagsToAssign.push('Budget 50-100Cr');
        else if (maxBudget >= 250000000) tagsToAssign.push('Budget 25-50Cr');
        else if (maxBudget >= 100000000) tagsToAssign.push('Budget 10-25Cr');
        else if (maxBudget >= 50000000) tagsToAssign.push('Budget 5-10Cr');
        else if (maxBudget >= 20000000) tagsToAssign.push('Budget 2-5Cr');
        else if (maxBudget >= 10000000) tagsToAssign.push('Budget 1-2Cr');
        else if (maxBudget >= 5000000) tagsToAssign.push('Budget 50L-1Cr');
        else if (maxBudget >= 2000000) tagsToAssign.push('Budget 20L-50L');
        else tagsToAssign.push('Budget <20L');
      }

      if (tagsToAssign.length > 0) {
        await assignTagsToContact(supabase, accountId, userId, existingContact.id, tagsToAssign);
      }

      // Find or create conversation for existing contact
      let conversationId = '';
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', existingContact.id)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
        // Update conversation last message
        await supabase
          .from('conversations')
          .update({
            last_message_text: `📥 New Lead from ${parsed.source}: ${parsed.requirementText || 'No comments'}`,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId);
      } else {
        // Resolve user_id for existing contact path
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .limit(1)
          .maybeSingle();
        
        if (profile) {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              account_id: accountId,
              user_id: profile.user_id,
              contact_id: existingContact.id,
              last_message_text: `📥 New Lead from ${parsed.source}: ${parsed.requirementText || 'No comments'}`,
              last_message_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (newConv) conversationId = newConv.id;
        }
      }

      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: existingContact.name,
        extractedPhone: normalizedPhoneNum,
        extractedEmail: parsed.email,
        status: 'success',
        errorMessage: 'Existing contact preferences updated',
        bodyPreview: bodyText.slice(0, 200),
      });

      // Trigger automatic WhatsApp reply — always send for email leads
      const replyResult = await sendAutoReply({
        supabase,
        accountId,
        syncConfig,
        conversationId,
        cleanPhone,
        leadName: existingContact.name || '',
        leadSource: parsed.source || '',
        forceSend: true,
      });
      if (!replyResult.success) {
        console.error(`[lead-webhook] Auto-reply FAILED for existing contact ${existingContact.id}: ${replyResult.error}`);
      } else {
        console.log(`[lead-webhook] Auto-reply SENT for existing contact ${existingContact.id}: messageId=${replyResult.messageId}`);
      }

      // Fire automations for existing contact getting a new lead
      void runAutomationsForTrigger({
        accountId,
        triggerType: 'new_message_received',
        contactId: existingContact.id,
      })

      return NextResponse.json({
        status: 'updated',
        contactId: existingContact.id,
        name: existingContact.name,
      });
    }

    // 4. Insert new contact — 'Buyer' is the correct default for most
    // portal leads, but a "(Broker)"/"(Owner)"/etc. suffix on the
    // sender's name overrides it when present.
    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: parsed.name,
        phone: normalizedPhoneNum,
        email: parsed.email || null,
        classification: classificationFromSuffix ?? 'Buyer',
        company: parsed.source, // Stashing the lead portal name in company field
        source: parsed.source, // Storing lead portal name in dedicated source field
        max_budget: maxBudget,
        areas_of_interest: areasOfInterest.length > 0 ? areasOfInterest : null,
        property_interests: propertyInterests.length > 0 ? propertyInterests : null,
        last_inquired_property_id: matchedPropertyIds.length > 0 ? matchedPropertyIds[0] : null,
        status: 'pending_review',
      })
      .select('id, name')
      .single();

    if (insertErr) {
      console.error('[lead-webhook] Error inserting contact:', insertErr);
      await writeSyncLog({
        accountId,
        sender,
        subject,
        extractedName: parsed.name,
        extractedPhone: normalizedPhoneNum,
        extractedEmail: parsed.email,
        status: 'failed',
        errorMessage: `Failed to insert contact: ${insertErr.message}`,
        bodyPreview: bodyText.slice(0, 200),
      });
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Record the inquiry in the junction table — top-scored match only,
    // same reasoning as the existing-contact branch above.
    if (matchedPropertyIds.length > 0 && newContact) {
      await supabase
        .from('contact_property_inquiries')
        .upsert(
          {
            contact_id: newContact.id,
            property_id: matchedPropertyIds[0],
            inquiry_source: parsed.source,
          },
          { onConflict: 'contact_id,property_id' }
        );
    }

    // Auto-assign tags based on property interests and budget
    if (newContact) {
      const tagsToAssign: string[] = [];
      
      // Add property type tags
      if (propertyInterests.includes('Flat/ Apartment')) tagsToAssign.push('Residential', 'Flat/Apartment');
      if (propertyInterests.includes('Vacant plot')) tagsToAssign.push('Plots/Land');
      if (propertyInterests.includes('Vacant building')) tagsToAssign.push('Residential', 'Villa');
      if (propertyInterests.includes('Commercial')) tagsToAssign.push('Commercial');
      
      // Add source tag
      if (parsed.source) tagsToAssign.push(`${parsed.source} Lead`);
      
      // Add budget-based tags (ranges up to 150Cr+)
      if (maxBudget) {
        if (maxBudget >= 1500000000) tagsToAssign.push('Budget 150Cr+');
        else if (maxBudget >= 1000000000) tagsToAssign.push('Budget 100-150Cr');
        else if (maxBudget >= 500000000) tagsToAssign.push('Budget 50-100Cr');
        else if (maxBudget >= 250000000) tagsToAssign.push('Budget 25-50Cr');
        else if (maxBudget >= 100000000) tagsToAssign.push('Budget 10-25Cr');
        else if (maxBudget >= 50000000) tagsToAssign.push('Budget 5-10Cr');
        else if (maxBudget >= 20000000) tagsToAssign.push('Budget 2-5Cr');
        else if (maxBudget >= 10000000) tagsToAssign.push('Budget 1-2Cr');
        else if (maxBudget >= 5000000) tagsToAssign.push('Budget 50L-1Cr');
        else if (maxBudget >= 2000000) tagsToAssign.push('Budget 20L-50L');
        else tagsToAssign.push('Budget <20L');
      }

      if (tagsToAssign.length > 0) {
        await assignTagsToContact(supabase, accountId, userId, newContact.id, tagsToAssign);
      }
    }

    // 5. Create active conversation thread
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: userId,
        contact_id: newContact.id,
        last_message_text: `📥 New Lead from ${parsed.source}: ${parsed.requirementText || 'No comments'}`,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (convErr) {
      console.error('[lead-webhook] Error creating conversation:', convErr);
    }

    await writeSyncLog({
      accountId,
      sender,
      subject,
      extractedName: newContact.name,
      extractedPhone: normalizedPhoneNum,
      extractedEmail: parsed.email,
      status: 'success',
      errorMessage: 'New contact created',
      bodyPreview: bodyText.slice(0, 200),
    });

    // Trigger automatic WhatsApp reply — always send for email leads
    const replyResult = await sendAutoReply({
      supabase,
      accountId,
      syncConfig,
      conversationId: conversation?.id || null,
      cleanPhone,
      leadName: parsed.name || '',
      leadSource: parsed.source || '',
      forceSend: true,
    });
    if (!replyResult.success) {
      console.error(`[lead-webhook] Auto-reply FAILED for new contact ${newContact.id}: ${replyResult.error}`);
    } else {
      console.log(`[lead-webhook] Auto-reply SENT for new contact ${newContact.id}: messageId=${replyResult.messageId}`);
    }

    // Fire automations for the new contact (e.g. welcome message, property info)
    void runAutomationsForTrigger({
      accountId,
      triggerType: 'new_contact_created',
      contactId: newContact.id,
    })

    return NextResponse.json({
      status: 'created',
      contactId: newContact.id,
      name: newContact.name,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[lead-webhook] Request failed:', error);
    if (accountId) {
      await writeSyncLog({
        accountId,
        sender: sender || '',
        subject: subject || '',
        status: 'failed',
        errorMessage: error.message || 'Server error',
        bodyPreview: bodyText?.slice(0, 200) || '',
      });
    }
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
