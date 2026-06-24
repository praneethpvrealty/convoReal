import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EmailSyncConfig, MessageTemplate } from '@/types';

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

// Decodes Quoted-Printable (QP) strings commonly found in email bodies/headers
export function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, '') // Remove soft line breaks
    .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Decodes MIME encoded subjects (Q-encoded UTF-8 or B-encoded Base64)
export function decodeMimeSubject(str: string): string {
  if (!str.includes('=?')) return str;
  return str
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (match, p1) => {
      return decodeQuotedPrintable(p1.replace(/_/g, ' '));
    })
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (match, p1) => {
      try {
        return Buffer.from(p1, 'base64').toString('utf8');
      } catch {
        return match;
      }
    });
}

// Parses raw MIME emails into clean HTML and plain text bodies without headers/boundaries
export function parseMimeEmail(raw: string): { html: string; text: string } {
  const headerSeparator = raw.indexOf('\r\n\r\n');
  const separatorLength = headerSeparator !== -1 ? 4 : 2;
  const separatorPos = headerSeparator !== -1 ? headerSeparator : raw.indexOf('\n\n');
  
  if (separatorPos === -1) {
    return { html: '', text: raw };
  }
  
  const headersPart = raw.slice(0, separatorPos);
  const bodyPart = raw.slice(separatorPos + separatorLength);
  
  const boundaryMatch = headersPart.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
  
  if (!boundary) {
    let body = bodyPart;
    const transferEncoding = headersPart.match(/Content-Transfer-Encoding:\s*([^\s;]+)/i)?.[1]?.toLowerCase();
    if (transferEncoding === 'quoted-printable') {
      body = decodeQuotedPrintable(body);
    } else if (transferEncoding === 'base64') {
      try {
        body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
      } catch {}
    }
    
    const isHtml = /Content-Type:\s*text\/html/i.test(headersPart);
    return {
      html: isHtml ? body : '',
      text: isHtml ? '' : body
    };
  }
  
  const parts = bodyPart.split(`--${boundary}`);
  let html = '';
  let text = '';
  
  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart || trimmedPart === '--') continue;
    
    const partSeparator = trimmedPart.indexOf('\r\n\r\n');
    const partSepLen = partSeparator !== -1 ? 4 : 2;
    const partSepPos = partSeparator !== -1 ? partSeparator : trimmedPart.indexOf('\n\n');
    
    if (partSepPos === -1) continue;
    
    const partHeaders = trimmedPart.slice(0, partSepPos);
    let partBody = trimmedPart.slice(partSepPos + partSepLen);
    
    const partEncoding = partHeaders.match(/Content-Transfer-Encoding:\s*([^\s;]+)/i)?.[1]?.toLowerCase();
    if (partEncoding === 'quoted-printable') {
      partBody = decodeQuotedPrintable(partBody);
    } else if (partEncoding === 'base64') {
      try {
        partBody = Buffer.from(partBody.replace(/\s/g, ''), 'base64').toString('utf8');
      } catch {}
    }
    
    if (/Content-Type:\s*text\/html/i.test(partHeaders)) {
      html = partBody;
    } else if (/Content-Type:\s*text\/plain/i.test(partHeaders)) {
      text = partBody;
    }
  }
  
  return { html, text };
}

// Converts HTML strings to plain text preserving structure and line breaks
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|tr|h1|h2|h3|h4|h5|h6|li)>/gi, '\n') // Preserves line breaks for block elements
    .replace(/<br\s*\/?>/gi, '\n') // Preserves line breaks for br tags
    .replace(/<[^>]*>/g, '') // Removes all HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ') // Normalize spaces
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
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

