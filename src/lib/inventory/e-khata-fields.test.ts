import { describe, expect, it } from 'vitest';

import {
  eKhataChanges,
  eKhataNotes,
  isReadableEKhata,
  khataColumns,
  looksLikeEKhata,
  sanitiseEKhata,
} from './e-khata-fields';

const NOW = new Date('2026-09-24T00:00:00Z');

const koramangala = {
  epid: '7425317720',
  khata_form: 'Form-A',
  document_number: '7819024',
  document_date: '2026-04-08',
  corporation: 'Bangalore South City Corporation',
  ward: 'Koramangala',
  property_number: '436',
  address:
    '67008-6TH BLOCK KORAMANGALA, NO.436,,KORAMANGALA,18TH MAIN ROAD,BANGALORE,560095',
  latitude: 77.6238418,
  longitude: 12.9408126,
  site_dimensions_ft: { east_west: 68, north_south: 50 },
  site_area_sqft: '3,401',
  ownership_type: 'Site with Building',
  floors: [
    { floor: null, area_sqft: 4119, occupancy: 'Rented', year_built: 1983 },
    { floor: null, area_sqft: 706, occupancy: 'Rented', year_built: 1983 },
  ],
  owners: ['ANJALI KAPUR XXXXXXXX3304 ABCDE1234F', 'RAVI K 1234 5678 9012'],
  boundaries: {
    north: 'Property No. 436/A',
    east: 'Property No. 465 & 464',
    west: 'Road',
    south: 'Property No. 437',
  },
  tax_year: '2026-27',
  tax_paid: 81614,
  liabilities: 'NA',
};

describe('sanitiseEKhata', () => {
  it('[EKH-001] reads the fields a listing needs and swaps coordinates printed longitude-first', () => {
    const fields = sanitiseEKhata(koramangala, NOW);
    expect(fields).toMatchObject({
      epid: '7425317720',
      khata_form: 'A',
      pincode: '560095',
      latitude: 12.9408126,
      longitude: 77.6238418,
      site_frontage_ft: 68,
      site_depth_ft: 50,
      site_area_sqft: 3401,
      built_up_sqft: 4825,
      year_built: 1983,
      owners: ['ANJALI KAPUR', 'RAVI K'],
      tax_paid: 81614,
    });
    expect(isReadableEKhata(fields)).toBe(true);
  });

  it('[EKH-001] drops coordinates outside India, impossible years and malformed ids', () => {
    const fields = sanitiseEKhata(
      {
        epid: 'ABC',
        khata_form: 'C',
        latitude: 51.5,
        longitude: -0.12,
        year_built: 2099,
        document_date: '04/08/2026',
      },
      NOW
    );
    expect(fields).toEqual({});
    expect(isReadableEKhata(fields)).toBe(false);
  });
});

describe('eKhataChanges', () => {
  it('[EKH-002] proposes every field for an empty listing without replacing anything', () => {
    const changes = eKhataChanges(sanitiseEKhata(koramangala, NOW), {});
    expect(changes.map((c) => c.key)).toEqual([
      'address',
      'city',
      'pin',
      'land_area',
      'dimensions',
      'built_up_area',
      'year_built',
      'khata_epid',
      'khata_form',
    ]);
    expect(changes.find((c) => c.key === 'city')?.value).toBe('Bengaluru');
    expect(changes.find((c) => c.key === 'dimensions')?.value).toBe('68x50');
    expect(changes.every((c) => !c.replaces)).toBe(true);
  });

  it('[EKH-002] marks values that differ from the listing as replacements and skips equal ones', () => {
    const changes = eKhataChanges(sanitiseEKhata(koramangala, NOW), {
      city: 'bengaluru',
      land_area: '3,401',
      built_up_area: 4000,
      dimensions: '68 x 50',
    });
    expect(changes.map((c) => c.key)).not.toContain('city');
    expect(changes.map((c) => c.key)).not.toContain('land_area');
    expect(changes.map((c) => c.key)).not.toContain('dimensions');
    expect(changes.find((c) => c.key === 'built_up_area')).toMatchObject({
      value: '4825',
      current: '4000',
      replaces: true,
    });
  });

  it('[EKH-002] leaves land fields off an apartment and built-up area off a plot', () => {
    const fields = sanitiseEKhata(koramangala, NOW);
    const flat = eKhataChanges(fields, {}, { isApartment: true }).map(
      (c) => c.key
    );
    expect(flat).not.toContain('land_area');
    expect(flat).not.toContain('dimensions');
    const plot = eKhataChanges(fields, {}, { isLand: true }).map((c) => c.key);
    expect(plot).not.toContain('built_up_area');
    expect(plot).not.toContain('year_built');
  });
});

describe('eKhataNotes', () => {
  it('[EKH-002] summarises owner, tax, liabilities and boundaries for review', () => {
    const notes = eKhataNotes(sanitiseEKhata(koramangala, NOW));
    expect(notes).toContain('Owner: ANJALI KAPUR, RAVI K');
    expect(notes.find((n) => n.startsWith('Property tax'))).toContain(
      '2026-27'
    );
    expect(notes).toContain('Liabilities: NA');
    expect(notes.find((n) => n.startsWith('Boundaries'))).toContain('W: Road');
  });
});

describe('looksLikeEKhata', () => {
  it('[EKH-003] recognises e-Khata file names and captions', () => {
    for (const name of [
      'E KHATHA - ANJALI KAPUR.pdf',
      'ekhata.pdf',
      'e-khata_436.pdf',
      'Khata certificate',
      'ePID 7425317720',
    ]) {
      expect(looksLikeEKhata(name)).toBe(true);
    }
    for (const name of ['brochure.pdf', 'Sale deed.pdf', 'floor plan', null]) {
      expect(looksLikeEKhata(name)).toBe(false);
    }
  });
});

describe('khataColumns', () => {
  it('[EKH-004] normalises the stored khata columns and clears invalid values', () => {
    expect(
      khataColumns({
        khata_epid: ' 7425 317720 ',
        khata_form: 'a',
        year_built: '1983',
      })
    ).toEqual({ khata_epid: '7425317720', khata_form: 'A', year_built: 1983 });
    expect(
      khataColumns({ khata_epid: 'ABC', khata_form: 'C', year_built: 'soon' })
    ).toEqual({
      khata_epid: null,
      khata_form: null,
      year_built: null,
    });
    expect(khataColumns({ khata_epid: '12345' }).khata_epid).toBeNull();
    expect(khataColumns({})).toEqual({});
  });
});
