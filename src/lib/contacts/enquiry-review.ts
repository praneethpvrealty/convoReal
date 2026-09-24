export function enquiryStatusUpdate(contactWasCreated: boolean): {
  status?: 'pending_review';
} {
  return contactWasCreated ? { status: 'pending_review' } : {};
}