// Helper to validate if a name looks like a legitimate contact name
// Returns true if the name is valid, false if it's junk
function isValidContactName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  
  const trimmed = name.trim();
  
  // Too short or too long
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  
  // Encoding artifacts and Quoted-Printable leftovers
  if (/^=[\da-fA-F]{2}\s*=$/.test(trimmed)) return false; // =0A = etc.
  if (/^=0A\s*=$/i.test(trimmed)) return false;
  if (/[ÃÂ©â€œâ€\x9d]/.test(trimmed)) return false; // UTF-8 encoding issues
  
  // URLs and links
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/^help\s*:?\s*https?:\/\//i.test(trimmed)) return false;
  
  // Copyright notices
  if (/^©|^&copy;|^\(c\)/i.test(trimmed)) return false;
  if (/\d{4}\s+(?:ITP|Digital Media|Inc\.|Corp\.|LLC|Ltd\.)/i.test(trimmed)) return false;
  
  // Marketing/promotional text
  if (/(?:exclusive|savings|discount|offer|deal|sale|free|limited|champion|gear)/i.test(trimmed)) return false;
  if (/(?:unlock|subscribe|unsubscribe|click here|act now|buy now)/i.test(trimmed)) return false;
  
  // System placeholders
  if (/^\[image.*\]/i.test(trimmed)) return false;
  if (/^(?:image|photo|avatar|picture)/i.test(trimmed)) return false;
  
  // Job titles and signatures (not names)
  if (/(?:specialist|manager|director|lead|senior|junior|associate|consultant)\s*\|/i.test(trimmed)) return false;
  if (/\|\s*(?:trial|demo|experience|intern)/i.test(trimmed)) return false;
  
  // Property owner/developer/builder names (not buyer contacts)
  if (/(?:^OWNER\s*:|^DEVELOPER\s*:|^BUILDER\s*:|^BROKER\s*:)/i.test(trimmed)) return false;
  if (/(?:SATTVA|PRESTIGE|BRIGADE|SOBHA|DLF|GODREJ|TATA|ADBHI|MERLIN|CONFIDENT|EMERALD|PURI|SUNTECH|MAHESTRA|OBEROI|MESCAPE|VASCON|VIKRAM|RAVINDRA|SATTVAVIHAR)/i.test(trimmed)) return false;
  
  // All-caps company/developer names (likely not a person's name)
  if (/^[A-Z\s]{3,}$/.test(trimmed) && !/^(?:KARTHIK|GANESH|SHARON|JOSEPH|FRANCIS|RAGHU|VIJAY|RAJESH|SURESH|KUMAR|REDDY|NAIR|IYER|AIYER)/i.test(trimmed)) return false;
  
  // Addresses (contain state codes, zip codes)
  if (/\b[A-Z]{2}\s+\d{5,6}\b/.test(trimmed)) return false; // CA 94104, TN 600018
  if (/\d+\s+(?:Market|Street|St|Ave|Avenue|Blvd|Road|Rd)\s+(?:St|PMB|Suite|Ste|Apt)/i.test(trimmed)) return false;
  
  // LinkedIn and social media help URLs
  if (/linkedin\.com\/help/i.test(trimmed)) return false;
  if (/(?:facebook|twitter|instagram|youtube)\.com/i.test(trimmed)) return false;
  
  // Just numbers or mostly numbers
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount > trimmed.length * 0.5) return false;
  
  // Just special characters or punctuation
  if (/^[^\w\s]+$/.test(trimmed)) return false;
  
  return true;
}

