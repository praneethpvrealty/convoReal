export function phoneWithCountryCode(
  phone: unknown,
  defaultCountryCode: string
): string {
  if (phone === null || phone === undefined) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits ? '+' + digits : '';
}
