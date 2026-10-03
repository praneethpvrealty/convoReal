// Helper to follow redirect headers (manual mode) to extract phone number
export async function resolvePhoneNumberFromUrl(
  url: string,
  depth = 0
): Promise<string | null> {
  if (depth > 3) return null; // Avoid infinite redirects
  try {
    const cleanUrl = url.replace(/&amp;/g, '&');

    // Check if the URL itself already contains the phone number
    // Handle both direct + and URL-encoded %2B for plus sign
    const directPhoneMatch =
      cleanUrl.match(
        /(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i
      ) || cleanUrl.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
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
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const location = response.headers.get('location');
    if (location) {
      const phoneMatch =
        location.match(
          /(?:phone|phone_number|wa\.me\/|send\?phone=|tel:)(\+?\d{10,15})/i
        ) || location.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
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
    const bodyPhoneMatch =
      body.match(/(?:tel:|phone=|wa\.me\/|send\?phone=)(\+?\d{10,15})/i) ||
      body.match(/(?:phone|phone_number)=([+%]2?B?\d{10,15})/i);
    if (bodyPhoneMatch) {
      let phone = bodyPhoneMatch[1];
      // Decode URL-encoded plus sign (%2B or %2b)
      phone = phone.replace(/%2B/gi, '+').replace(/%2b/gi, '+');
      return phone;
    }
  } catch (err) {
    console.error(
      `[resolvePhoneNumberFromUrl] Error at depth ${depth} for URL ${url}:`,
      err
    );
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
    } else if (
      text.includes('call now') ||
      text.includes('call') ||
      href.includes('call')
    ) {
      callNowUrl = href;
    }
  }

  return { whatsappUrl, callNowUrl, mailtoEmail };
}

// Asynchronously resolve Housing phone numbers
export async function resolveHousingPhone(
  html: string,
  bodyText: string
): Promise<string> {
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
  const phoneMatch = bodyText.match(
    /(?:phone|mobile)\s*[:|-]\s*([+\d\s-]{7,15})/i
  );
  if (phoneMatch) return phoneMatch[1].trim();

  return '';
}
