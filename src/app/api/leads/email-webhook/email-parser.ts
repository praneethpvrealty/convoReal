import { extractHousingUrls } from './phone-resolver';

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
export function parseBudgetToINR(text: string): number | null {
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
export function isValidContactName(name: string): boolean {
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

// Helper to strip owner/developer/builder/individual/agent/buyer suffixes from contact names
// e.g. "Kg Subramanian (Owner)" -> "Kg Subramanian", "Pushpa (Individual)" -> "Pushpa"
export function stripOwnerSuffix(name: string): string {
  if (!name) return name;
  return name.replace(/\s*\((?:Owner|Developer|Builder|Broker|Landlord|Seller|Individual|Agent|Buyer|Tenant|Customer)\)\s*$/i, '').trim();
}

const ROLE_SUFFIX_TO_CLASSIFICATION: Record<string, 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Developer'> = {
  owner: 'Owner',
  developer: 'Developer',
  builder: 'Developer',
  broker: 'Agent',
  agent: 'Agent',
  landlord: 'Owner',
  seller: 'Seller',
  // "Individual" distinguishes a private buyer/tenant from an agent
  // in portal parlance (e.g. Magicbricks' "DineshReddy (Individual)" suffix).
  individual: 'Buyer',
  buyer: 'Buyer',
  tenant: 'Buyer',
  customer: 'Buyer',
};

/**
 * Reads the same "(Role)" suffix stripOwnerSuffix() removes, and maps
 * it to a contact classification. Must be called on the *raw* parsed
 * name, before stripOwnerSuffix() — once stripped, the role signal is
 * gone. Returns null when no suffix is present (the common case for
 * portal leads), so the caller can fall back to its own default.
 */
export function classificationFromNameSuffix(
  name: string,
): 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Developer' | null {
  if (!name) return null;
  const match = name.match(/\((Owner|Developer|Builder|Broker|Landlord|Seller|Individual|Agent|Buyer|Tenant|Customer)\)\s*$/i);
  if (!match) return null;
  return ROLE_SUFFIX_TO_CLASSIFICATION[match[1].toLowerCase()] ?? null;
}

/**
 * True when the email reads as an inbound inquiry about the
 * RECIPIENT'S own listing — "…would like to talk to you regarding
 * your plot", "is interested in your property", Housing's "We have
 * received a contact request from our user", etc.
 */
export function isInquiryAboutOwnListing(text: string): boolean {
  if (!text) return false;
  return (
    /\b(?:regarding|about|interested in|interest in|enquir(?:y|ing)\s+(?:for|about|on)?|inquir(?:y|ing)\s+(?:for|about|on)?)\s*your\s+(?:plot|property|properties|villa|house|flat|apartment|listing|land|office|shop|showroom|site|project|ad(?:vertisement)?)/i.test(text) ||
    /contact request from our user/i.test(text) ||
    /(?:they are|is|are) awaiting your resp/i.test(text)
  );
}

/**
 * Deal-aware classification for a portal lead. On inquiry emails
 * about the recipient's OWN listing, the "(Owner)"/"(Seller)" name
 * suffix describes the inquirer's portal account type — NOT their
 * role in this deal. Someone whose Housing account says "Owner" but
 * who is asking about your plot is a buyer lead, so ownership-type
 * suffixes collapse to Buyer in that context. "(Broker)"/"(Agent)"
 * keeps classifying as Agent — knowing the inquirer is another agent
 * is real signal either way.
 */
