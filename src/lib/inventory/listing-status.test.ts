import { describe, it, expect } from 'vitest';
import {
  CLOSED_LISTING_STATUSES,
  CLOSED_LISTING_STATUS_FILTER,
  isListingClosed,
  isListingLive,
  listingAvailabilityNotice,
  listingStatusInquiryLine,
  appendListingStatusNote,
  listingStatusNote,
  unavailableListingSharePrompt,
  listingStatusAgentLine,
  unavailableListingReply,
  listingAvailabilityAnswer,
  listingStatusCaveat,
  listingAvailabilityContext,
  BRIEF_ON_FILE_NUDGE,
  REQUIREMENTS_NUDGE,
  unavailableListingReplyVariants,
} from './listing-status';
import { PROPERTY_STATUSES } from './property-options';

describe('CLOSED_LISTING_STATUS_FILTER', () => {
  it('quotes every status so the multi-word ones survive PostgREST parsing', () => {
    expect(CLOSED_LISTING_STATUS_FILTER).toBe(
      '("Sold","Off Market","Archived","Rejected")'
    );
  });

  it('names statuses the property editor can actually set', () => {
    for (const status of CLOSED_LISTING_STATUSES) {
      expect(PROPERTY_STATUSES).toContain(status);
    }
  });
});

describe('isListingClosed', () => {
  it('keeps listings that are still in play', () => {
    expect(isListingClosed('Available')).toBe(false);
    expect(isListingClosed('Under Contract')).toBe(false);
    expect(isListingClosed(null)).toBe(false);
  });

  it('closes the ones that have left the market', () => {
    expect(isListingClosed('Sold')).toBe(true);
    expect(isListingClosed('Off Market')).toBe(true);
  });
});

describe('isListingLive', () => {
  it('[INB-009] counts only a listing explicitly published and still Available', () => {
    expect(isListingLive({ status: 'Available', is_published: true })).toBe(
      true
    );
    expect(isListingLive({ status: null, is_published: true })).toBe(true);
    expect(isListingLive({ status: 'Available', is_published: null })).toBe(
      false
    );
    expect(isListingLive({ status: 'Available' })).toBe(false);
    expect(isListingLive({ status: 'Available', is_published: false })).toBe(
      false
    );
    for (const status of ['Under Contract', 'Sold', 'Off Market', 'Archived']) {
      expect(isListingLive({ status, is_published: true }), status).toBe(false);
    }
  });
});

describe('listingAvailabilityNotice', () => {
  it('[PRP-014] stays silent for an available listing', () => {
    expect(listingAvailabilityNotice('Available')).toBeNull();
    expect(listingAvailabilityNotice(null)).toBeNull();
    expect(listingAvailabilityNotice('')).toBeNull();
  });

  it('[PRP-014] tells an enquirer an under-contract listing can still be checked with the owner', () => {
    const notice = listingAvailabilityNotice('Under Contract');
    expect(notice?.label).toBe('Under contract');
    expect(notice?.message).toMatch(/under contract/);
    expect(notice?.message).toMatch(/not closed/);
    expect(notice?.message).toMatch(/check with the listing owner/);
  });

  it('[PRP-014] explains every non-available status the editor can set', () => {
    for (const status of PROPERTY_STATUSES.filter((s) => s !== 'Available')) {
      const notice = listingAvailabilityNotice(status);
      expect(notice, status).not.toBeNull();
      expect(notice?.message).toMatch(/check with the listing owner/);
      expect(notice?.label).not.toBe('');
    }
  });

  it('falls back to the stored status for one it does not know', () => {
    const notice = listingAvailabilityNotice('Rented');
    expect(notice?.label).toBe('Rented');
    expect(notice?.message).toContain('marked rented');
  });
});

describe('listingStatusInquiryLine', () => {
  it('[PRP-014] asks for the latest status only when the listing is not available', () => {
    expect(listingStatusInquiryLine('Available')).toBeNull();
    expect(listingStatusInquiryLine('Under Contract')).toBe(
      'I see it is marked "Under Contract" — could you share its latest status?'
    );
  });
});

describe('appendListingStatusNote', () => {
  it('[PRP-014] leaves an available listing acknowledgement untouched', () => {
    expect(appendListingStatusNote('Thanks!', 'Available')).toBe('Thanks!');
  });

  it('[PRP-014] warns a WhatsApp enquirer that the listing is under contract', () => {
    const text = appendListingStatusNote('Thanks!', 'Under Contract');
    expect(text.startsWith('Thanks!\n\nPlease note:')).toBe(true);
    expect(text).toMatch(/under contract/);
    expect(text).toMatch(/latest status with the owner/);
  });
});

