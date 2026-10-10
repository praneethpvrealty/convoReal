import { describe, expect, it } from 'vitest';

import {
  countPropertyDocuments,
  documentApprovalCopy,
  documentApprovalStage,
  documentDecisionLabel,
  documentRequestWaitLabel,
  groupDocumentApprovals,
  type DocumentApprovalRow,
} from './document-approvals';

const NOW = new Date('2026-10-10T12:00:00Z');

function row(
  id: string,
  overrides: Partial<DocumentApprovalRow> = {}
): DocumentApprovalRow {
  return {
    id,
    property_id: `prop-${id}`,
    property_title: `Property ${id}`,
    property_code: null,
    document_count: 2,
    requester_name: 'Pavan',
    requester_phone: '+917353838484',
    requester_email: null,
    status: 'pending',
    share_sent_at: null,
    created_at: '2026-10-10T09:00:00Z',
    updated_at: '2026-10-10T09:00:00Z',
    ...overrides,
  };
}

describe('[DOC-001] a pending request older than a week is stale, not live', () => {
  it('keeps a fresh request pending and times out an old one', () => {
    expect(documentApprovalStage(row('fresh'), NOW)).toBe('pending');
    expect(
      documentApprovalStage(
        row('week', { created_at: '2026-10-03T11:00:00Z' }),
        NOW
      )
    ).toBe('stale');
    expect(
      documentApprovalStage(
        row('august', { created_at: '2026-08-12T09:02:57Z' }),
        NOW
      )
    ).toBe('stale');
    expect(
      documentApprovalStage(row('done', { status: 'approved' }), NOW)
    ).toBe('approved');
    expect(documentApprovalStage(row('no', { status: 'rejected' }), NOW)).toBe(
      'rejected'
    );
  });

  it('says how long the requester has been waiting', () => {
    expect(documentRequestWaitLabel(row('today'), NOW)).toBe(
      'Waiting since today'
    );
    expect(
      documentRequestWaitLabel(
        row('yesterday', { created_at: '2026-10-09T09:00:00Z' }),
        NOW
      )
    ).toBe('Waiting 1 day');
    expect(
      documentRequestWaitLabel(
        row('week', { created_at: '2026-10-04T09:00:00Z' }),
        NOW
      )
    ).toBe('Waiting 6 days');
    expect(
      documentRequestWaitLabel(
        row('august', { created_at: '2026-08-12T09:02:57Z' }),
        NOW
      )
    ).toBe('Timed out · 59 days');
  });

  it('demotes the actions on a stale request', () => {
    const stale = row('old', { created_at: '2026-08-12T09:02:57Z' });
    expect(documentApprovalCopy(stale, NOW)).toEqual({
      approve: 'Send anyway',
      reject: 'Dismiss',
      hint: 'The requester may have moved on since asking.',
    });
    expect(documentApprovalCopy(row('fresh'), NOW)).toEqual({
      approve: 'Approve & send 2 docs',
      reject: 'Reject',
      hint: null,
    });
    expect(
      documentApprovalCopy(row('one', { document_count: 1 }), NOW).approve
    ).toBe('Approve & send 1 doc');
  });
});

describe('[DOC-002] approving a listing with no documents is named for what it sends', () => {
  it('counts only documents with a file behind them', () => {
    expect(countPropertyDocuments(null)).toBe(0);
    expect(countPropertyDocuments([])).toBe(0);
    expect(countPropertyDocuments(['', '  '])).toBe(0);
    expect(countPropertyDocuments(['https://x/a.pdf', ''])).toBe(1);
    expect(
      countPropertyDocuments([
        { url: 'https://x/a.pdf' },
        { url: ' ' },
        { name: 'no url' },
        'https://x/b.pdf',
      ])
    ).toBe(2);
  });

  it('warns before approving without documents, fresh or stale', () => {
    expect(
      documentApprovalCopy(row('none', { document_count: 0 }), NOW)
    ).toEqual({
      approve: 'Approve without documents',
      reject: 'Reject',
      hint: 'No documents uploaded yet. Approving sends a note that they are being prepared.',
    });
    expect(
      documentApprovalCopy(
        row('none-old', {
          document_count: 0,
          created_at: '2026-08-12T09:02:57Z',
        }),
        NOW
      )
    ).toEqual({
      approve: 'Approve anyway',
      reject: 'Dismiss',
      hint: 'No documents uploaded yet. Approving sends a note that they are being prepared.',
    });
  });
});

describe('[DOC-003] one requester is one card, fresh requests first, decisions set aside', () => {
  it('groups pending requests by requester phone and keeps every property', () => {
    const { open, decided } = groupDocumentApprovals(
      [
        row('a', { created_at: '2026-10-10T09:02:22Z' }),
        row('b', { created_at: '2026-10-10T09:02:57Z' }),
        row('c', {
          requester_name: 'Asha',
          requester_phone: '+919800000000',
          created_at: '2026-10-10T08:00:00Z',
        }),
      ],
      NOW
    );
    expect(open.map((group) => group.requester_name)).toEqual([
      'Pavan',
      'Asha',
    ]);
    expect(open[0].rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(open[0].stale).toBe(false);
    expect(decided).toEqual([]);
  });

  it('puts a stale-only requester after fresh ones and fills the email from any row', () => {
    const { open } = groupDocumentApprovals(
      [
        row('old-1', { created_at: '2026-08-12T09:02:22Z' }),
        row('old-2', {
          created_at: '2026-08-12T09:02:57Z',
          requester_email: 'business@kyzion.com',
        }),
        row('new', {
          requester_name: 'Asha',
          requester_phone: '+919800000000',
          created_at: '2026-10-09T08:00:00Z',
        }),
      ],
      NOW
    );
    expect(open.map((group) => group.requester_name)).toEqual([
      'Asha',
      'Pavan',
    ]);
    expect(open[1].stale).toBe(true);
    expect(open[1].requester_email).toBe('business@kyzion.com');
  });

  it('sets decided requests aside, newest decision first', () => {
    const { open, decided } = groupDocumentApprovals(
      [
        row('r', {
          status: 'rejected',
          updated_at: '2026-10-09T10:00:00Z',
        }),
        row('a', {
          status: 'approved',
          share_sent_at: '2026-10-10T10:00:00Z',
          updated_at: '2026-10-10T10:00:00Z',
        }),
        row('p'),
      ],
      NOW
    );
    expect(open).toHaveLength(1);
    expect(decided.map((r) => r.id)).toEqual(['a', 'r']);
    expect(documentDecisionLabel(decided[0])).toBe('Link sent');
    expect(documentDecisionLabel(decided[1])).toBe('Rejected');
    expect(documentDecisionLabel(row('f', { status: 'approved' }))).toBe(
      'Approved · follow up'
    );
  });

  it('falls back to email, then id, when a requester has no phone', () => {
    const { open } = groupDocumentApprovals(
      [
        row('e1', { requester_phone: '', requester_email: 'a@b.c' }),
        row('e2', { requester_phone: '', requester_email: 'a@b.c' }),
        row('x', { requester_phone: '', requester_email: null }),
      ],
      NOW
    );
    expect(open.map((group) => group.rows.length)).toEqual([2, 1]);
  });
});
