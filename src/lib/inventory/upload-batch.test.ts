import { describe, expect, it } from 'vitest';

import {
  documentTitleFromFileName,
  uploadFailureSummary,
} from '@/lib/inventory/upload-batch';
import { cappedResultsNotice } from '@/lib/inventory/result-cap';

describe('[UIX-041] documentTitleFromFileName', () => {
  it('[UIX-041] drops the extension and keeps the rest of the name', () => {
    expect(documentTitleFromFileName('Sale Deed 2024.pdf')).toBe(
      'Sale Deed 2024'
    );
    expect(documentTitleFromFileName('e.khata.final.jpeg')).toBe(
      'e.khata.final'
    );
    expect(documentTitleFromFileName('C:\\scans\\EC.pdf')).toBe('EC');
  });

  it('[UIX-041] keeps a name with no extension or a leading dot', () => {
    expect(documentTitleFromFileName('README')).toBe('README');
    expect(documentTitleFromFileName('.env')).toBe('.env');
  });
});

describe('[UIX-030] uploadFailureSummary', () => {
  it('[UIX-030] says nothing when every file uploaded', () => {
    expect(uploadFailureSummary([], 'photo')).toBeNull();
  });

  it('[UIX-030] names one failed file and why', () => {
    expect(
      uploadFailureSummary(
        [{ name: 'a.jpg', reason: 'larger than 5MB' }],
        'photo'
      )
    ).toBe('Couldn\'t upload "a.jpg": larger than 5MB');
  });

  it('[UIX-030] lists several failed files, capped at three names', () => {
    const failed = ['a', 'b', 'c', 'd', 'e'].map((n) => ({
      name: `${n}.pdf`,
      reason: 'x',
    }));
    expect(uploadFailureSummary(failed.slice(0, 2), 'document')).toBe(
      'Couldn\'t upload 2 documents: "a.pdf", "b.pdf"'
    );
    expect(uploadFailureSummary(failed, 'document')).toBe(
      'Couldn\'t upload 5 documents: "a.pdf", "b.pdf", "c.pdf" and 2 more'
    );
  });
});

describe('[UIX-035] cappedResultsNotice', () => {
  it('[UIX-035] says how many of the total are shown when capped', () => {
    expect(cappedResultsNotice(100, 340)).toBe(
      'Showing the first 100 of 340 listings'
    );
  });

  it('[UIX-035] says nothing when everything fits or the total is unknown', () => {
    expect(cappedResultsNotice(40, 40)).toBeNull();
    expect(cappedResultsNotice(100, null)).toBeNull();
    expect(cappedResultsNotice(0, 12)).toBeNull();
  });
});