// Helper to follow redirect headers (manual mode) to extract phone number
export async function resolvePhoneNumberFromUrl(url: string, depth = 0): Promise<string | null> {
  if (depth > 3) return null; // Avoid infinite redirects
  try {
    const cleanUrl = url.replace(/&amp;/g, '&');
    
    // Check if the URL itself already contains the phone number
    // Handle both direct + and URL-encoded %2B for plus sign
    const directPhoneMatch = cleanUrl.match(/(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i) ||
                             cleanUrl.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
    if (directPhoneMatch) {
      let phone = directPhoneMatch[1];
      // Decode URL-encoded plus sign (%2B or %2b)
      phone = phone.replace(/%2B/gi, '+').replace(/%2b/gi, '+');
      return phone;
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
      const phoneMatch = location.match(/(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i) ||
                         location.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
      if (phoneMatch) {
        let phone = phoneMatch[1];
        // Decode URL-encoded plus sign (%2B or %2b)
        phone = phone.replace(/%2B/gi, '+').replace(/%2b/gi, '+');
        return phone;
      }
      if (location.startsWith('http')) {
        return await resolvePhoneNumberFromUrl(location, depth + 1);
      }
    }
    
    // Fallback: search within page body if it returned 200 instead of a redirect
    const body = await response.text();
    const bodyPhoneMatch = body.match(/(?:tel:|phone=|wa\.me\/|send\?phone=)(\+?\d{10,15})/i) ||
                           body.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
    if (bodyPhoneMatch) {
      let phone = bodyPhoneMatch[1];
      // Decode URL-encoded plus sign (%2B or %2b)
      phone = phone.replace(/%2B/gi, '+').replace(/%2b/gi, '+');
      return phone;
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

// Helper to trigger automatic WhatsApp auto-reply (either approved template or custom text)
async function sendAutoReply({
  supabase,
  accountId,
  syncConfig,
  conversationId,
  cleanPhone,
  leadName,
  leadSource,
}: {
  supabase: SupabaseClient;
  accountId: string;
  syncConfig: EmailSyncConfig | null;
  conversationId: string | null;
  cleanPhone: string;
  leadName: string;
  leadSource: string;
}) {
  if (!syncConfig?.auto_reply_enabled) return;

  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!waConfig) return;

  try {
    let replyText = '';
    let messageId = '';
    let usedTemplateName: string | null = null;

    let template: MessageTemplate | null = null;
    if (syncConfig.auto_reply_template_name) {
      const { data: foundTemplate } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('name', syncConfig.auto_reply_template_name)
        .eq('status', 'APPROVED')
        .maybeSingle();
      template = foundTemplate as unknown as MessageTemplate;
    }

    let primaryTemplateFailed = false;
    if (template) {
      const bodyParams = [
        leadName || 'there',
        leadSource || 'portal'
      ];
      
      // Auto-resolve dynamic URL buttons if the template has them
      const buttonParams: Record<number, string> = {};
      if (template.buttons && Array.isArray(template.buttons)) {
        template.buttons.forEach((btn, idx: number) => {
          if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
            buttonParams[idx] = `?ref=${accountId}`;
          }
        });
      }
      
      try {
        const sendRes = await sendTemplateMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken: decrypt(waConfig.access_token),
          to: cleanPhone,
          templateName: template.name,
          language: template.language || 'en_US',
          template: template || undefined,
          messageParams: {
            body: bodyParams,
            ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {})
          }
        });
        
        messageId = sendRes.messageId;
        usedTemplateName = template.name;
        
        // Format text for storing in messages log
        replyText = template.body_text
          .replace(/{{1}}/g, leadName || 'there')
          .replace(/{{2}}/g, leadSource || 'portal');
      } catch (tplErr) {
        const errMsg = (tplErr as Error).message || '';
        // If template not found on Meta (132001), mark inactive and fall through
        if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
          console.warn(`[lead-webhook] Configured template ${template.name} does not exist on Meta. Marking inactive and trying fallbacks.`);
          await supabase
            .from('message_templates')
            .update({ status: 'INACTIVE' })
            .eq('id', template.id);
          primaryTemplateFailed = true;
        } else {
          throw tplErr; // Re-throw other errors
        }
      }
    }

    // If primary template wasn't configured or failed, try fallback templates
    if (!messageId && (primaryTemplateFailed || !template)) {
      // Check 24-hour customer service window before sending free-form text.
      // Meta rejects free-form messages outside the window (Error 131047).
      let isWithin24Hours = false;
      if (conversationId) {
        const { data: lastCustomerMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('conversation_id', conversationId)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastCustomerMsg) {
          const lastMsgTime = new Date(lastCustomerMsg.created_at).getTime();
          isWithin24Hours = (Date.now() - lastMsgTime) < 24 * 60 * 60 * 1000;
        }
      }

      if (isWithin24Hours && syncConfig.auto_reply_text) {
        // Within 24h window — send free-form text
        replyText = syncConfig.auto_reply_text
          .replace(/{name}/g, leadName || 'there')
          .replace(/{source}/g, leadSource || 'portal');

        const sendRes = await sendTextMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken: decrypt(waConfig.access_token),
          to: cleanPhone,
          text: replyText,
        });
        messageId = sendRes.messageId;
      } else {
        // 24h window expired — fall back to an approved Utility template.
        // Templates work outside the 24h window; free-form text does not.
        const { data: fallbackTemplates } = await supabase
          .from('message_templates')
          .select('*')
          .eq('account_id', accountId)
          .eq('status', 'APPROVED')
          .in('category', ['UTILITY', 'UTILITY_MARKETING', 'MARKETING'])
          .order('created_at', { ascending: true });

        // Try templates in order, attempting the DB language first then
        // common English fallbacks. This handles cases where the DB
        // language code doesn't match Meta's registered locale.
        // If a template fails with 132001 (not found), mark it inactive
        // in the DB so future requests skip it.
        let sent = false;
        for (const fallbackTemplate of fallbackTemplates || []) {
          if (sent) break;

          const dbLang = (fallbackTemplate as MessageTemplate).language || 'en_US';
          const tryLanguages = [dbLang, ...['en_US', 'en', 'en_GB'].filter(l => l !== dbLang)];

          for (const lang of tryLanguages) {
            try {
              console.log(`[lead-webhook] 24h session expired for ${cleanPhone}. Trying template: ${fallbackTemplate.name} (lang: ${lang})`);

              const bodyParams = [leadName || 'there', leadSource || 'portal'];
              const tpl = fallbackTemplate as MessageTemplate;
              const buttonParams: Record<number, string> = {};
              if (tpl.buttons && Array.isArray(tpl.buttons)) {
                tpl.buttons.forEach((btn, idx: number) => {
                  if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
                    buttonParams[idx] = `?ref=${accountId}`;
                  }
                });
              }

              const sendRes = await sendTemplateMessage({
                phoneNumberId: waConfig.phone_number_id,
                accessToken: decrypt(waConfig.access_token),
                to: cleanPhone,
                templateName: tpl.name,
                language: lang,
                template: tpl,
                messageParams: {
                  body: bodyParams,
                  ...(Object.keys(buttonParams).length > 0 ? { buttonParams } : {})
                }
              });

              messageId = sendRes.messageId;
              usedTemplateName = tpl.name;
              replyText = (tpl.body_text || '')
                .replace(/{{1}}/g, leadName || 'there')
                .replace(/{{2}}/g, leadSource || 'portal');
              sent = true;
              break;
            } catch (langErr) {
              const errMsg = (langErr as Error).message || '';
              console.warn(`[lead-webhook] Template ${fallbackTemplate.name} failed with lang ${lang}:`, errMsg);

              // If 132001 (template not found on Meta), mark inactive in DB
              if (errMsg.includes('132001') || errMsg.toLowerCase().includes('does not exist')) {
                console.warn(`[lead-webhook] Template ${fallbackTemplate.name} does not exist on Meta. Marking as inactive.`);
                await supabase
                  .from('message_templates')
                  .update({ status: 'INACTIVE' })
                  .eq('id', fallbackTemplate.id);
                break; // Skip to next template, don't try other languages
              }
              // Continue to next language for other errors
            }
          }
        }

        if (!sent) {
          console.warn(`[lead-webhook] 24h session expired for ${cleanPhone} and no fallback template worked. Create a Utility template on Meta Business Manager and sync from Settings > WhatsApp > Templates.`);
        }
      }
    } else {
      return; // No reply configured
    }

    if (conversationId && replyText && messageId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: usedTemplateName ? 'template' : 'text',
        content_text: replyText,
        template_name: usedTemplateName,
        message_id: messageId,
        status: 'sent',
        created_at: new Date().toISOString(),
      });
    }
  } catch (sendErr) {
    console.error('[lead-webhook] Failed to send auto-reply:', sendErr);
  }
}

