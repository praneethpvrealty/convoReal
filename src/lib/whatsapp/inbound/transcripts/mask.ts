/** Ten or more digits with any mix of spaces, dots, hyphens and
 *  brackets between them: +91 99860 54104, +91 (99860) 54104,
 *  +91.99860.54104, (080) 1234 5678. */
const PHONE = /[+(]?\d(?:[\s().-]*\d){9,}/g;
const EMAIL = /\S+@\S+\.\S+/g;

/** The lead's number and email, as they appear in a bubble, replaced
 *  before the text leaves the system: the model judge's prompt and a
 *  copied fixture both go through this. */
export function maskContactDetails(text: string): string {
  return text.replace(PHONE, '[number]').replace(EMAIL, '[email]');
}

/** True when text still carries something the masker would replace. */
export function carriesContactDetails(text: string): boolean {
  return (
    new RegExp(PHONE.source).test(text) || new RegExp(EMAIL.source).test(text)
  );
}
