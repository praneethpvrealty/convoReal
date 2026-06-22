import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parsePortalLead,
  extractHousingUrls,
  resolvePhoneNumberFromUrl,
  resolveHousingPhone
} from './route';

describe('Email Webhook Lead Parsing', () => {
  describe('parsePortalLead', () => {
    it('should parse Magicbricks emails correctly', () => {
      const subject = 'Buyer has contacted you on Magicbricks for - Commercial Showroom';
      const body = `
        Dear Praneeth,
        A user is interested in your Property.
        Details of Contact Made:
        Name: S (Individual)
        Mobile: 9738622542
        Email: shreyasrvce@gmail.com
        Requirement: Commercial Showroom in Indiranagar
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('Magic Bricks');
      expect(res.name).toBe('S (Individual)');
      expect(res.phone).toBe('9738622542');
      expect(res.email).toBe('shreyasrvce@gmail.com');
      expect(res.requirementText).toBe('Commercial Showroom in Indiranagar');
    });

    it('should parse 99acres emails correctly', () => {
      const subject = 'Property Advertisement Response';
      const body = `
        Dear PRANEETH KUMAR,
        You have received a response on 99acres.
        Details of the response:
        Name: Pavan
        Mobile: +91-9700364876
        Email: srivirinchi.kadiyala@gmail.com
        Requirements: 4 BHK Villa in HSR
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('99acres');
      expect(res.name).toBe('Pavan');
      expect(res.phone).toBe('+91-9700364876');
      expect(res.email).toBe('srivirinchi.kadiyala@gmail.com');
      expect(res.requirementText).toBe('4 BHK Villa in HSR');
    });

    it('should parse Housing.com emails with plain fallback', () => {
      const subject = 'Housing - Lead interested in your property';
      const body = `
        Name: Sreeramkrishna Krishna
        Phone: +91-9988776655
        Email: sreeram@example.com
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('Housing');
      expect(res.name).toBe('Sreeramkrishna Krishna');
      expect(res.phone).toBe('+91-9988776655');
      expect(res.email).toBe('sreeram@example.com');
    });
  });

  describe('extractHousingUrls', () => {
    it('should parse mailto, whatsapp and call now links from email HTML', () => {
      const html = `
        <div style="font-family: Arial;">
          <p>We have received a contact request:</p>
          <a href="mailto:sreeram@gmail.com?subject=Inquiry">Send Email</a>
          <a href="https://housing.com/leads/whatsapp?lead_id=12345">Chat On WhatsApp</a>
          <a href="https://housing.com/leads/call?lead_id=12345">Call Now</a>
        </div>
      `;
      const res = extractHousingUrls(html);
      expect(res.mailtoEmail).toBe('sreeram@gmail.com');
      expect(res.whatsappUrl).toBe('https://housing.com/leads/whatsapp?lead_id=12345');
      expect(res.callNowUrl).toBe('https://housing.com/leads/call?lead_id=12345');
    });
  });

  describe('resolvePhoneNumberFromUrl', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should extract phone number directly if present in the URL', async () => {
      const url = 'https://api.whatsapp.com/send?phone=919876543210&text=hello';
      const res = await resolvePhoneNumberFromUrl(url);
      expect(res).toBe('919876543210');
    });

    it('should follow redirect headers manually to extract number', async () => {
      const mockFetch = vi.fn().mockImplementation((url) => {
        if (url === 'https://housing.com/leads/whatsapp?lead_id=12345') {
          return Promise.resolve({
            status: 302,
            headers: new Headers({
              location: 'https://api.whatsapp.com/send?phone=919900112233'
            })
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await resolvePhoneNumberFromUrl('https://housing.com/leads/whatsapp?lead_id=12345');
      expect(res).toBe('919900112233');
    });
  });

  describe('resolveHousingPhone', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should resolve phone number from whatsapp redirect in HTML', async () => {
      const html = `<a href="https://housing.com/rd?id=555">Chat On WhatsApp</a>`;
      const mockFetch = vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({
          location: 'https://api.whatsapp.com/send?phone=918887776665'
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const phone = await resolveHousingPhone(html, '');
      expect(phone).toBe('918887776665');
    });
  });
});