export function classifyPortalLead(
  rawName: string,
  contextText: string,
): 'Owner' | 'Seller' | 'Buyer' | 'Agent' | 'Developer' | null {
  const fromSuffix = classificationFromNameSuffix(rawName);
  if (!fromSuffix) return null;
  if (
    fromSuffix !== 'Agent' &&
    fromSuffix !== 'Buyer' &&
    isInquiryAboutOwnListing(contextText)
  ) {
    return 'Buyer';
  }
  return fromSuffix;
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

    // Phone extraction: "Phone|mobile|tel|contact"
    const phoneMatch = bodyText.match(/(?:phone|mobile|tel|contact)\s*[:|-]\s*([+\d\s-]{7,15})/i);
    if (phoneMatch) phone = phoneMatch[1].trim();

    // Email extraction
    const emailMatch = bodyText.match(/(?:email|mail)\s*[:|-]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) email = emailMatch[1].trim();

    // Requirement extraction
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
          // Skip lines that are clearly not phone numbers (Property ID, listing IDs, etc., or URLs)
          const isNotPhone = /property\s*id|listing\s*id|reference|ref\s*#|id\s*:/i.test(line) || line.includes('/') || line.includes('http');
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
        // Skip lines that are clearly not phone numbers (Property ID, listing IDs, etc., or URLs)
        const isNotPhone = /property\s*id|listing\s*id|reference|ref\s*#|id\s*:/i.test(line) || line.includes('/') || line.includes('http');
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

  // Generic Property Details Parser
  const combinedText = `${subject}\n${bodyText}`;

  // 1. Property Type & Bedrooms
  const propertyTypeMatch = combinedText.match(/(\d+)\s*(?:BHK|BHK)\s*(Apartment|Flat|House|Villa|Plot|Land|Commercial|Industrial)/i);
  if (propertyTypeMatch) {
    bedrooms = parseInt(propertyTypeMatch[1]);
    propertyType = propertyTypeMatch[2];
  }
  
  // Try intelligent type mapping first
  const mappedType = extractPropertyType(combinedText);
  if (mappedType) {
    propertyType = mappedType;
  } else if (!propertyType) {
    // Fallback to simple keyword match
    const typeOnlyMatch = combinedText.match(/(Apartment|Flat|House|Villa|Plot|Land|Commercial|Industrial)/i);
    if (typeOnlyMatch) propertyType = typeOnlyMatch[1];
  }

  // 2. Location
  if (!propertyLocation) {
    const locationMatch = combinedText.match(/(?:in|at|near|located)\s+([A-Za-z\s,]+?)(?:\s*,|\s*\n|\s*\d|\s*₹|\s*\.)/i);
    if (locationMatch) {
      propertyLocation = locationMatch[1].trim();
    } else {
      const locationAfterType = combinedText.match(/(?:Apartment|Flat|House|Villa|Plot|Land|Industrial)\s+in\s+([A-Za-z\s,]+)/i);
      if (locationAfterType) {
        propertyLocation = locationAfterType[1].trim();
      } else {
        // Comma-separated listing-card format some portal emails use,
        // e.g. "5 BHK Villa, Devanahalli, 8400 sq. ft., ₹16.0 Cr" — the
        // location directly follows the property type, before the next
        // comma, with no "in/at/near" connector at all.
        const locationAfterTypeComma = combinedText.match(/(?:Apartment|Flat|House|Villa|Plot|Land|Industrial|Commercial|Studio|Penthouse)s?\s*,\s*([A-Za-z][A-Za-z\s]*?)\s*,/i);
        if (locationAfterTypeComma) {
          propertyLocation = locationAfterTypeComma[1].trim();
        }
      }
    }
  }

  // 3. Area
  if (!areaSqft) {
    const areaMatch = combinedText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|sq\.?\s*feet)/i);
    if (areaMatch) {
      areaSqft = parseInt(areaMatch[1].replace(/,/g, ''));
    }
  }

  // 4. Price
  if (!propertyPrice) {
    const priceMatch = combinedText.match(/₹?\s*([\d.]+)\s*(Cr|Crore|Lakh|L)\b/i);
    if (priceMatch) {
      const priceValue = parseFloat(priceMatch[1]);
      const unit = priceMatch[2].toLowerCase();
      if (unit === 'cr' || unit === 'crore') {
        propertyPrice = Math.round(priceValue * 10000000);
      } else if (unit === 'lakh' || unit === 'l') {
        propertyPrice = Math.round(priceValue * 100000);
      }
    }
  }

  // Clean values from HTML wrappers or carriage returns
  const cleanLine = (str: string) => str.replace(/<[^>]*>/g, '').split(/[\r\n]/)[0].trim();

  return {
    name: name ? cleanLine(name) : 'Portal Lead',
    phone: phone ? cleanLine(phone) : '',
    email: email ? cleanLine(email) : null,
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

export function extractPropertyType(text: string): string | null {
  const lower = text.toLowerCase();
  // Whole commercial buildings / mixed-use developments — before the
  // office/shop/apartment keywords they typically also mention.
  if (
    lower.includes('mixed use') ||
    lower.includes('mixed-use') ||
    /commercial\s*(building|complex|development)/.test(lower)
  ) {
    return 'Commercial Building';
  }
  if (lower.includes('industrial land') || lower.includes('industrial plot')) return 'Industrial Land';
  if (lower.includes('industrial building') || lower.includes('industry building')) return 'Industrial Building';
  if (lower.includes('industrial shed') || lower.includes('industrial factory')) return 'Industrial Shed';
  if (lower.includes('warehouse') || lower.includes('godown')) return 'Warehouse/ Godown';
  if (lower.includes('commercial land')) return 'Commercial Land';
  if (lower.includes('commercial office') || lower.includes('office space') || lower.includes('office in it park')) return 'Commercial Office Space';
  if (lower.includes('commercial showroom') || lower.includes('showroom')) return 'Commercial Showroom';
  if (lower.includes('commercial shop') || lower.includes('retail shop') || lower.includes(' shop')) return 'Commercial Shop';
  if (lower.includes('penthouse')) return 'Penthouse';
  if (lower.includes('studio apartment')) return 'Studio Apartment';
  // Specific residential structure types must be checked BEFORE the
  // generic 'bhk'/'flat'/'apartment' catch-all below. "5 BHK Villa"
  // contains "bhk" too, and with the catch-all first, it used to win —
  // silently reclassifying villas/houses as apartments whenever a BHK
  // count was mentioned alongside them.
  if (lower.includes('villa')) return 'Villa';
  if (lower.includes('farm house') || lower.includes('farmland') || lower.includes('farm land')) return 'Farm House';
  if (lower.includes('agricultural land')) return 'Agricultural Land';
  if (lower.includes('builder floor')) return 'Builder Floor Apartment';
  if (lower.includes('house')) return 'Residential House';
  if (lower.includes('flat') || lower.includes('apartment') || lower.includes('bhk')) return 'Flat/ Apartment';
  if (lower.includes('residential land') || lower.includes('residential plot') || lower.includes(' plot') || lower.includes(' land')) return 'Residential Land/ Plot';
  return null;
}
