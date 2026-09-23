import { describe, expect, it } from 'vitest';

import {
  districtFromLabel,
  discoverPdfs,
  downloadPdf,
  extractGuidanceTable,
  extractPdfLinks,
  fetchAllowed,
  isAllowedSourceUrl,
  readCapped,
} from './import-url';

const PAGE = 'https://igr.karnataka.gov.in/72/revised-guidelines-value/en';

const IGR_TABLE = `
<h3>Revised Guidelines Value 2023-24</h3>
<table>
  <tr><th>Sl.No.</th><th>District</th><th>Sub Registrar Office</th><th>Download</th><th>BDA corrigendum Gazette</th></tr>
  <tr><td>1</td><td rowspan="3">Gandhinagar</td><td>Gandhinagara</td>
      <td><a href="/storage/pdf-files/gv/Gandhinagara.pdf" class="btn">View</a></td><td></td></tr>
  <tr><td>2</td><td>Malleshwara</td>
      <td><a href="https://igr.karnataka.gov.in/storage/pdf-files/gv/Malleshwara.pdf">View</a></td><td></td></tr>
  <tr><td>6</td><td>Byatarayanapura</td>
      <td><button onclick="window.open('/storage/pdf-files/gv/Byatarayanapura.pdf')">View</button></td>
      <td><a href="/storage/pdf-files/bda/Byatarayanapura-corrigendum.pdf">View</a></td></tr>
  <tr><td>80</td><td rowspan="2">Bellary</td><td>Kampli</td>
      <td><a href="/storage/pdf-files/gv/Kampli.pdf">View</a></td><td></td></tr>
  <tr><td>81</td><td>Evil</td><td><a href="https://evil.example/x.pdf">View</a></td><td></td></tr>
</table>`;

describe('isAllowedSourceUrl', () => {
  it('[GVL-005] allows only https karnataka.gov.in hosts', () => {
    expect(isAllowedSourceUrl(PAGE)).toBe(true);
    expect(isAllowedSourceUrl('https://karnataka.gov.in/a.pdf')).toBe(true);
    expect(isAllowedSourceUrl('http://igr.karnataka.gov.in/a.pdf')).toBe(false);
    expect(isAllowedSourceUrl('https://igr.karnataka.gov.in.evil.com/a')).toBe(
      false
    );
    expect(isAllowedSourceUrl('https://evilkarnataka.gov.in/a')).toBe(false);
    expect(isAllowedSourceUrl('https://user:pw@igr.karnataka.gov.in/a')).toBe(
      false
    );
    expect(isAllowedSourceUrl('https://igr.karnataka.gov.in:8443/a')).toBe(
      false
    );
    expect(isAllowedSourceUrl('not a url')).toBe(false);
  });
});

describe('extractGuidanceTable', () => {
  it('[GVL-005] reads each SRO row, carrying the spanned district down', () => {
    const rows = extractGuidanceTable(IGR_TABLE, PAGE);
    expect(
      rows.map((r) => [r.sro, r.registration_district, r.district, r.kind])
    ).toEqual([
      ['Gandhinagara', 'Gandhinagar', 'Bengaluru Urban', 'notification'],
      ['Malleshwara', 'Gandhinagar', 'Bengaluru Urban', 'notification'],
      ['Byatarayanapura', 'Gandhinagar', 'Bengaluru Urban', 'notification'],
      ['Byatarayanapura', 'Gandhinagar', 'Bengaluru Urban', 'corrigendum'],
      ['Kampli', 'Bellary', 'Ballari', 'notification'],
    ]);
    expect(rows[0].url).toBe(
      'https://igr.karnataka.gov.in/storage/pdf-files/gv/Gandhinagara.pdf'
    );
    expect(rows[2].url).toBe(
      'https://igr.karnataka.gov.in/storage/pdf-files/gv/Byatarayanapura.pdf'
    );
    expect(rows[0].label).toBe(
      'Revised Guidelines Value 2023-24 · Gandhinagar · Gandhinagara'
    );
    expect(rows[3].label).toMatch(/BDA corrigendum$/);
    expect(rows.some((r) => r.url.includes('evil'))).toBe(false);
  });
});

describe('extractPdfLinks', () => {
  it('falls back to plain PDF anchors on allowed hosts', () => {
    const links = extractPdfLinks(
      '<a href="/files/Mysuru%20GV.pdf">Mysuru &amp; taluks</a><a href="/x.html">x</a><a href="https://evil.example/a.pdf">a</a>',
      PAGE
    );
    expect(links).toEqual([
      {
        url: 'https://igr.karnataka.gov.in/files/Mysuru%20GV.pdf',
        label: 'Mysuru & taluks',
        district: 'Mysuru',
        kind: 'notification',
      },
    ]);
  });
});

describe('districtFromLabel', () => {
  it('maps registration districts and old names', () => {
    expect(districtFromLabel('Jayanagar')).toBe('Bengaluru Urban');
    expect(districtFromLabel('Belgaum')).toBe('Belagavi');
    expect(districtFromLabel('Bangalore Rural')).toBe('Bengaluru Rural');
    expect(districtFromLabel('Atlantis')).toBeNull();
  });
});

function response(
  body: BodyInit | null,
  init: ResponseInit & { headers?: Record<string, string> } = {}
) {
  return new Response(body, init);
}

describe('fetchAllowed', () => {
  it('[GVL-005] refuses a redirect off the allowed hosts', async () => {
    const fetcher = async () =>
      response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      });
    await expect(fetchAllowed(PAGE, fetcher)).rejects.toThrow(
      /karnataka\.gov\.in/
    );
  });

  it('follows an allowed redirect', async () => {
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return seen.length === 1
        ? response(null, { status: 301, headers: { location: '/new' } })
        : response('ok');
    };
    const { url } = await fetchAllowed(PAGE, fetcher);
    expect(url).toBe('https://igr.karnataka.gov.in/new');
  });
});

describe('readCapped / downloadPdf / discoverPdfs', () => {
  it('stops reading past the cap', async () => {
    await expect(readCapped(response('x'.repeat(20)), 10)).rejects.toThrow(
      /over/
    );
    await expect(
      readCapped(response('x', { headers: { 'content-length': '999' } }), 10)
    ).rejects.toThrow(/over/);
  });

  it('refuses a download that is not a PDF', async () => {
    await expect(
      downloadPdf(`${PAGE}.pdf`, async () => response('<html>'))
    ).rejects.toThrow(/did not return a PDF/);
    const { bytes } = await downloadPdf(`${PAGE}.pdf`, async () =>
      response('%PDF-1.7 body')
    );
    expect(bytes.length).toBe(13);
  });

  it('lists the table rows of a page, or the link itself for a PDF', async () => {
    const rows = await discoverPdfs(PAGE, async () =>
      response(IGR_TABLE, { headers: { 'content-type': 'text/html' } })
    );
    expect(rows).toHaveLength(5);
    const single = await discoverPdfs(
      'https://igr.karnataka.gov.in/files/Mysuru.pdf',
      async () =>
        response('%PDF', { headers: { 'content-type': 'application/pdf' } })
    );
    expect(single).toEqual([
      {
        url: 'https://igr.karnataka.gov.in/files/Mysuru.pdf',
        label: 'Mysuru',
        district: 'Mysuru',
        kind: 'notification',
      },
    ]);
  });
});