// Extractor rules for different portals
export function parsePortalLead(subject: string, bodyText: string, html: string) {
  // If the body text contains HTML tags, convert it to clean plain text first
  if (bodyText.includes('<') && bodyText.includes('>')) {
    bodyText = stripHtmlToText(bodyText);
  }

  let name = '';
  let phone = '';
  let email = '';
  let requirementText = '';
  let source = 'Others';
  
  // Property details for matching against listings
  let propertyType = '';
  let bedrooms: number | null = null;
  let propertyLocation = '';
  let areaSqft: number | null = null;
  let propertyPrice: number | null = null;
  let housingPropertyId = '';

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
    if (nameMatch) {
      const extractedName = nameMatch[1].trim();
      // Skip if it's a property owner/developer name
      if (!/^(?:OWNER|DEVELOPER|BUILDER|BROKER)\s*:/i.test(extractedName) &&
          !/(?:SATTVA|PRESTIGE|BRIGADE|SOBHA|DLF|GODREJ|TATA)/i.test(extractedName)) {
        name = extractedName;
      }
    }

    // Phone extraction: "Phone - 9876543210" or "Mobile: 9876543210" or "Contact: 9876543210"
    const phoneMatch = bodyText.match(/(?:phone|mobile|contact)\s*[:|-]\s*([+\d\s()-]{7,})/i);
    if (phoneMatch) {
      const extractedPhone = phoneMatch[1].trim();
      // Validate it's actually a phone number (at least 7 digits) and not button text
      const digitsOnly = extractedPhone.replace(/\D/g, '');
      if (digitsOnly.length >= 7) {
        phone = extractedPhone;
      }
    }

    // Email extraction: "Email - jane@example.com" or "Email: jane@example.com"
    const emailMatch = bodyText.match(/email\s*[:|-]\s*(.+)/i);
    if (emailMatch) {
      const extractedEmail = emailMatch[1].trim();
      // Validate it's actually an email address (contains @) and not button text like "Send Email"
      if (extractedEmail.includes('@') && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(extractedEmail)) {
        email = extractedEmail;
      }
    }

    // Try mailto link from HTML (always try HTML extraction for Housing emails)
    if (html) {
      const { mailtoEmail } = extractHousingUrls(html);
      if (mailtoEmail && mailtoEmail.includes('@')) {
        email = mailtoEmail;
      }
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

    // Extract property details for matching against listings
    // Property type: "3 BHK Apartment", "2 BHK Flat", "Villa", etc.
    const propertyTypeMatch = bodyText.match(/(\d+)\s*(?:BHK|BHK)\s*(Apartment|Flat|House|Villa|Plot|Land|Commercial)/i);
    if (propertyTypeMatch) {
      bedrooms = parseInt(propertyTypeMatch[1]);
      propertyType = propertyTypeMatch[2];
    } else {
      // Try just property type without bedrooms
      const typeOnlyMatch = bodyText.match(/(Apartment|Flat|House|Villa|Plot|Land|Commercial)/i);
      if (typeOnlyMatch) propertyType = typeOnlyMatch[1];
    }

    // Location extraction: "Kattigenahalli" or "in Kattigenahalli"
    const locationMatch = bodyText.match(/(?:in|at|near|located)\s+([A-Za-z\s,]+?)(?:\s*,|\s*\n|\s*\d|\s*₹|\s*\.)/i);
    if (locationMatch) {
      propertyLocation = locationMatch[1].trim();
    } else {
      // Try location after property type
      const locationAfterType = bodyText.match(/(?:Apartment|Flat|House|Villa|Plot|Land)\s+in\s+([A-Za-z\s,]+)/i);
      if (locationAfterType) {
        propertyLocation = locationAfterType[1].trim();
      }
    }

    // Area extraction: "1779 sq. ft." or "1,779 Sq.Ft."
    const areaMatch = bodyText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|sq\.?\s*feet)/i);
    if (areaMatch) {
      areaSqft = parseInt(areaMatch[1].replace(/,/g, ''));
    }

    // Price extraction: "₹2.67 Cr" or "2.67 Cr" or "₹ 2.67 Cr"
    const priceMatch = bodyText.match(/₹?\s*([\d.]+)\s*(Cr|Crore|Lakh|L)\b/i);
    if (priceMatch) {
      const priceValue = parseFloat(priceMatch[1]);
      const unit = priceMatch[2].toLowerCase();
      if (unit === 'cr' || unit === 'crore') {
        propertyPrice = Math.round(priceValue * 10000000);
      } else if (unit === 'lakh' || unit === 'l') {
        propertyPrice = Math.round(priceValue * 100000);
      }
    }

    // Housing Property ID extraction: "Property ID: 20327451"
    const propIdMatch = bodyText.match(/Property\s*ID\s*[:|-]\s*(\d+)/i);
    if (propIdMatch) {
      housingPropertyId = propIdMatch[1];
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

  // Generic Block-Format Fallback: If name, email, or phone are still missing, 
  // try to find adjacent lines around the email address line (common in table/card layouts without explicit labels)
  if (!phone || !email || !name || name === 'Portal Lead') {
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    
    // Find the first email line index that is NOT a system or portal/notification email
    let emailIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(emailRegex);
      if (match) {
        const candidate = match[0].toLowerCase();
        const isSystemOrPortal = 
          candidate.includes('convoreal.com') ||
          candidate.includes('99acres.com') ||
          candidate.includes('magicbricks.com') ||
          candidate.includes('housing.com') ||
          candidate.startsWith('noreply') ||
          candidate.startsWith('no-reply') ||
          candidate.startsWith('alerts') ||
          candidate.startsWith('notification') ||
          candidate.startsWith('info') ||
          candidate.startsWith('support') ||
          candidate.startsWith('reply');
          
        if (!isSystemOrPortal) {
          emailIndex = i;
          break;
        }
      }
    }
    
    if (emailIndex !== -1) {
      const candidateEmail = lines[emailIndex].match(emailRegex)?.[0];
      
      // Candidate Name: Try same line first if it matches "Name <email>" format, otherwise scan previous 2 lines
      let candidateName = '';
      const lineWithEmail = lines[emailIndex];
      const nameInAngleBracketsMatch = lineWithEmail.match(/(?:from\s*:\s*)?([^<]+)<[^>]+>/i);
      if (nameInAngleBracketsMatch) {
        const potentialName = nameInAngleBracketsMatch[1].replace(/["']/g, '').trim();
        if (potentialName && !/details|response|dear|hello|hi|sourcing|ingest|message|subject|advertisement|property/i.test(potentialName)) {
          candidateName = potentialName;
        }
      }

      if (!candidateName) {
        for (let i = 1; i <= 2; i++) {
          if (emailIndex - i >= 0) {
            const line = lines[emailIndex - i];
            const isHeaderOrSMTP = /^[a-zA-Z0-9-]+:/i.test(line) || 
                                   /received|by|id|date|subject|from|to|message-id|content-type/i.test(line);
            if (!/details|response|dear|hello|hi|sourcing|ingest|message|subject|advertisement|property/i.test(line) && !isHeaderOrSMTP) {
              candidateName = line;
              break;
            }
          }
        }
      }
      
      // Candidate Phone: Scan the next 2 lines for a phone number (containing 7-15 digits)
      let candidatePhone = '';
      for (let i = 1; i <= 2; i++) {
        if (emailIndex + i < lines.length) {
          const line = lines[emailIndex + i];
          const digitsCount = line.replace(/\D/g, '').length;
          const isHeaderOrSMTP = /^[a-zA-Z0-9-]+:/i.test(line) || 
                                 /received|by|id|date|subject|from|to|message-id|content-type/i.test(line);
          // Skip lines that are clearly not phone numbers (Property ID, listing IDs, etc.)
          const isNotPhone = /property\s*id|listing\s*id|reference|ref\s*#|id\s*:/i.test(line);
          if (digitsCount >= 7 && digitsCount <= 15 && !isHeaderOrSMTP && !isNotPhone) {
            candidatePhone = line.replace(/\(verified\)/i, '').trim();
            break;
          }
        }
      }

      if (candidatePhone && !phone) {
        phone = candidatePhone;
      }
      if (candidateEmail && !email) {
        email = candidateEmail;
      }
      if (candidateName && (!name || name === 'Portal Lead')) {
        name = candidateName;
      }
    }

    // Direct Phone Line Fallback: If phone is still missing, scan for any line containing a valid phone number
    if (!phone) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const digitsCount = line.replace(/\D/g, '').length;
        const isHeaderOrSMTP = /^[a-zA-Z0-9-]+:/i.test(line) || 
                               /received|by|id|date|subject|from|to|message-id|content-type/i.test(line);
        // Skip lines that are clearly not phone numbers (Property ID, listing IDs, etc.)
        const isNotPhone = /property\s*id|listing\s*id|reference|ref\s*#|id\s*:/i.test(line);
        if (digitsCount >= 7 && digitsCount <= 15 && !isHeaderOrSMTP && !isNotPhone) {
          phone = line.replace(/\(verified\)/i, '').trim();
          
          // Candidate Name: Use the line immediately preceding the phone number line
          if (i - 1 >= 0 && (!name || name === 'Portal Lead')) {
            const prevLine = lines[i - 1];
            if (!/details|response|dear|hello|hi|sourcing|ingest|message|subject|advertisement|property/i.test(prevLine)) {
              name = prevLine;
            }
          }
          break;
        }
      }
    }
  }

  // Clean values from HTML wrappers or carriage returns
  const cleanLine = (str: string) => str.replace(/<[^>]*>/g, '').split(/[\r\n]/)[0].trim();

  return {
    name: name ? cleanLine(name) : 'Portal Lead',
    phone: phone ? cleanLine(phone) : '',
    email: email ? cleanLine(email) : '',
    requirementText: requirementText ? cleanLine(requirementText) : '',
    source,
    // Property details for matching against listings
    propertyType: propertyType || null,
    bedrooms,
    propertyLocation: propertyLocation || null,
    areaSqft,
    propertyPrice,
    housingPropertyId: housingPropertyId || null,
  };
}

