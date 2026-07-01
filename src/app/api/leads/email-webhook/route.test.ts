import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDb = {
  contacts: [] as any[],
  contact_property_inquiries: [] as any[],
  contact_tags: [] as any[],
  email_sync_logs: [] as any[],
  tags: [] as any[],
  properties: [
    {
      id: 'prop-123',
      title: 'Industrial Land in Bommasandra',
      type: 'Industrial Land',
      location: 'Bommasandra, Bangalore',
      bedrooms: null,
      area_sqft: 5000,
      price: 25000000, // 2.5 Cr
      property_code: 'IND123'
    }
  ] as any[],
  profiles: { user_id: 'user-456' },
  whatsapp_config: { account_id: 'acc-789' },
  email_sync_configs: { account_id: 'acc-789', is_active: true }
};

vi.mock('./admin-client', () => {
  const selectImpl = (table: string) => {
    if (table === 'whatsapp_config') return { data: { account_id: 'acc-789' }, error: null };
    if (table === 'email_sync_configs') return { data: { account_id: 'acc-789', is_active: true }, error: null };
    if (table === 'profiles') return { data: { user_id: 'user-456' }, error: null };
    if (table === 'properties') return { data: mockDb.properties, error: null };
    if (table === 'contacts') return { data: null, error: null };
    return { data: null, error: null };
  };

  const mockSupabase = {
    from: vi.fn().mockImplementation((table) => {
      const builder = {
        then: (resolve: any) => Promise.resolve(selectImpl(table)).then(resolve),
        select: vi.fn().mockImplementation(() => builder),
        insert: vi.fn().mockImplementation((payload) => {
          const records = Array.isArray(payload) ? payload : [payload];
          const recordsWithId = records.map(r => {
            const record = { id: `${table}-mock-id`, ...r };
            if (table === 'contacts') mockDb.contacts.push(record);
            if (table === 'email_sync_logs') mockDb.email_sync_logs.push(record);
            if (table === 'tags') mockDb.tags.push(record);
            return record;
          });
          const chain = {
            select: vi.fn().mockImplementation(() => ({
              single: vi.fn().mockResolvedValue({ data: recordsWithId[0], error: null })
            }))
          };
          return chain;
        }),
        update: vi.fn().mockImplementation((payload) => builder),
        upsert: vi.fn().mockImplementation((payload) => {
          if (table === 'contact_property_inquiries') {
            const records = Array.isArray(payload) ? payload : [payload];
            mockDb.contact_property_inquiries.push(...records);
          }
          if (table === 'contact_tags') {
            const records = Array.isArray(payload) ? payload : [payload];
            mockDb.contact_tags.push(...records);
          }
          return { data: null, error: null };
        }),
        delete: vi.fn().mockImplementation(() => builder),
        eq: vi.fn().mockImplementation(() => builder),
        or: vi.fn().mockImplementation(() => builder),
        in: vi.fn().mockImplementation(() => builder),
        limit: vi.fn().mockImplementation(() => builder),
        maybeSingle: vi.fn().mockImplementation(() => {
          if (table === 'contacts') return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: selectImpl(table).data, error: null });
        }),
        single: vi.fn().mockImplementation(() => {
          return Promise.resolve({ data: selectImpl(table).data, error: null });
        })
      };
      return builder;
    })
  };
  return {
    getAdminClient: () => mockSupabase
  };
});

vi.mock('./auto-reply', () => ({
  sendAutoReply: vi.fn().mockResolvedValue({ success: true, messageId: 'auto-reply-msg-id' })
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn().mockResolvedValue(undefined)
}));