describe('unavailableListingSharePrompt', () => {
  it('[PRP-048] asks nothing for a listing that is still available', () => {
    expect(unavailableListingSharePrompt('Available')).toBeNull();
    expect(unavailableListingSharePrompt(null)).toBeNull();
    expect(listingStatusNote('Available')).toBeNull();
  });

  it('[PRP-048] asks before an under-contract listing is shared and shows the note the buyer would get', () => {
    const prompt = unavailableListingSharePrompt('Under Contract');
    expect(prompt?.label).toBe('Under contract');
    expect(prompt?.title).toBe(
      'This listing is under contract — share it anyway?'
    );
    expect(prompt?.message).toMatch(/under contract with another buyer/);
    expect(prompt?.note).toBe(listingStatusNote('Under Contract'));
    expect(appendListingStatusNote('Hi!', 'Under Contract')).toBe(
      `Hi!\n\n${prompt?.note}`
    );
  });

  it('[PRP-048] asks for every status the editor can set other than Available', () => {
    for (const status of PROPERTY_STATUSES) {
      const prompt = unavailableListingSharePrompt(status);
      if (status === 'Available') expect(prompt).toBeNull();
      else
        expect(prompt?.note.startsWith('Please note: this property is')).toBe(
          true
        );
    }
  });
});

describe('listingStatusAgentLine', () => {
  it('[PRP-014] warns the agent before a visit is promised on an unavailable listing', () => {
    expect(listingStatusAgentLine('Available')).toBeNull();
    expect(listingStatusAgentLine('Sold')).toContain('marked "Sold"');
  });
});

