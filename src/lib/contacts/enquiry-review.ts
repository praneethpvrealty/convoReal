/**
 * Whether a WhatsApp enquiry sends its contact to Needs Review.
 *
 * The review queue is triage for strangers: a number the account has
 * never seen, arriving with a listing attached, is checked by an agent
 * before the listing's details go out on Approve. A contact the agent
 * already works with has nothing to check. Demoting them every time
 * they tap a showcase "I'm interested" button pulled a six-week buyer
 * out of Active, and Approve would then have re-sent whichever listing
 * was last linked rather than the one they asked about. The enquiry is
 * still recorded either way — only the status is left alone.
 */
export function enquiryStatusUpdate(contactWasCreated: boolean): {
  status?: 'pending_review';
} {
  return contactWasCreated ? { status: 'pending_review' } : {};
}
