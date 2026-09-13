import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_APPROVE_PREFIX,
  DOCUMENT_REJECT_PREFIX,
  parseDocumentDecisionReply,
} from '@/lib/inventory/document-requests';

describe('parseDocumentDecisionReply', () => {
  it('parses approve and reject controls', () => {
    expect(
      parseDocumentDecisionReply(`${DOCUMENT_APPROVE_PREFIX}request-1`)
    ).toEqual({
      requestId: 'request-1',
      decision: 'approve',
    });
    expect(
      parseDocumentDecisionReply(`${DOCUMENT_REJECT_PREFIX}request-2`)
    ).toEqual({
      requestId: 'request-2',
      decision: 'reject',
    });
  });

  it('does not claim ordinary replies', () => {
    expect(parseDocumentDecisionReply('approve')).toBeNull();
    expect(parseDocumentDecisionReply('')).toBeNull();
  });
});
