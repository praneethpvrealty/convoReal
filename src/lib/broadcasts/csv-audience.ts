import { normalizePhoneWithCountryCode } from '@/lib/whatsapp/phone-utils';

export interface CsvAudienceContact {
  phone: string;
  name?: string;
}

export interface CsvAudienceResult {
  contacts: CsvAudienceContact[];
  skipped: number;
}

function cells(line: string): string[] {
  return line.split(/[,;\t]/).map((cell) =>
    cell
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim()
  );
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
