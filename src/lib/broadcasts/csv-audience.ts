import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

export interface CsvAudienceContact {
  phone: string;
  name?: string;
}

export interface CsvAudienceResult {
  contacts: CsvAudienceContact[];
  skipped: number;
}

const DELIMITERS = new Set([',', ';', '\t']);

function cells(line: string): string[] {
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
    } else if (!inQuotes && DELIMITERS.has(char)) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((cell) => cell.trim().replace(/^'|'$/g, '').trim());
}

function toPhone(raw: string): string | null {
  const phone = normalizePhoneWithCountryCode(raw);
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 11 && digits.length <= 15 ? phone : null;
}

export function parseCsvAudience(text: string): CsvAudienceResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const contacts: CsvAudienceContact[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  lines.forEach((line, index) => {
    const [rawPhone = '', rawName = ''] = cells(line);
    if (index === 0 && !/\d/.test(rawPhone)) return;
    const phone = toPhone(rawPhone);
    if (!phone || seen.has(phone)) {
      skipped++;
      return;
    }
    seen.add(phone);
    contacts.push(rawName ? { phone, name: rawName } : { phone });
  });

  return { contacts, skipped };
}
