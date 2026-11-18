import { describe, expect, it } from 'vitest';
import type { Contact } from '@/types';
import { pulseVisitorLabel, pulseVisitorLabelParts } from './visitor-label';

const timeAgo = () => '2h ago';
const session = 'e3e4ba9d-1234-4abc-8def-000000000000';

describe('[PLS-003] visitor label', () => {
  it('names an identified visitor', () => {
    expect(
      pulseVisitorLabel(
        {
          contact: { id: 'c-1', name: 'Salman', phone: '+91' } as Contact,
          via_contact: null,
          share: null,
          session_key: session,
        },
        timeAgo
      )
    ).toBe('Salman');
  });

  it('labels a forwarded-link viewer as a guest via the sender, never as the sender', () => {
    const label = pulseVisitorLabel(
      {
        contact: null,
        via_contact: { id: 'c-1', name: 'Ravi', phone: '+91' },
        share: null,
        session_key: session,
      },
      timeAgo
    );
    expect(label).toBe("Guest via Ravi's link · e3e4ba9d");
    expect(label).not.toBe('Ravi');
  });

  it('dates a generic-share guest to the share', () => {
    expect(
      pulseVisitorLabel(
        {
          contact: null,
          via_contact: null,
          share: { id: 's-1', created_at: '2026-09-26T10:00:00Z' },
          session_key: session,
        },
        timeAgo
      )
    ).toBe('Guest via link shared 2h ago · e3e4ba9d');
  });

  it('falls back to an anonymous guest', () => {
    expect(
      pulseVisitorLabel(
        { contact: null, via_contact: null, share: null, session_key: session },
        timeAgo
      )
    ).toBe('Anonymous Guest · e3e4ba9d');
  });
});

describe('[PLS-002] visitor label contact capsule', () => {
  it('splits out the identified visitor as the linked contact', () => {
    expect(
      pulseVisitorLabelParts(
        {
          contact: { id: 'c-1', name: 'Salman', phone: '+91' } as Contact,
          via_contact: null,
          share: null,
          session_key: session,
        },
        timeAgo
      )
    ).toEqual({
      before: '',
      contact: { id: 'c-1', label: 'Salman' },
      after: '',
    });
  });

  it('links the forwarded-link sender, not the guest', () => {
    expect(
      pulseVisitorLabelParts(
        {
          contact: null,
          via_contact: { id: 'c-9', name: 'Abhishek', phone: '+91' },
          share: null,
          session_key: session,
        },
        timeAgo
      )
    ).toEqual({
      before: 'Guest via ',
      contact: { id: 'c-9', label: 'Abhishek' },
      after: "'s link · e3e4ba9d",
    });
  });

  it('gives an anonymous guest no contact capsule', () => {
    expect(
      pulseVisitorLabelParts(
        { contact: null, via_contact: null, share: null, session_key: session },
        timeAgo
      ).contact
    ).toBeNull();
  });
});