import {
  parsePortalLead,
  extractHousingUrls,
  resolvePhoneNumberFromUrl,
  resolveHousingPhone,
  decodeQuotedPrintable,
  decodeMimeSubject,
  parseMimeEmail,
  checkIsNonLeadEmail,
  stripOwnerSuffix,
  POST
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

    it('should parse Magicbricks Industrial Land emails correctly', () => {
      const subject = 'Hot Lead - Buyer has contacted you on Magicbricks for - Industrial Land for sale in Bommasandra';
      const body = `
        Dear Praneeth,
        A user is interested in your Property, ID 79221031: Industrial Land in Bommasandra, Bangalore.
        Details of Contact Made:
        Sender's Name: Pushpa (Individual)
        Mobile: 9740750397
        Email: pushpa9876@gmail.com
        Message: I am interested in your property.
        Please get in touch with me
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('Magic Bricks');
      expect(res.name).toBe('Pushpa (Individual)');
      expect(res.phone).toBe('9740750397');
      expect(res.email).toBe('pushpa9876@gmail.com');
      expect(res.propertyType).toBe('Industrial Land');
      expect(res.propertyLocation).toBe('Bommasandra');
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

    it('should parse Housing.com emails with button text (Send Email, Call Now)', () => {
      const subject = 'Housing - Lead interested in your property';
      const html = `
        <div style="font-family: Arial;">
          <p>We have received a contact request:</p>
          <p>Name: Kg Subramanian (Owner)</p>
          <p>Email: <a href="mailto:kgsubramanian@gmail.com?subject=Inquiry">Send Email</a></p>
          <p>Contact: <a href="https://housing.com/leads/call?lead_id=12345">Call Now</a> <a href="https://housing.com/leads/whatsapp?lead_id=12345">Chat On WhatsApp</a></p>
          <p>Property ID: 20327451</p>
        </div>
      `;
      const body = `
        Name: Kg Subramanian (Owner)
        Email: Send Email
        Contact: Call Now Chat On WhatsApp
        Property ID: 20327451
      `;
      const res = parsePortalLead(subject, body, html);
      expect(res.source).toBe('Housing');
      expect(res.name).toBe('Kg Subramanian (Owner)');
      expect(res.email).toBe('kgsubramanian@gmail.com');
      // Phone should be empty here since it needs URL resolution
      expect(res.phone).toBe('');
    });

    it('should parse Housing.com email without falling back to URL/Property ID, and resolve phone via resolveHousingPhone', async () => {
      const subject = 'Housing - Lead interested in your property';
      const html = `
        <div style="font-family: Arial;">
          <p>Name: Md Shalam</p>
          <p>Email: <a href="mailto:support@housing.com?subject=Inquiry">Send Email</a></p>
          <p>Contact: <a href="https://pahal.housing.com/lead/cta/number?phone=+919731330512&userName=Md+Shalam">Call Now</a> <a href="https://pahal.housing.com/lead/cta/whatsapp?phone=+919731330512&userName=Md+Shalam">Chat On WhatsApp</a></p>
          <p>Property ID: 15782099</p>
        </div>
      `;
      const body = `
        Name: Md Shalam
        Email: Send Email
        Contact: Call Now Chat On WhatsApp
        Property ID: 15782099
        https://housing.com/leads/call?lead_id=15782099
      `;
      const res = parsePortalLead(subject, body, html);
      expect(res.source).toBe('Housing');
      expect(res.name).toBe('Md Shalam');
      // Phone should be empty or a suspended/suspicious value that will get resolved
      // Since the body has the URL, the fallback parser might pick it up, but it contains a '/' and 'http', so it will be ignored now!
      expect(res.phone).toBe('');
      
      const resolvedPhone = await resolveHousingPhone(html, body);
      expect(resolvedPhone).toBe('+919731330512');
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

  describe('MIME & QP Decoders', () => {
    it('should decode MIME UTF-8 Q-encoded subject headers', () => {
      const input = '=?UTF-8?Q?=28Gmail_Forwarding_confirmation_=E2=80=93_Receive_mail_from?=';
      const decoded = decodeMimeSubject(input);
      expect(decoded).toContain('Gmail Forwarding confirmation');
    });

    it('should decode Quoted-Printable body text with soft breaks', () => {
      const input = 'Confirmation code: =\r\n12345678\r\nTo confirm, click: https://mail.google.com/mail/f-=3D12345';
      const decoded = decodeQuotedPrintable(input);
      expect(decoded).toBe('Confirmation code: 12345678\r\nTo confirm, click: https://mail.google.com/mail/f-=12345');
    });
  });

  describe('99acres Fallback Parsing', () => {
    it('should parse 99acres email in block format without labels', () => {
      const subject = 'Fwd: Property Advertisement Response on 99acres';
      const body = `
        Details of the response
        Pavan
        srivirinchi.kadiyala@gmail.com
        +91-9700364876 (Verified)
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('99acres');
      expect(res.name).toBe('Pavan');
      expect(res.phone).toBe('+91-9700364876');
      expect(res.email).toBe('srivirinchi.kadiyala@gmail.com');
    });

    it('should ignore SMTP routing headers, received lines, and system sync emails', () => {
      const subject = 'Fwd: Property Advertisement Response on 99acres';
      const body = `
        Received: by cloudflare-email.net (cloudflare) id 85IrCefi6a5y
        To: lead-sync-4f1247de-269c-47c2-8974-36ef8f77f77d@leads.convoreal.com
        From: noreply@99acres.com
        
        Details of the response:
        Robert Smith
        robert@gmail.com
        +919876543210 (Verified)
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('99acres');
      expect(res.name).toBe('Robert Smith');
      expect(res.email).toBe('robert@gmail.com');
      expect(res.phone).toBe('+919876543210');
    });

    it('should parse 99acres email in block format without labels and without lead email', () => {
      const subject = 'Property Advertisement Response';
      const body = `
        Dear PRANEETH KUMAR
        You have received a response on Rs 17.5 Crore , Residential Land/Plot in Sector 6 HSR Layout (G69065068) on 99acres.com

        Details of the response
        M Naveen
        +91-9811122232 (Verified)
        Send Mail
      `;
      const res = parsePortalLead(subject, body, '');
      expect(res.source).toBe('99acres');
      expect(res.name).toBe('M Naveen');
      expect(res.phone).toBe('+91-9811122232');
      expect(res.phone.replace(/\D/g, '')).toBe('919811122232');
      expect(res.email).toBeNull();
    });
  });

  describe('parseMimeEmail', () => {
    it('should parse raw multipart MIME emails with boundary', () => {
      const rawEmail = `
Received: from mail.example.com
Content-Type: multipart/alternative; boundary="boundary-123"
Subject: =?UTF-8?Q?Test_Subject?=

--boundary-123
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello plain text.

--boundary-123
Content-Type: text/html; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

<h1>Hello HTML</h1>

--boundary-123--
      `.trim();
      
      const parsed = parseMimeEmail(rawEmail);
      expect(parsed.text.trim()).toBe('Hello plain text.');
      expect(parsed.html.trim()).toBe('<h1>Hello HTML</h1>');
    });
  });

  describe('checkIsNonLeadEmail', () => {
    it('should not filter out legitimate lead emails containing real estate keywords like sale, offer, or deal', () => {
      const subject1 = 'Hot Lead - Buyer has contacted you on Magicbricks for - Industrial Land for sale in Bommasandra';
      const sender1 = 'MagicBricks <info@magicbricks.com>';
      expect(checkIsNonLeadEmail(subject1, sender1)).toBe(false);

      const subject2 = 'Buyer has contacted you for 3BHK flat resale';
      const sender2 = '99acres <services@99acres.com>';
      expect(checkIsNonLeadEmail(subject2, sender2)).toBe(false);

      const subject3 = 'New offer received on Property ID 12345';
      const sender3 = 'MagicBricks <info@magicbricks.com>';
      expect(checkIsNonLeadEmail(subject3, sender3)).toBe(false);
    });

    it('should exempt legitimate portal senders from noreply/no-reply sender filtering', () => {
      const subject = 'Housing - Lead interested in your property';
      const sender = 'noreply@housing-mailer.com';
      expect(checkIsNonLeadEmail(subject, sender)).toBe(false);

      const subject2 = 'Fwd: Property Advertisement Response on 99acres';
      const sender2 = 'noreply@99acres.com';
      expect(checkIsNonLeadEmail(subject2, sender2)).toBe(false);
    });

    it('should correctly filter out actual system notifications and marketing blasts', () => {
      expect(checkIsNonLeadEmail('Your password was updated', 'noreply@somebank.com')).toBe(true);
      expect(checkIsNonLeadEmail('Account security notification', 'info@service.com')).toBe(true);
      expect(checkIsNonLeadEmail('Magicbricks Weekly Digest', 'info@magicbricks.com')).toBe(true);
      expect(checkIsNonLeadEmail('Flash Sale! Save 50% now', 'marketing@deals.com')).toBe(true);
      expect(checkIsNonLeadEmail('Exclusive Offer for subscribers', 'promo@service.com')).toBe(true);
    });
  });

  describe('stripOwnerSuffix', () => {
    it('should strip owner and individual role suffixes from contact names', () => {
      expect(stripOwnerSuffix('Kg Subramanian (Owner)')).toBe('Kg Subramanian');
      expect(stripOwnerSuffix('Pushpa (Individual)')).toBe('Pushpa');
      expect(stripOwnerSuffix('Robert Smith (Agent)')).toBe('Robert Smith');
      expect(stripOwnerSuffix('John Doe (Buyer)')).toBe('John Doe');
      expect(stripOwnerSuffix('No Suffix')).toBe('No Suffix');
    });
  });

  describe('POST Webhook Endpoint', () => {
    beforeEach(() => {
      mockDb.contacts = [];
      mockDb.contact_property_inquiries = [];
      mockDb.contact_tags = [];
      mockDb.email_sync_logs = [];
      // reset properties to initial state
      mockDb.properties = [
        {
          id: 'prop-123',
          title: 'Industrial Land in Bommasandra',
          type: 'Industrial Land',
          location: 'Bommasandra, Bangalore',
          bedrooms: null,
          area_sqft: 5000,
          price: 25000000, // 2.5 Cr
          property_code: 'IND123'
        }
      ];
    });

    it('should process a Magicbricks Industrial Land lead, match with properties, extract preferences and auto-tag', async () => {
      const payload = {
        subject: 'Hot Lead - Buyer has contacted you on Magicbricks for - Industrial Land for sale in Bommasandra',
        from: 'MagicBricks <info@magicbricks.com>',
        text: `
          Dear Praneeth,
          A user is interested in your Property, ID 79221031: Industrial Land in Bommasandra, Bangalore.
          Details of Contact Made:
          Sender's Name: Pushpa (Individual)
          Mobile: 9740750397
          Email: pushpa9876@gmail.com
          Message: I am interested in your property.
          Please get in touch with me
        `
      };

      const req = new Request('http://localhost/api/leads/email-webhook?account_id=acc-789&token=test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      // Verify contact was inserted
      expect(mockDb.contacts.length).toBe(1);
      const contact = mockDb.contacts[0];
      expect(contact.name).toBe('Pushpa');
      expect(contact.phone).toBe('+919740750397');
      expect(contact.email).toBe('pushpa9876@gmail.com');
      
      // Verify preferences were populated via matched property
      expect(contact.max_budget).toBe(25000000); // 2.5 Cr from property
      expect(contact.areas_of_interest).toContain('Bommasandra');
      expect(contact.property_interests).toContain('Industrial');

      // Verify contact was associated with the property
      expect(mockDb.contact_property_inquiries.length).toBe(1);
      expect(mockDb.contact_property_inquiries[0].property_id).toBe('prop-123');

      // Verify tags were assigned correctly
      expect(mockDb.contact_tags.length).toBeGreaterThan(0);
    });

    it('should parse 99acres lead, match with HSR property and assign tags', async () => {
      // Add a property in HSR Layout
      mockDb.properties.push({
        id: 'prop-456',
        title: '4 BHK Villa in HSR Layout',
        type: 'Villa',
        location: 'HSR Layout, Bangalore',
        bedrooms: 4,
        area_sqft: 3500,
        price: 45000000, // 4.5 Cr
        property_code: 'VIL456'
      });

      const payload = {
        subject: 'Property Advertisement Response',
        from: '99acres <noreply@99acres.com>',
        text: `
          Dear PRANEETH KUMAR,
          You have received a response on 99acres.
          Details of the response:
          Name: Syed Thanveer
          Mobile: +91-6381139611
          Email: thanveer@gmail.com
          Requirements: 4 BHK Villa in HSR
        `
      };

      const req = new Request('http://localhost/api/leads/email-webhook?account_id=acc-789&token=test-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      expect(mockDb.contacts.length).toBe(1);
      const contact = mockDb.contacts[0];
      expect(contact.name).toBe('Syed Thanveer');
      expect(contact.phone).toBe('+916381139611');
      expect(contact.max_budget).toBe(45000000); // 4.5 Cr from property
      expect(contact.areas_of_interest).toContain('HSR');
      expect(contact.property_interests).toContain('Vacant building'); // mapped from Villa

      // Verify contact was associated with the property
      expect(mockDb.contact_property_inquiries.length).toBe(1);
      expect(mockDb.contact_property_inquiries[0].property_id).toBe('prop-456');

      // Verify tags were assigned correctly
      expect(mockDb.contact_tags.length).toBeGreaterThan(0);
    });
  });
});
