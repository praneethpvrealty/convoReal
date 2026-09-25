import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  decodeGlyphs,
  pageText,
  pageTexts,
  parseToUnicode,
  planSkippedPages,
  skippedRunEnd,
} from './page-filter';

const GAZETTE =
  'KARNATAKA GAZETTE Part VIA MYSURU, FRIDAY, 29 SEPTEMBER 2023 No. 27 ಅಧಿಸೂಚನೆ ಸಂಖ್ಯೆ 99/2023-24';
const INSTRUCTIONS =
  'ಅನುಬಂಧ-1 ಮೌಲ್ಯ ಮಾಪನಕ್ಕೆ ಸಂಬಂಧಿಸಿದಂತೆ ಅನ್ವಯಿಸುವ ವಿಶೇಷ ಸೂಚನೆಗಳು 20 ಸೆಂಟ್ಸ್ 80% 70% 60% 12.50 19 25';
const AMENITIES =
  'List of Special Amenities provided for Apartments / Villas Swimming pool Cargo lift Covered Car parking (cellar, partial cellar & stilt) 30,00,000 1000 3000 18183 16298 16963 15300';
const RECKONER =
  'READY RECKONER FOR APARTMENT RATE 1 UPTO 1000 19200 201 201000 135200 2 2000 19700 202 202000 135700';
const GRID =
  '186 186000 126600 386 386000 240900 187 187000 127200 387 387000 241400 188 188000 127700';
const RATES =
  'Katipalla Village (Surathkal Hobli) 35,20,000 30,60,000 31,85,000 33,79,000 Potential Area - S.No. 14, 15, 29 Main Road 9000 Cross Road 7000 Interior 4500 Aicon 28,000 Aicon Residency 25,000';
const PID_PAGE =
  '244 39, 1-5-41, 1-5-41, 1-5-91, 1-5-31, 1-5-105A, 1-5-47, 1-5-49, 1-5-51, 1-5-107, 1-5-17, 1-5-19, 1-5-109A';
const PLURAL_ROADS =
  '28 3 Main Roads 1 1 501 - 502 1 - 1 - 501 - 172B, 1 - 1 - 501 - 187, 1 - 1 - 501 - 224 4500 5000';
const PID_LABELS =
  'Ward 4 PID 12/44 PID 12/45 PID 12/46 PID 12/47 ಮುಖ್ಯ ರಸ್ತೆ 4500 ಅಡ್ಡ ರಸ್ತೆ 3500';
const GARBAGE =
  'P lP g P g ( A z t v z A P E S ) 2 0 2 3 - 2 4 f v P Ai g U j v i U a i g P m z g n G A z u P j U P A i i A i f e jU Az AP : 01-10-2023';

describe('planSkippedPages', () => {
  it('[GVL-018] skips the preamble before the first rate page', () => {
    expect(
      planSkippedPages([GAZETTE, INSTRUCTIONS, AMENITIES, RATES, RATES])
    ).toEqual([true, true, true, false, false]);
  });

  it('[GVL-018] skips a ready reckoner and its numeric continuation pages', () => {
    expect(
      planSkippedPages([RATES, RECKONER, GRID, GRID, RATES, GRID])
    ).toEqual([false, true, true, true, false, false]);
  });

  it('[GVL-018] keeps PID lists, plural road headings and blank or garbled pages', () => {
    expect(
      planSkippedPages([
        GAZETTE,
        PID_PAGE,
        '',
        GARBAGE,
        PLURAL_ROADS,
        PID_LABELS,
        RATES,
      ])
    ).toEqual([true, false, false, false, false, false, false]);
  });

  it('[GVL-018] skips nothing when no page reads as a rate table', () => {
    expect(planSkippedPages([GAZETTE, INSTRUCTIONS, GARBAGE, ''])).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('[GVL-018] never skips more than the leading window', () => {
    const texts = [...Array.from({ length: 40 }, () => INSTRUCTIONS), RATES];
    const skip = planSkippedPages(texts);
    expect(skip.filter(Boolean)).toHaveLength(30);
    expect(skip[30]).toBe(false);
    expect(skippedRunEnd(skip, 1)).toBe(30);
    expect(skippedRunEnd(skip, 31)).toBe(30);
  });
});

describe('pageText', () => {
  it('[GVL-018] reads the text a page draws', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const first = doc.addPage([300, 300]);
    first.drawText('Addoor Village (Gurupura Hobli) 3500', {
      x: 20,
      y: 250,
      size: 10,
      font,
    });
    doc.addPage([300, 300]);
    const loaded = await PDFDocument.load(await doc.save());
    expect(pageText(loaded, 0)).toContain('Addoor Village (Gurupura Hobli)');
    expect(pageTexts(loaded)).toEqual([expect.stringContaining('3500'), '']);
  });

  it('[GVL-018] reads text drawn through a form XObject', async () => {
    const inner = await PDFDocument.create();
    const font = await inner.embedFont(StandardFonts.Helvetica);
    inner.addPage([300, 300]).drawText('Kudupu Village (Gurupura Hobli)', {
      x: 20,
      y: 250,
      size: 10,
      font,
    });
    const outer = await PDFDocument.create();
    const [embedded] = await outer.embedPdf(await inner.save());
    outer.addPage([300, 300]).drawPage(embedded);
    const loaded = await PDFDocument.load(await outer.save());
    expect(pageText(loaded, 0)).toContain('Kudupu Village (Gurupura Hobli)');
  });
});

describe('parseToUnicode', () => {
  it('[GVL-018] decodes one-byte and two-byte source codes by their declared width', () => {
    const oneByte = parseToUnicode(
      '1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <41> <0041> <42> <0042> endbfchar'
    );
    expect(decodeGlyphs('4142', oneByte)).toBe('AB');
    const twoByte = parseToUnicode(
      '1 beginbfrange <0010> <0012> <0061> endbfrange 1 beginbfchar <0003> <0020> endbfchar'
    );
    expect(decodeGlyphs('001000110012', twoByte)).toBe('abc');
    expect(decodeGlyphs('00100003', twoByte)).toBe('a ');
  });
});