async function writeSyncLog(args: {
  accountId: string;
  sender: string;
  subject: string;
  extractedName?: string;
  extractedPhone?: string;
  extractedEmail?: string;
  status: 'success' | 'failed' | 'ignored';
  errorMessage?: string;
  bodyPreview?: string;
}) {
  try {
    const supabase = getAdminClient();
    await supabase.from('email_sync_logs').insert({
      account_id: args.accountId,
      sender: args.sender || null,
      subject: args.subject || null,
      extracted_name: args.extractedName || null,
      extracted_phone: args.extractedPhone || null,
      extracted_email: args.extractedEmail || null,
      status: args.status,
      error_message: args.errorMessage || null,
      body_preview: args.bodyPreview || null,
    });
  } catch (err) {
    console.error('[lead-webhook] Failed to write sync log:', err);
  }
}

export async function POST(request: Request) {
  let accountId = '';
  let sender = '';
  let subject = '';
  let bodyText = '';
  let htmlContent = '';

  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    accountId = searchParams.get('account_id') || '';

    // Token validation (Optional check)
    const expectedToken = process.env.LEADS_WEBHOOK_TOKEN;
    if (expectedToken && token !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized token' }, { status: 401 });
    }

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
      
      if (code) {
        console.log(`[lead-webhook] ---> CONFIRMATION CODE: ${code}`);
      }
      if (link) {
        console.log(`[lead-webhook] ---> CONFIRMATION LINK: ${link}`);
      }
      if (!code && !link) {
        // Fallback: log raw text to help find details
        console.log(`[lead-webhook] Raw Content: ${bodyText.slice(0, 1500)}`);
      }
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

    // ── Non-lead email filtering ──────────────────────────────────────────
    // Reject common non-lead emails that slip through Gmail filters.
    // These are notifications, account updates, marketing blasts, etc.
    const isNonLeadEmail = 
      // System/notification emails
      /^noreply@|^no-reply@|^donotreply@|^mailer-daemon@/i.test(sender) ||
      // Account-related notifications
      /account\s+(update|change|alert|notification|verify|security|suspension|deactivation)/i.test(subject) ||
      // Payment/billing notifications
      /(payment|billing|invoice|subscription|renewal|expiry|expir)/i.test(subject) ||
      // Newsletter/marketing blasts (not individual leads)
      /(newsletter|weekly\s+digest|daily\s+update|marketing|promotional|unsubscribe)/i.test(subject) ||
      // Password reset / OTP
      /(password|otp|one.time|reset.*password|forgot.*password)/i.test(subject) ||
      // Property listing updates (not individual inquiries)
      /(new\s+listings?\s+in|property\s+alert|price\s+drop|listing\s+update)/i.test(subject) && !/buyer\s+wants/i.test(subject) ||
      // Auto-generated reports
      /(weekly|monthly|daily)\s+report/i.test(subject) ||
      // LinkedIn notifications
      /linkedin/i.test(sender) ||
      /linkedin.*(?:notification|alert|update|connection|message|invite)/i.test(subject) ||
      // Social media notifications
      /(?:facebook|twitter|instagram|youtube|tiktok).*notification/i.test(sender) ||
      // Marketing/savings/promotional content in subject
      /(exclusive|savings|discount|offer|deal|sale|free|limited.time|act.now|buy.now)/i.test(subject) ||
      // Help/support articles
      /^help\s*:/i.test(subject) ||
      /help.*\.(com|org|net)/i.test(subject);
    
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

    // Dynamic resolution for Housing.com lead phone number
    // Also try HTML URL resolution if phone looks suspicious (e.g., Property ID)
    const isSuspiciousPhone = parsed.phone && /^(property\s*id|listing|ref)/i.test(parsed.phone);
    if (parsed.source === 'Housing' && (!parsed.phone || parsed.phone === '' || isSuspiciousPhone)) {
      const resolvedPhone = await resolveHousingPhone(htmlContent, bodyText);
      if (resolvedPhone) {
        parsed.phone = resolvedPhone;
      }
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

    // Match property from email against user's listings
    let matchedPropertyId: string | null = null;
    if (parsed.source === 'Housing' && (parsed.propertyType || parsed.propertyLocation || parsed.housingPropertyId)) {
      try {
        // Fetch user's published properties
        const { data: properties } = await supabase
          .from('properties')
          .select('id, title, type, location, bedrooms, area_sqft, price, property_code')
          .eq('account_id', accountId)
          .eq('is_published', true);

        if (properties && properties.length > 0) {
          // Try to match by multiple criteria
          const matchedProperty = properties.find((p) => {
            let matchScore = 0;
            
            // Match by property type (Apartment, Flat, etc.)
            if (parsed.propertyType && p.type) {
              const typeLower = parsed.propertyType.toLowerCase();
              const pTypeLower = p.type.toLowerCase();
              if (typeLower.includes(pTypeLower) || pTypeLower.includes(typeLower)) {
                matchScore += 2;
              }
            }

            // Match by bedrooms
            if (parsed.bedrooms && p.bedrooms) {
              if (parsed.bedrooms === p.bedrooms) {
                matchScore += 2;
              }
            }

            // Match by location (fuzzy match)
            if (parsed.propertyLocation && p.location) {
              const locLower = parsed.propertyLocation.toLowerCase();
              const pLocLower = p.location.toLowerCase();
              if (pLocLower.includes(locLower) || locLower.includes(pLocLower)) {
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

            // Require at least 3 points to consider it a match
            return matchScore >= 3;
          });

          if (matchedProperty) {
            matchedPropertyId = matchedProperty.id;
            console.log(`[lead-webhook] Matched property: ${matchedProperty.title} (${matchedProperty.id}) from Housing.com inquiry`);
          }
        }
      } catch (err) {
        console.error('[lead-webhook] Failed to match property:', err);
      }
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
        last_inquired_property_id?: string | null;
      } = {};
      if (maxBudget) updatePayload.max_budget = maxBudget;
      if (areasOfInterest.length > 0) updatePayload.areas_of_interest = areasOfInterest;
      if (propertyInterests.length > 0) updatePayload.property_interests = propertyInterests;
      if (matchedPropertyId) updatePayload.last_inquired_property_id = matchedPropertyId;
      
      // Tag source
      updatePayload.company = parsed.source;
      updatePayload.source = parsed.source;

      await supabase
        .from('contacts')
        .update(updatePayload)
        .eq('id', existingContact.id);

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

      // Trigger automatic WhatsApp reply if configured
      await sendAutoReply({
        supabase,
        accountId,
        syncConfig,
        conversationId,
        cleanPhone,
        leadName: existingContact.name || '',
        leadSource: parsed.source || '',
      });

      return NextResponse.json({
        status: 'updated',
        contactId: existingContact.id,
        name: existingContact.name,
      });
    }

    // Resolve user_id associated with the account to satisfy contacts NOT NULL constraint
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

    // 4. Insert new buyer contact
    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: parsed.name,
        phone: normalizedPhoneNum,
        email: parsed.email || null,
        classification: 'Buyer',
        company: parsed.source, // Stashing the lead portal name in company field
        source: parsed.source, // Storing lead portal name in dedicated source field
        max_budget: maxBudget,
        areas_of_interest: areasOfInterest.length > 0 ? areasOfInterest : null,
        property_interests: propertyInterests.length > 0 ? propertyInterests : null,
        last_inquired_property_id: matchedPropertyId,
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

    // Trigger automatic WhatsApp reply if configured
    await sendAutoReply({
      supabase,
      accountId,
      syncConfig,
      conversationId: conversation?.id || null,
      cleanPhone,
      leadName: parsed.name || '',
      leadSource: parsed.source || '',
    });

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

