import { phoneWithCountryCode } from '../format/phone';

export const MAX_CSV_CONTACTS = 5000;

export interface CsvAudienceContact {
  phone: string;
  name?: string;
}

export interface CsvAudienceResult {
  contacts: CsvAudienceContact[];
  skipped: number;
}

const DELIMITERS = new Set([',', ';', '\t']);

function recordDelimiter(line: string): string | null {
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && DELIMITERS.has(char)) return char;
  }
  return null;
}

export function csvAudienceLine(contact: CsvAudienceContact): string {
  return contact.name
    ? `${contact.phone},"${contact.name.replace(/"/g, '""')}"`
    : contact.phone;
}

function cells(line: string): string[] {
  const delimiter = recordDelimiter(line);
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((cell) => cell.trim().replace(/^'|'$/g, '').trim());
}

function isExplicitlyInternational(raw: string): boolean {
  return /^\s*(\+|00)/.test(raw);
}

export function csvPhoneDigits(
  raw: string,
  defaultCountryCode: string
): string {
  if (isExplicitlyInternational(raw)) {
    return raw.replace(/\D/g, '').replace(/^00/, '');
  }
  return phoneWithCountryCode(raw, defaultCountryCode).replace(/\D/g, '');
}

function toPhone(raw: string, defaultCountryCode: string): string | null {
  const digits = csvPhoneDigits(raw, defaultCountryCode);
  const min = isExplicitlyInternational(raw) ? 8 : 11;
  return digits.length >= min && digits.length <= 15 ? `+${digits}` : null;
}

function records(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === '\n' || char === '\r')) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

export function parseCsvAudience(
  text: string,
  defaultCountryCode: string
): CsvAudienceResult {
  const lines = records(text)
    .map((line) => line.trim())
    .filter(Boolean);

  const contacts: CsvAudienceContact[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  lines.forEach((line, index) => {
    const [rawPhone = '', rawName = ''] = cells(line);
    if (index === 0 && !/\d/.test(rawPhone)) return;
    const phone = toPhone(rawPhone, defaultCountryCode);
    if (!phone || seen.has(phone)) {
      skipped++;
      return;
    }
    seen.add(phone);
    contacts.push(rawName ? { phone, name: rawName } : { phone });
  });

  return { contacts, skipped };
}
