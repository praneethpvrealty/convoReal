export interface PhoneHints {
  international: string;
  quickAdd: string;
  invalid: (entry: string) => string;
}

export function phoneHints(countryCode: string): PhoneHints {
  const code = countryCode.replace(/\D/g, '') || '91';
  if (code === '91') {
    return {
      international: '+91 98765 43210',
      quickAdd: 'Phone · e.g. 99002 77111',
      invalid: (entry) =>
        `"${entry}" doesn’t look like a phone number — use 10 digits, or include the country code.`,
    };
  }
  return {
    international: `+${code} phone number`,
    quickAdd: `Phone · 10 digits or +${code}…`,
    invalid: (entry) =>
      `"${entry}" doesn’t look like a phone number — use the 10-digit local number, or include the country code (+${code}).`,
  };
}