describe('unavailableListingReply', () => {
  it('[PRP-014] stays silent for an available or unverified listing', () => {
    expect(unavailableListingReply('Sandeep', 'Plot', 'Available')).toBeNull();
    expect(unavailableListingReply('Sandeep', 'Plot', null)).toBeNull();
    expect(
      unavailableListingReply('Sandeep', 'Plot', 'Pending Review')
    ).toBeNull();
  });

  it('[PRP-014] promises an update when an under-contract listing frees up and asks for requirements and budget', () => {
    const text = unavailableListingReply(
      'Sandeep Kumar',
      'JP Nagar Plot',
      'Under Contract'
    );
    expect(text).toMatch(
      /^Hi Sandeep, thank you for your interest in \*JP Nagar Plot\*/
    );
    expect(text).toMatch(/I'm sorry/);
    expect(text).toMatch(/under contract with another buyer/);
    expect(text).toMatch(
      /If it becomes available again, we'll come back and update you/
    );
    expect(text).toMatch(/requirements and budget/);
  });

  it('[PRP-014] never promises an update on a sold listing', () => {
    const text = unavailableListingReply('Sandeep', 'JP Nagar Plot', 'Sold');
    expect(text).toMatch(/already been sold/);
    expect(text).not.toMatch(/update you/);
    expect(text).toMatch(/requirements and budget/);
  });

  it('[PRP-014] covers every other status the editor can set', () => {
    for (const status of PROPERTY_STATUSES.filter(
      (s) => !['Available', 'Pending Review', 'Sold'].includes(s)
    )) {
      const text = unavailableListingReply('Sandeep', 'Plot', status);
      expect(text, status).toMatch(/we'll come back and update you/);
      expect(text, status).toMatch(/requirements and budget/);
    }
  });

  it('[CNV-001] ends with the showcase link when one is given, and reads the title without its trailing stop', () => {
    const text = unavailableListingReply(
      'Shirish',
      '#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      'Under Contract',
      'https://aryavarta.convoreal.com/?v=c1'
    );
    expect(text).toMatch(
      /interest in \*#20, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase\*\./
    );
    expect(text).toMatch(
      /\n\nBrowse every live listing any time: https:\/\/aryavarta\.convoreal\.com\/\?v=c1$/
    );
    expect(
      unavailableListingReply('Shirish', 'Plot', 'Under Contract')
    ).not.toMatch(/Browse every live listing/);
  });

  it('greets a placeholder-named portal lead without the placeholder', () => {
    expect(unavailableListingReply('99acres Lead', 'Plot', 'Sold')).toMatch(
      /^Hi, thank you/
    );
  });
});

describe('[PRP-050] a buyer with a requirement on file is not asked for it again', () => {
  it('offers to confirm the saved brief instead of asking for requirements and budget', () => {
    const sold = unavailableListingReply(
      'Ramanathan',
      'Plot',
      'Sold',
      null,
      true
    );
    expect(sold).toContain(BRIEF_ON_FILE_NUDGE);
    expect(sold).not.toContain(REQUIREMENTS_NUDGE);
    const held = unavailableListingReply(
      'Ramanathan',
      'Plot',
      'Under Contract',
      'https://aryavarta.convoreal.com/?v=c1',
      true
    );
    expect(held).toMatch(
      /update you right here\. Meanwhile, I already have your requirement on file/
    );
    expect(held).toMatch(/Browse every live listing any time/);
    expect(
      unavailableListingReply('Ramanathan', 'Plot', 'Sold', null, false)
    ).toContain(REQUIREMENTS_NUDGE);
  });

  it('lists both wordings so a thread holding either counts as told', () => {
    const variants = unavailableListingReplyVariants(
      'Ramanathan',
      'Plot',
      'Sold',
      'https://aryavarta.convoreal.com/?v=c1'
    );
    expect(variants).toEqual([
      unavailableListingReply(
        'Ramanathan',
        'Plot',
        'Sold',
        'https://aryavarta.convoreal.com/?v=c1',
        true
      ),
      unavailableListingReply(
        'Ramanathan',
        'Plot',
        'Sold',
        'https://aryavarta.convoreal.com/?v=c1',
        false
      ),
    ]);
    expect(
      unavailableListingReplyVariants('Ramanathan', 'Plot', 'Available')
    ).toEqual([]);
  });

  it('does the same in the availability answer', () => {
    expect(listingAvailabilityAnswer('Sold', 'Sale', true)).toBe(
      `I'm sorry — this property has already been sold. I'd be glad to find you something similar. ${BRIEF_ON_FILE_NUDGE}`
    );
    expect(listingAvailabilityAnswer('Under Contract', 'Sale', true)).toMatch(
      /Meanwhile, I already have your requirement on file/
    );
    expect(listingAvailabilityAnswer('Sold', 'Sale')).toContain(
      REQUIREMENTS_NUDGE
    );
    expect(listingAvailabilityAnswer('Available', 'Sale', true)).toMatch(
      /currently available/
    );
  });
});

describe('listingAvailabilityAnswer', () => {
  it('[INB-032] confirms an available listing for what it is listed as', () => {
    expect(listingAvailabilityAnswer('Available', 'Sale')).toBe(
      'Yes, this property is currently available for sale.'
    );
    expect(listingAvailabilityAnswer(null, 'Rent')).toBe(
      'Yes, this property is currently available for rent.'
    );
    expect(listingAvailabilityAnswer('Available', 'JV/JD')).toMatch(
      /for joint development/
    );
  });

  it('[INB-032] apologises for an under-contract listing and asks for requirements', () => {
    const text = listingAvailabilityAnswer('Under Contract', 'Sale');
    expect(text).toMatch(/^I'm sorry/);
    expect(text).toMatch(/under contract with another buyer/);
    expect(text).toMatch(/If it becomes available again/);
    expect(text).toMatch(/requirements and budget/);
    expect(text).not.toMatch(/currently available/);
  });

  it('[INB-032] never promises an update on a sold listing', () => {
    const text = listingAvailabilityAnswer('Sold', 'Sale');
    expect(text).toMatch(/already been sold/);
    expect(text).not.toMatch(/update you/);
  });

  it('[INB-032] will not confirm an unverified listing', () => {
    expect(listingAvailabilityAnswer('Pending Review', 'Sale')).toMatch(
      /can't confirm its availability/
    );
  });

  it('[INB-032] answers every status the editor can set', () => {
    for (const status of PROPERTY_STATUSES) {
      expect(listingAvailabilityAnswer(status, 'Sale'), status).not.toBe('');
    }
  });
});

describe('listingStatusCaveat', () => {
  it('[INB-032] rides on an answer about an unavailable listing only', () => {
    expect(listingStatusCaveat('Available')).toBeNull();
    expect(listingStatusCaveat(undefined)).toBeNull();
    expect(listingStatusCaveat('Under Contract')).toBe(
      'Please note: this property is currently under contract with another buyer, but the deal is not closed yet.'
    );
    expect(listingStatusCaveat('Sold')).toBe(
      'Please note: this property is already sold.'
    );
  });
});

describe('listingAvailabilityContext', () => {
  it('[INB-032] tells the model an unavailable listing is NOT available, in those words', () => {
    expect(listingAvailabilityContext('Available')).toBe('Available');
    expect(listingAvailabilityContext(null)).toBe('Available');
    expect(listingAvailabilityContext('Under Contract')).toMatch(
      /^NOT available — currently under contract/
    );
    expect(listingAvailabilityContext('Sold')).toBe(
      'NOT available — already sold'
    );
    expect(listingAvailabilityContext('Pending Review')).toMatch(
      /^Not yet confirmed/
    );
  });
});
