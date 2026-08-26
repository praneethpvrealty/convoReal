export type TodoCheckInKind =
  | 'site_visit'
  | 'call'
  | 'meeting'
  | 'document'
  | 'follow_up';

export function inferTodoCheckInKind(
  title: string,
  description?: string | null
): TodoCheckInKind {
  const text = `${title} ${description ?? ''}`.toLowerCase();
  if (/\b(site\s*visit|visit|visited|yet to visit|inspection)\b/.test(text)) {
    return 'site_visit';
  }
  if (/\b(call|phone|spoke|speak)\b/.test(text)) return 'call';
  if (/\b(meet|meeting|appointment)\b/.test(text)) return 'meeting';
  if (/\b(document|documents|doc|agreement|email|advocate|lawyer|legal)\b/.test(text)) {
    return 'document';
  }
  return 'follow_up';
}

export function buildTodoParticipantCheckIn(opts: {
  title: string;
  description?: string | null;
  contactName?: string | null;
  propertyTitle?: string | null;
}): { label: string; message: string } {
  const kind = inferTodoCheckInKind(opts.title, opts.description);
  const firstName = opts.contactName?.trim().split(/\s+/)[0] || 'there';
  const property = opts.propertyTitle?.trim();
  const aboutProperty = property ? ` for ${property}` : '';

  switch (kind) {
    case 'site_visit':
      return {
        label: 'visit',
        message: `Hi ${firstName}, just checking in${aboutProperty}. Were you able to complete the site visit? Please share a quick update on how it went and whether you would like to take it forward or see other options.`,
      };
    case 'call':
      return {
        label: 'call',
        message: `Hi ${firstName}, just checking in${aboutProperty}. Were you able to complete the planned call? Please let me know the update and if anything needs to be taken forward from my side.`,
      };
    case 'meeting':
      return {
        label: 'meeting',
        message: `Hi ${firstName}, just checking in${aboutProperty}. Were you able to complete the meeting? Please share a quick update and let me know the next step you would like to take.`,
      };
    case 'document':
      return {
        label: 'document follow-up',
        message: `Hi ${firstName}, just checking in${aboutProperty}. Were you able to complete the document or legal follow-up? Please let me know the current status and if anything is still pending.`,
      };
    default:
      return {
        label: 'follow-up',
        message: `Hi ${firstName}, just checking in${aboutProperty}. Were you able to complete the planned follow-up? Please share the current status and let me know if anything needs to be taken forward.`,
      };
  }
}
